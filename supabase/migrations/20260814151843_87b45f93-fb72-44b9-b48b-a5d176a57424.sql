alter table public.platform_settings
  add column if not exists cash_in_fee_percent numeric(5,2) not null default 0;

alter table public.cash_in_requests
  add column if not exists fee_percent numeric(5,2) not null default 0,
  add column if not exists fee_php numeric(14,2) not null default 0,
  add column if not exists net_php numeric(14,2);

update public.cash_in_requests set net_php = amount_php where net_php is null;

drop function if exists public.money_settings();
create function public.money_settings()
returns table(credits_per_unit numeric, php_per_unit numeric, fee_percent numeric,
              cashback_reseller integer, cashback_subreseller integer,
              cash_in_fee_percent numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  select cash_out_credits_per_unit, cash_out_php_per_unit, withdrawal_fee_percent,
         cashback_reseller_percent, cashback_subreseller_percent,
         coalesce(cash_in_fee_percent, 0)
    from public.platform_settings where id = 1;
$function$;

revoke execute on function public.money_settings() from anon;
grant execute on function public.money_settings() to authenticated;

drop function if exists public.set_platform_money_settings(integer, integer, numeric, numeric, numeric, numeric);
create function public.set_platform_money_settings(
  _cashback_reseller integer, _cashback_subreseller integer,
  _credits_per_unit numeric, _php_per_unit numeric, _withdrawal_fee numeric,
  _shop_transfer_fee numeric default null::numeric,
  _cash_in_fee numeric default null::numeric)
returns platform_settings
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.platform_settings; _prev public.platform_settings; _actor text;
        _fee numeric; _cin numeric;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can change money settings';
  end if;
  if _cashback_reseller is null or _cashback_subreseller is null
     or _cashback_reseller < 0 or _cashback_subreseller < 0 then
    raise exception 'Cashback percentages must be zero or more';
  end if;
  if _cashback_reseller + _cashback_subreseller > 100 then
    raise exception 'Reseller + subreseller cashback cannot exceed 100%%';
  end if;
  if coalesce(_credits_per_unit,0) <= 0 or coalesce(_php_per_unit,0) <= 0 then
    raise exception 'The credit valuation must use positive amounts';
  end if;
  if _withdrawal_fee is null or _withdrawal_fee < 0 or _withdrawal_fee > 100 then
    raise exception 'The cash out fee must be between 0%% and 100%%';
  end if;

  select * into _prev from public.platform_settings where id = 1;
  _fee := coalesce(_shop_transfer_fee, _prev.shop_transfer_fee_credits, 5);
  if _fee < 0 then raise exception 'The shop transfer fee cannot be negative'; end if;
  _cin := coalesce(_cash_in_fee, _prev.cash_in_fee_percent, 0);
  if _cin < 0 or _cin > 100 then
    raise exception 'The cash in fee must be between 0%% and 100%%';
  end if;

  update public.platform_settings
     set cashback_reseller_percent = _cashback_reseller,
         cashback_subreseller_percent = _cashback_subreseller,
         cash_out_credits_per_unit = _credits_per_unit,
         cash_out_php_per_unit = _php_per_unit,
         withdrawal_fee_percent = _withdrawal_fee,
         shop_transfer_fee_credits = _fee,
         cash_in_fee_percent = _cin,
         updated_at = now(), updated_by = auth.uid()
   where id = 1
   returning * into _row;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce(_actor,'Super Admin'), 'Updated platform money settings', 'Platform settings',
          jsonb_build_object(
            'previous', jsonb_build_object(
              'cashback_reseller_percent', _prev.cashback_reseller_percent,
              'cashback_subreseller_percent', _prev.cashback_subreseller_percent,
              'cash_out_credits_per_unit', _prev.cash_out_credits_per_unit,
              'cash_out_php_per_unit', _prev.cash_out_php_per_unit,
              'withdrawal_fee_percent', _prev.withdrawal_fee_percent,
              'cash_in_fee_percent', _prev.cash_in_fee_percent,
              'shop_transfer_fee_credits', _prev.shop_transfer_fee_credits),
            'new', jsonb_build_object(
              'cashback_reseller_percent', _cashback_reseller,
              'cashback_subreseller_percent', _cashback_subreseller,
              'cash_out_credits_per_unit', _credits_per_unit,
              'cash_out_php_per_unit', _php_per_unit,
              'withdrawal_fee_percent', _withdrawal_fee,
              'cash_in_fee_percent', _cin,
              'shop_transfer_fee_credits', _fee),
            'applies_to', 'future transactions only'));
  return _row;
end $function$;

revoke execute on function public.set_platform_money_settings(integer, integer, numeric, numeric, numeric, numeric, numeric) from anon;
grant execute on function public.set_platform_money_settings(integer, integer, numeric, numeric, numeric, numeric, numeric) to authenticated;

create or replace function public.request_cash_in(_method_id uuid, _amount_php numeric, _payer_reference text default null::text, _notes text default null::text, _request_key text default null::text)
returns cash_in_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _fee numeric(14,2); _net numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if public.is_super_admin(_subject) then
    raise exception 'The platform owner does not hold a member credit balance and cannot cash in';
  end if;
  _role := coalesce(public.top_role(_subject), 'customer');

  if _amount_php is null or _amount_php <= 0 then raise exception 'Enter how much you are paying'; end if;
  if _amount_php > 10000000 then raise exception 'A single cash in is limited to 10,000,000'; end if;

  select * into _m from public.payment_methods where id = _method_id;
  if _m.id is null or not _m.active then raise exception 'Choose an available payment method'; end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);
  select * into _row from public.cash_in_requests where request_key = _key;
  if _row.id is not null then return _row; end if;

  select * into _s from public.money_settings();
  _fee := round(_amount_php * coalesce(_s.cash_in_fee_percent,0) / 100.0, 2);
  _net := round(_amount_php - _fee, 2);
  if _net <= 0 then raise exception 'That amount is too small to cash in'; end if;
  _credits := round(_net * _s.credits_per_unit / _s.php_per_unit, 2);
  if _credits <= 0 then raise exception 'That amount is too small to cash in'; end if;

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
    method_id, method_name, method_type,
    method_details, payer_reference, notes)
  values (_ref, _key, _subject, _eco, _name, _role::text,
          _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
          coalesce(_s.cash_in_fee_percent,0), _fee, _net,
          _m.id, _m.name, _m.method_type,
          jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                             'account_number', _m.account_number, 'notes', _m.notes),
          nullif(trim(_payer_reference),''), nullif(trim(_notes),''))
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          'Requested cash in', _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'fee_percent', coalesce(_s.cash_in_fee_percent,0), 'fee_php', _fee,
                             'net_php', _net,
                             'method', _m.name, 'requester_id', _subject, 'status', 'pending'));
  return _row;
end $function$;

revoke execute on function public.request_cash_in(uuid, numeric, text, text, text) from anon;
grant execute on function public.request_cash_in(uuid, numeric, text, text, text) to authenticated;

drop policy if exists "Admins read profiles in their ecosystem" on public.profiles;
create policy "Admins read profiles in their ecosystem"
on public.profiles for select
using (ecosystem_id is not null
       and public.is_ecosystem_admin(auth.uid(), ecosystem_id)
       and not public.is_super_admin(id));

drop policy if exists "Admins update profiles in their ecosystem" on public.profiles;
create policy "Admins update profiles in their ecosystem"
on public.profiles for update
using (ecosystem_id is not null
       and public.is_ecosystem_admin(auth.uid(), ecosystem_id)
       and not public.is_super_admin(id));

drop function if exists public.universe_profile(text);
create function public.universe_profile(_handle text)
returns table(user_id uuid, full_name text, handle text, avatar_path text, bio text,
              joined_at timestamp with time zone, is_platform boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select case when public.is_super_admin(p.id) and p.id <> auth.uid()
                   and not public.is_super_admin(auth.uid())
              then null::uuid else p.id end,
         case when public.is_super_admin(p.id) and p.id <> auth.uid()
                   and not public.is_super_admin(auth.uid())
              then 'WaveWallet Super Admin' else p.full_name end,
         p.handle,
         case when public.is_super_admin(p.id) and p.id <> auth.uid()
                   and not public.is_super_admin(auth.uid())
              then null else p.avatar_path end,
         case when public.is_super_admin(p.id) and p.id <> auth.uid()
                   and not public.is_super_admin(auth.uid())
              then 'Official WaveWallet platform account.' else p.bio end,
         p.joined_at,
         public.is_super_admin(p.id)
    from public.profiles p
   where auth.uid() is not null
     and p.deleted_at is null
     and public.normalize_handle(p.handle) = public.normalize_handle(_handle)
   limit 1
$function$;

revoke execute on function public.universe_profile(text) from anon;
grant execute on function public.universe_profile(text) to authenticated;

create or replace function public.social_handle_search(_q text, _limit integer default 8)
returns table(user_id uuid, full_name text, handle text, avatar_path text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, p.handle, p.avatar_path
    from public.profiles p
   where auth.uid() is not null
     and p.deleted_at is null
     and p.handle is not null
     and (public.is_super_admin(auth.uid()) or not public.is_super_admin(p.id))
     and (public.normalize_handle(p.handle) like public.normalize_handle(_q) || '%'
          or lower(p.full_name) like '%' || lower(btrim(coalesce(_q,''))) || '%')
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
                         or (b.blocker_id = p.id and b.blocked_id = auth.uid()))
   order by length(p.handle), p.handle
   limit least(coalesce(_limit,8), 20)
$function$;

create or replace function public.social_feed(_limit integer default 30, _before timestamp with time zone default null::timestamp with time zone)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, image_path text, promoted boolean, promotion_tier_name text, promotion_expires_at timestamp with time zone, like_count integer, comment_count integer, liked_by_me boolean, created_at timestamp with time zone, can_delete boolean, audience text, origin_ecosystem_name text, author_role text, can_hide boolean)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare _eco uuid; _mod boolean; _vs boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select pr.ecosystem_id into _eco from public.profiles pr
   where pr.id = auth.uid() and pr.deleted_at is null;
  if _eco is null then return; end if;
  _mod := public.social_can_moderate(auth.uid(), _eco);
  _vs := public.is_super_admin(auth.uid());
  return query
  select p.id,
         case when public.is_super_admin(p.author_id) and not _vs then null::uuid else p.author_id end,
         case when public.is_super_admin(p.author_id) and not _vs then 'WaveWallet Super Admin' else coalesce(a.full_name,'Member') end,
         case when public.is_super_admin(p.author_id) and not _vs then null else a.handle end,
         case when public.is_super_admin(p.author_id) and not _vs then null else a.avatar_path end,
         p.body, p.image_path,
         (p.promoted and p.promotion_refunded_at is null
          and (p.promotion_expires_at is null or p.promotion_expires_at > now())),
         p.promotion_tier_name, p.promotion_expires_at,
         (select count(*)::integer from public.social_likes l
           where l.post_id = p.id and l.ecosystem_id = _eco),
         (select count(*)::integer from public.social_comments c
           where c.post_id = p.id and c.ecosystem_id = _eco and c.status = 'active'),
         exists (select 1 from public.social_likes l where l.post_id = p.id and l.user_id = auth.uid()),
         p.created_at,
         (p.author_id = auth.uid() or public.is_super_admin(auth.uid())),
         p.audience,
         case when p.audience <> 'ecosystem' then eo.name end,
         case when public.is_super_admin(p.author_id) then 'super_admin'
              else coalesce(public.membership_role(p.author_id, p.ecosystem_id)::text, 'customer') end,
         (_mod and p.author_id <> auth.uid())
    from public.social_posts p
    join public.profiles a on a.id = p.author_id
    join public.ecosystems eo on eo.id = p.ecosystem_id
   where p.status = 'active'
     and ((p.audience = 'ecosystem' and p.ecosystem_id = _eco)
          or p.audience = 'general'
          or (p.audience = 'shops' and exists (
                select 1 from public.social_post_distributions d
                 where d.post_id = p.id and d.ecosystem_id = _eco and d.status = 'approved')))
     and not exists (select 1 from public.social_post_shop_hides h
                      where h.post_id = p.id and h.ecosystem_id = _eco)
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.author_id)
                         or (b.blocker_id = p.author_id and b.blocked_id = auth.uid()))
     and (_before is null or p.created_at < _before)
   order by case when p.promoted and p.promotion_refunded_at is null
                  and (p.promotion_expires_at is null or p.promotion_expires_at > now())
                 then p.promotion_priority else -1 end desc,
            p.created_at desc
   limit least(coalesce(_limit,30), 50);
end $function$;

create or replace function public.social_post_comments(_post_id uuid)
returns table(id uuid, author_id uuid, author_name text, author_handle text, author_avatar text, body text, created_at timestamp with time zone, can_delete boolean, parent_id uuid, depth integer)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare _eco uuid; _vs boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  _vs := public.is_super_admin(auth.uid());
  return query
  select c.id,
         case when public.is_super_admin(c.author_id) and not _vs then null::uuid else c.author_id end,
         case when public.is_super_admin(c.author_id) and not _vs then 'WaveWallet Super Admin' else coalesce(a.full_name,'Member') end,
         case when public.is_super_admin(c.author_id) and not _vs then null else a.handle end,
         case when public.is_super_admin(c.author_id) and not _vs then null else a.avatar_path end,
         c.body, c.created_at,
         (c.author_id = auth.uid() or public.social_can_moderate(auth.uid(), c.ecosystem_id)),
         c.parent_id, c.depth
    from public.social_comments c
    join public.profiles a on a.id = c.author_id
   where c.post_id = _post_id and c.ecosystem_id = _eco and c.status = 'active'
     and not exists (select 1 from public.social_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = c.author_id)
                         or (b.blocker_id = c.author_id and b.blocked_id = auth.uid()))
   order by c.created_at;
end $function$;

create or replace function public.search_universe_members(_ecosystem_id uuid, _q text, _limit integer default 10)
returns table(user_id uuid, full_name text, handle text, avatar_path text, masked_email text, phone text, already_member boolean, pending_invitation boolean, pending_application boolean)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  _term text := btrim(coalesce(_q, ''));
  _digits text := regexp_replace(coalesce(_q, ''), '[^0-9]', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not public.can_invite_members(auth.uid(), _ecosystem_id) then
    raise exception 'You are not allowed to invite members to this shop';
  end if;
  if length(_term) < 2 then
    return;
  end if;

  return query
  select p.id,
         p.full_name,
         p.handle,
         p.avatar_path,
         case when p.email = '' then null
              else left(p.email, 2) || '***' || substring(p.email from position('@' in p.email))
         end as masked_email,
         nullif(p.phone, '') as phone,
         exists (select 1 from public.ecosystem_memberships m
                  where m.user_id = p.id and m.ecosystem_id = _ecosystem_id
                    and m.membership_state = 'active') as already_member,
         exists (select 1 from public.ecosystem_invitations i
                  where i.user_id = p.id and i.ecosystem_id = _ecosystem_id
                    and i.status = 'pending') as pending_invitation,
         exists (select 1 from public.membership_applications a
                  where a.user_id = p.id and a.ecosystem_id = _ecosystem_id
                    and a.status = 'pending') as pending_application
    from public.profiles p
   where p.deleted_at is null
     and not public.is_super_admin(p.id)
     and (
       (p.handle is not null
         and public.normalize_handle(p.handle) like public.normalize_handle(_term) || '%')
       or lower(p.full_name) like '%' || lower(_term) || '%'
       or lower(p.email) = lower(_term)
       or (length(_digits) >= 6 and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
     )
   order by case when p.handle is not null
                  and public.normalize_handle(p.handle) = public.normalize_handle(_term) then 0
                 when lower(p.full_name) = lower(_term) then 1
                 else 2 end,
            p.full_name
   limit least(greatest(coalesce(_limit, 10), 1), 25);
end;
$function$;

create or replace function public.search_members(_query text, _ecosystem_id uuid default null::uuid)
returns table(id uuid, full_name text, handle text, avatar_path text, email text, phone text, masked_email text, status text, role text, ecosystem_id uuid, ecosystem_name text, credit_balance numeric, points_balance integer)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  _actor uuid := auth.uid();
  _q text := lower(btrim(coalesce(_query, '')));
  _h text := public.normalize_handle(_query);
  _digits text := regexp_replace(coalesce(_query, ''), '[^0-9]', '', 'g');
  _super boolean;
  _admin boolean := false;
  _seller boolean := false;
  _eco uuid;
  _scope uuid := _ecosystem_id;
begin
  if _actor is null or length(_q) < 2 then return; end if;

  _super := public.is_super_admin(_actor);
  if not _super then
    select p.ecosystem_id into _eco from public.profiles p where p.id = _actor;
    if _eco is null then return; end if;
    _admin := public.is_ecosystem_admin(_actor, _eco);
    _seller := public.has_role(_actor, 'reseller') or public.has_role(_actor, 'subreseller');
    if not _admin and not _seller then return; end if;
    if _scope is not null and _scope <> _eco then return; end if;
    _scope := _eco;
  end if;

  return query
    select
      p.id,
      p.full_name,
      p.handle,
      p.avatar_path,
      case when _super or _admin then p.email else regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2') end,
      case when _super or _admin then p.phone
           else regexp_replace(p.phone, '.(?=.{3})', '*', 'g') end,
      regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2'),
      p.status::text,
      coalesce((
        select ur.role::text from public.user_roles ur
        where ur.user_id = p.id
        order by case ur.role
          when 'super_admin' then 1 when 'admin' then 2
          when 'reseller' then 3 when 'subreseller' then 4 else 5 end
        limit 1
      ), 'customer'),
      p.ecosystem_id,
      e.name,
      case when _super or _admin then coalesce(ca.balance, 0)::numeric else 0::numeric end,
      case when _super or _admin then coalesce(pa.balance, 0)::integer else 0 end
    from public.profiles p
    join public.ecosystems e on e.id = p.ecosystem_id
    left join public.credit_accounts ca on ca.user_id = p.id
    left join public.points_accounts pa on pa.user_id = p.id
    where p.deleted_at is null
      and (_super or not public.is_super_admin(p.id))
      and (_scope is null or p.ecosystem_id = _scope)
      and (_super or _admin or public.can_load_credits(_actor, p.id))
      and (
        lower(p.full_name) like '%' || _q || '%'
        or lower(p.email) like '%' || _q || '%'
        or (_h is not null and lower(coalesce(p.handle,'')) like '%' || _h || '%')
        or (_digits <> '' and regexp_replace(p.phone, '[^0-9]', '', 'g') like '%' || _digits || '%')
      )
    order by
      case when lower(p.full_name) = _q or lower(p.email) = _q
                 or lower(coalesce(p.handle,'')) = coalesce(_h,'') then 0 else 1 end,
      p.full_name
    limit 25;
end;
$function$;

create or replace function public.dm_open_thread(_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _eco uuid; _a uuid; _b uuid; _id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.assert_actor_active();
  if _member_id = auth.uid() then raise exception 'Pick another member'; end if;
  if public.is_super_admin(_member_id) then
    raise exception 'That member is not available';
  end if;
  select ecosystem_id into _eco from public.profiles where id = auth.uid() and deleted_at is null;
  if _eco is null or not exists (select 1 from public.profiles
        where id = _member_id and ecosystem_id = _eco and deleted_at is null and status = 'active') then
    raise exception 'That member is not available';
  end if;
  if exists (select 1 from public.social_blocks
              where (blocker_id = _member_id and blocked_id = auth.uid())
                 or (blocker_id = auth.uid() and blocked_id = _member_id)) then
    raise exception 'You cannot message this member';
  end if;
  _a := least(auth.uid(), _member_id); _b := greatest(auth.uid(), _member_id);
  insert into public.dm_threads (ecosystem_id, user_a, user_b) values (_eco, _a, _b)
    on conflict (ecosystem_id, user_a, user_b) do nothing;
  select id into _id from public.dm_threads where ecosystem_id = _eco and user_a = _a and user_b = _b;
  return _id;
end; $function$;

create or replace function public.my_social_graph()
returns table(kind text, relation_id uuid, user_id uuid, full_name text, handle text, avatar_path text, status text, created_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  select 'friend', f.id,
         case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
         p.full_name, p.handle, p.avatar_path,
         case when f.status = 'accepted' then 'friends'
              when f.requester_id = auth.uid() then 'requested' else 'incoming' end,
         f.created_at
    from public.social_friendships f
    join public.profiles p
      on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
   where auth.uid() in (f.requester_id, f.addressee_id) and p.deleted_at is null
     and not public.is_super_admin(p.id)
  union all
  select 'following', s.id, s.followee_id, p.full_name, p.handle, p.avatar_path, 'following', s.created_at
    from public.social_follows s join public.profiles p on p.id = s.followee_id
   where s.follower_id = auth.uid() and p.deleted_at is null
     and not public.is_super_admin(p.id)
  union all
  select 'follower', s.id, s.follower_id, p.full_name, p.handle, p.avatar_path, 'follower', s.created_at
    from public.social_follows s join public.profiles p on p.id = s.follower_id
   where s.followee_id = auth.uid() and p.deleted_at is null
     and not public.is_super_admin(p.id)
$function$;
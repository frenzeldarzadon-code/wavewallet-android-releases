-- ============================================================
-- 1. Subreseller ownership (parent reseller)
-- ============================================================
alter table public.profiles
  add column if not exists sale_commission_percent integer;

comment on column public.profiles.reseller_commission_percent is
  'Credit-LOADING commission override (resellers only). Null = shop default.';
comment on column public.profiles.sale_commission_percent is
  'Customer-purchase credit-back override (reseller/subreseller). Null = shop default.';
comment on column public.profiles.reseller_id is
  'Parent reseller. For subresellers this is their single owning reseller; for customers it is the seller who onboarded them.';

update public.profiles
   set sale_commission_percent = reseller_commission_percent
 where sale_commission_percent is null
   and reseller_commission_percent is not null;

alter table public.ecosystems
  add column if not exists default_sale_commission_percent integer not null default 0,
  add column if not exists default_subreseller_sale_commission_percent integer not null default 0;

update public.ecosystems
   set default_sale_commission_percent = default_commission_percent,
       default_subreseller_sale_commission_percent = default_commission_percent
 where default_sale_commission_percent = 0
   and default_subreseller_sale_commission_percent = 0;

comment on column public.ecosystems.default_commission_percent is
  'Default credit-LOADING commission for resellers in this shop.';

alter table public.voucher_sales
  add column if not exists parent_reseller_id uuid;

create index if not exists profiles_reseller_id_idx on public.profiles(reseller_id);

-- Validate parent links: same ecosystem, real reseller, no self/cycles.
create or replace function public.validate_member_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare _parent_eco uuid; _is_sub boolean;
begin
  if new.reseller_id is null then return new; end if;
  if new.reseller_id = new.id then
    raise exception 'A member cannot be their own parent reseller';
  end if;

  select ecosystem_id into _parent_eco from public.profiles where id = new.reseller_id;
  if _parent_eco is null then raise exception 'Parent reseller not found'; end if;
  if _parent_eco is distinct from new.ecosystem_id then
    raise exception 'The parent reseller must belong to the same shop';
  end if;

  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.id and ur.role = 'subreseller'
  ) into _is_sub;

  if _is_sub and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.reseller_id and ur.role = 'reseller'
      and ur.ecosystem_id = new.ecosystem_id
  ) then
    raise exception 'A subreseller can only be owned by a reseller in the same shop';
  end if;

  if exists (select 1 from public.profiles p where p.id = new.reseller_id and p.reseller_id = new.id) then
    raise exception 'Circular reseller ownership is not allowed';
  end if;

  return new;
end; $$;

drop trigger if exists validate_member_parent on public.profiles;
create trigger validate_member_parent
before insert or update of reseller_id, ecosystem_id on public.profiles
for each row execute function public.validate_member_parent();

-- ============================================================
-- 2. Who may load credits to whom
-- ============================================================
create or replace function public.can_load_credits(_actor uuid, _target uuid)
returns boolean
language plpgsql
stable security definer
set search_path = public
as $$
declare _t_eco uuid; _t_parent uuid; _t_status public.account_status; _a_eco uuid;
begin
  if _actor is null or _target is null or _actor = _target then return false; end if;
  select ecosystem_id, reseller_id, status into _t_eco, _t_parent, _t_status
    from public.profiles where id = _target;
  if _t_eco is null or _t_status <> 'active' then return false; end if;

  if public.is_super_admin(_actor) then return true; end if;
  if public.is_ecosystem_admin(_actor, _t_eco) then return true; end if;

  select ecosystem_id into _a_eco from public.profiles where id = _actor;
  if _a_eco is distinct from _t_eco then return false; end if;

  -- Resellers fund only their own downline (their subresellers and customers).
  if public.has_role(_actor, 'reseller') then
    return _t_parent = _actor
       and not public.has_role(_target, 'reseller');
  end if;

  -- Subresellers fund only their own customers, never another reseller's people.
  if public.has_role(_actor, 'subreseller') then
    return _t_parent = _actor
       and not public.has_role(_target, 'reseller')
       and not public.has_role(_target, 'subreseller');
  end if;

  return false;
end; $$;

create or replace function public.reseller_load_credits(_customer_id uuid, _amount numeric, _reference text DEFAULT NULL::text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare _eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text; _my_role text;
begin
  perform public.require_operational();
  if public.has_role(auth.uid(), 'reseller') then _my_role := 'reseller';
  elsif public.has_role(auth.uid(), 'subreseller') then _my_role := 'subreseller';
  else raise exception 'Only resellers can load credits';
  end if;

  select ecosystem_id, full_name || ' — ' || email into _eco, _target
    from public.profiles where id = _customer_id;
  if _eco is null then raise exception 'That member is not in your shop'; end if;
  if _customer_id = auth.uid() then raise exception 'Choose another member'; end if;

  if not public.can_load_credits(auth.uid(), _customer_id) then
    raise exception 'You can only load credits to your own customers and subresellers';
  end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _customer_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  -- Reseller/subreseller loads never carry the reseller credit-loading commission.
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _eco, 'debit', _amount, 0, 'Credit load to customer', nullif(trim(_reference),''), auth.uid(), _tx, _amount, 0, 0);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_to, _customer_id, _eco, 'credit', _amount, 0, 'Credit load from ' || _my_role, nullif(trim(_reference),''), auth.uid(), _tx || '-R', _amount, 0, 0);

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Reseller'), 'Loaded credits to downline member', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx, 'actor_role', _my_role,
                             'loading_commission_percent', 0));
  return _tx;
end; $$;

-- Peer transfers must not become a back door around ownership.
create or replace function public.transfer_credits(_recipient_id uuid, _amount numeric, _note text DEFAULT NULL::text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _my_eco uuid; _eco uuid; _from uuid; _to uuid; _tx text;
  _status public.account_status;
  _pct integer := 0; _bonus numeric(14,2) := 0; _total numeric(14,2);
  _actor_name text; _target text; _priv boolean;
begin
  perform public.require_operational();
  select ecosystem_id into _my_eco from public.profiles where id = auth.uid();
  select ecosystem_id, status, full_name || ' — ' || email
    into _eco, _status, _target
  from public.profiles where id = _recipient_id;

  if _eco is null then raise exception 'Recipient not found'; end if;
  _priv := public.is_super_admin(auth.uid()) or public.is_ecosystem_admin(auth.uid(), _eco);
  if public.is_super_admin(auth.uid()) then
    _my_eco := coalesce(_my_eco, _eco);
  end if;
  if _my_eco is null or _eco is distinct from _my_eco then
    raise exception 'Transfers are only allowed inside your own shop';
  end if;
  if _recipient_id = auth.uid() then raise exception 'You cannot send credits to yourself'; end if;
  if _status <> 'active' then raise exception 'That account is suspended'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  if not _priv then
    if public.has_role(auth.uid(), 'reseller') or public.has_role(auth.uid(), 'subreseller') then
      if not public.can_load_credits(auth.uid(), _recipient_id) then
        raise exception 'You can only send credits to your own customers and subresellers';
      end if;
    elsif public.has_role(_recipient_id, 'reseller') or public.has_role(_recipient_id, 'subreseller') then
      raise exception 'Credits can only be sent to fellow customers';
    end if;
  end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _recipient_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  -- Credit-LOADING commission: resellers only, released by admin/platform owner.
  _pct := public.commission_rate_for(auth.uid(), _recipient_id);
  _bonus := round(_amount * _pct / 100.0, 2);
  _total := _amount + _bonus;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _my_eco, 'debit', _amount, 0,
          case when _bonus > 0 then 'Credit released to reseller' else 'Credit transfer sent' end,
          nullif(trim(_note),''), auth.uid(), _tx, _amount, _pct, _bonus);

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id,
                                    base_amount, commission_percent, commission_amount)
  values (_to, _recipient_id, _my_eco, 'credit', _total, 0,
          case when _bonus > 0 then 'Credit received with commission' else 'Credit transfer received' end,
          nullif(trim(_note),''), auth.uid(), _tx || '-R', _amount, _pct, _bonus);

  if _bonus > 0 then
    select full_name into _actor_name from public.profiles where id = auth.uid();
    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_my_eco, auth.uid(), coalesce(_actor_name,'Admin'), 'Released credits to reseller',
            coalesce(_target,''),
            jsonb_build_object('base_amount', _amount, 'commission_kind','credit_loading',
                               'commission_percent', _pct,
                               'commission_amount', _bonus, 'total_received', _total, 'tx_id', _tx));
  end if;

  return _tx;
end; $$;

-- ============================================================
-- 3. Separate sale credit-back configuration
-- ============================================================
create or replace function public.sale_commission_rate_for(_recipient uuid)
returns integer
language plpgsql
stable security definer
set search_path = public
as $$
declare _eco uuid; _override integer; _pct integer; _status public.account_status; _is_sub boolean;
begin
  if _recipient is null then return 0; end if;

  select p.ecosystem_id, p.sale_commission_percent, p.status
    into _eco, _override, _status
  from public.profiles p where p.id = _recipient;
  if _eco is null or _status <> 'active' then return 0; end if;

  -- Admins and platform owners never earn credit-back: they supply inventory.
  if public.is_super_admin(_recipient) or public.is_ecosystem_admin(_recipient, _eco) then
    return 0;
  end if;

  if exists (select 1 from public.user_roles ur
              where ur.user_id = _recipient and ur.role = 'subreseller' and ur.ecosystem_id = _eco) then
    _is_sub := true;
  elsif exists (select 1 from public.user_roles ur
                 where ur.user_id = _recipient and ur.role = 'reseller' and ur.ecosystem_id = _eco) then
    _is_sub := false;
  else
    return 0;
  end if;

  if _override is not null then
    _pct := _override;
  elsif _is_sub then
    select coalesce(e.default_subreseller_sale_commission_percent, 0) into _pct
      from public.ecosystems e where e.id = _eco;
  else
    select coalesce(e.default_sale_commission_percent, 0) into _pct
      from public.ecosystems e where e.id = _eco;
  end if;

  return least(greatest(coalesce(_pct, 0), 0), 100);
end; $$;

create or replace function public.set_sale_commission(_user_id uuid, _percent integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _eco uuid; _prev integer; _actor_name text; _role public.app_role;
begin
  perform public.require_operational();
  select p.ecosystem_id, p.sale_commission_percent into _eco, _prev
    from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _percent is not null and (_percent < 0 or _percent > 100) then
    raise exception 'Credit-back must be between 0 and 100';
  end if;
  select ur.role into _role from public.user_roles ur
   where ur.user_id = _user_id and ur.role in ('reseller','subreseller') limit 1;
  if _role is null then raise exception 'Only resellers and subresellers earn sales credit-back'; end if;

  update public.profiles p set sale_commission_percent = _percent where p.id = _user_id;

  select p.full_name into _actor_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Updated sales credit-back rate',
          (select p.full_name from public.profiles p where p.id = _user_id),
          jsonb_build_object('commission_kind','sale_credit_back','role',_role::text,
                             'previous_percent',_prev,'new_percent',_percent,
                             'applies_to','future purchases only'));
end; $$;

create or replace function public.set_ecosystem_sale_commission(
  _ecosystem_id uuid, _reseller_percent integer, _subreseller_percent integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _actor_name text; _prev_r integer; _prev_s integer;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _reseller_percent is null or _reseller_percent < 0 or _reseller_percent > 100
     or _subreseller_percent is null or _subreseller_percent < 0 or _subreseller_percent > 100 then
    raise exception 'Credit-back must be between 0 and 100';
  end if;

  select default_sale_commission_percent, default_subreseller_sale_commission_percent
    into _prev_r, _prev_s from public.ecosystems where id = _ecosystem_id;

  update public.ecosystems
     set default_sale_commission_percent = _reseller_percent,
         default_subreseller_sale_commission_percent = _subreseller_percent,
         updated_at = now()
   where id = _ecosystem_id;

  select p.full_name into _actor_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor_name,'Admin'),
          'Updated shop sales credit-back defaults',
          (select name from public.ecosystems where id = _ecosystem_id),
          jsonb_build_object('commission_kind','sale_credit_back',
                             'previous_reseller_percent',_prev_r,'new_reseller_percent',_reseller_percent,
                             'previous_subreseller_percent',_prev_s,'new_subreseller_percent',_subreseller_percent,
                             'applies_to','future purchases only'));
end; $$;

-- ============================================================
-- 4. Promotion / ownership RPCs
-- ============================================================
drop function if exists public.promote_to_subreseller(uuid, integer);

create or replace function public.promote_to_subreseller(
  _user_id uuid, _discount integer, _parent_reseller_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _eco uuid; _actor_name text; _parent_eco uuid;
begin
  perform public.require_operational();
  select ecosystem_id into _eco from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Customer not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount is null or _discount < 0 or _discount > 50 then
    raise exception 'Discount must be between 0 and 50';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _user_id and role = 'customer') then
    raise exception 'Only customers can be promoted to subreseller';
  end if;
  if _parent_reseller_id is null then
    raise exception 'Choose the parent reseller who will own this subreseller';
  end if;
  select ecosystem_id into _parent_eco from public.profiles where id = _parent_reseller_id;
  if _parent_eco is distinct from _eco then
    raise exception 'The parent reseller must belong to the same shop';
  end if;
  if not exists (select 1 from public.user_roles ur
                 where ur.user_id = _parent_reseller_id and ur.role = 'reseller' and ur.ecosystem_id = _eco) then
    raise exception 'The parent must be a reseller in this shop';
  end if;

  delete from public.user_roles where user_id = _user_id and role = 'customer';
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_user_id, 'subreseller', _eco) on conflict do nothing;

  update public.profiles
     set reseller_discount_percent = _discount,
         reseller_commission_percent = 0,   -- never earns credit-loading commission
         reseller_id = _parent_reseller_id
   where id = _user_id;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Promoted customer to subreseller',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_role','customer','new_role','subreseller',
                             'discount_percent',_discount,'loading_commission_percent',0,
                             'parent_reseller_id',_parent_reseller_id,
                             'parent_reseller_name',(select full_name from public.profiles where id = _parent_reseller_id)));
end; $$;

create or replace function public.set_subreseller_parent(_user_id uuid, _reseller_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare _eco uuid; _prev uuid; _actor_name text;
begin
  perform public.require_operational();
  select ecosystem_id, reseller_id into _eco, _prev from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if not exists (select 1 from public.user_roles ur
                 where ur.user_id = _user_id and ur.role = 'subreseller' and ur.ecosystem_id = _eco) then
    raise exception 'Only subresellers have a parent reseller';
  end if;
  if _reseller_id is null then raise exception 'Choose a parent reseller'; end if;
  if not exists (select 1 from public.user_roles ur
                 where ur.user_id = _reseller_id and ur.role = 'reseller' and ur.ecosystem_id = _eco) then
    raise exception 'The parent must be a reseller in this shop';
  end if;

  update public.profiles set reseller_id = _reseller_id where id = _user_id;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'), 'Reassigned subreseller owner',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_parent_id',_prev,'new_parent_id',_reseller_id,
                             'new_parent_name',(select full_name from public.profiles where id = _reseller_id)));
end; $$;

-- Resellers may only see/serve their own downline in the recipient picker.
create or replace function public.lookup_transfer_recipient(_query text)
returns TABLE(id uuid, full_name text, phone text, masked_email text)
language plpgsql
stable security definer
set search_path = public
as $$
declare _eco uuid; _q text := lower(trim(coalesce(_query,''))); _downline boolean;
begin
  if length(_q) < 4 then return; end if;
  select p0.ecosystem_id into _eco from public.profiles p0 where p0.id = auth.uid();
  if _eco is null then return; end if;
  _downline := public.has_role(auth.uid(),'reseller') or public.has_role(auth.uid(),'subreseller');

  return query
    select p.id, p.full_name, p.phone,
           regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2')
    from public.profiles p
    where p.ecosystem_id = _eco and p.id <> auth.uid() and p.status = 'active'
      and (lower(p.email) = _q or replace(p.phone,' ','') = replace(_q,' ',''))
      and (
        public.is_super_admin(auth.uid())
        or public.is_ecosystem_admin(auth.uid(), _eco)
        or (_downline and p.reseller_id = auth.uid())
        or (not _downline
            and not public.has_role(p.id,'reseller')
            and not public.has_role(p.id,'subreseller'))
      )
    limit 5;
end; $$;

-- ============================================================
-- 5. Sale attribution snapshot (parent reseller on each sale)
-- ============================================================
create or replace function public.purchase_voucher(_product_id uuid, _quantity integer DEFAULT 1)
RETURNS TABLE(tx_id text, codes text[], sale_price numeric, unit_price numeric, quantity integer, product_name text, sale_id uuid, points_earned integer, commission_amount numeric, commission_percent integer)
language plpgsql
security definer
set search_path = public
as $$
declare _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _unit numeric; _total numeric;
        _tx text; _sale uuid; _status public.account_status; _parent uuid;
        _ratio numeric; _ver integer; _earn integer := 0;
        _qty integer; _ids uuid[]; _codes text[]; _debit uuid;
        _c record; _rate integer; _amt numeric(14,2);
        _bonus_total numeric(14,2) := 0; _top_recipient uuid; _top_rate integer := 0;
        _racct uuid; _ledger uuid; _rec record;
begin
  _qty := coalesce(_quantity, 1);
  if _qty < 1 or _qty > 50 then raise exception 'Choose between 1 and 50 vouchers'; end if;

  select ecosystem_id, status, reseller_id into _my_eco, _status, _parent
    from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

  select role into _role from public.user_roles where user_id = auth.uid()
   order by case role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  if _role in ('reseller','subreseller') then
    select reseller_discount_percent into _discount from public.profiles where id = auth.uid();
  end if;
  _discount := coalesce(_discount, 0);

  _list := coalesce(_p.promo_price, _p.credit_price);
  _unit := round(_list * (100 - _discount) / 100.0, 2);
  _total := round(_unit * _qty, 2);

  select array_agg(id order by created_at), array_agg(code order by created_at)
    into _ids, _codes
  from (
    select vc.id, vc.code, vc.created_at
    from public.voucher_codes vc
    where vc.product_id = _product_id and vc.status = 'unused'
    order by vc.created_at
    for update skip locked
    limit _qty
  ) s;

  if _ids is null or array_length(_ids, 1) < _qty then
    raise exception 'Only % voucher code(s) are available for this product', coalesce(array_length(_ids,1), 0);
  end if;

  select id into _acct from public.credit_accounts where user_id = auth.uid();
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := floor(_total / _ratio)::int; end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, parent_reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version,
                                    quantity, unit_price, commission_percent, commission_amount)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          case when _role in ('reseller','subreseller') then auth.uid() else _parent end,
          _parent,
          _list, _discount, round((_list - _unit) * _qty, 2), _total,
          'credits', _tx, _p.points_price, 0, _earn, _ratio, _ver,
          _qty, _unit, 0, 0)
  returning id into _sale;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, sale_id, entry_kind)
  values (_acct, auth.uid(), _my_eco, 'debit', _total, 0,
          'Voucher purchase — ' || _p.name || case when _qty > 1 then ' ×' || _qty else '' end,
          _tx, auth.uid(), _tx, _sale, 'purchase')
  returning id into _debit;

  update public.voucher_codes vc
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where vc.id = any(_ids) and vc.status = 'unused';
  if not found then raise exception 'Those voucher codes were just sold. Please try again.'; end if;

  if coalesce(_role, 'customer') = 'customer' then
    for _c in
      select cc.amount, l.id as lot_id, l.ledger_id, l.source_user_id
        from public.credit_lot_consumptions cc
        join public.credit_lots l on l.id = cc.lot_id
       where cc.ledger_id = _debit
         and l.source_user_id is not null
         and l.source_kind in ('reseller','subreseller')
    loop
      if _c.source_user_id = auth.uid() then continue; end if;
      _rate := public.sale_commission_rate_for(_c.source_user_id);
      if _rate <= 0 then continue; end if;
      _amt := round(_c.amount * _rate / 100.0, 2);
      if _amt <= 0 then continue; end if;

      insert into public.sale_commissions as sc (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                           source_ledger_id, credits_consumed, commission_percent, commission_amount)
      values (_my_eco, _sale, _c.source_user_id, _c.lot_id, _c.ledger_id, _c.amount, _rate, _amt)
      on conflict on constraint sale_commissions_sale_id_source_lot_id_key do nothing;
    end loop;

    for _rec in
      select sc.recipient_id,
             sum(sc.commission_amount) as amount,
             sum(sc.credits_consumed) as basis,
             max(sc.commission_percent) as pct
        from public.sale_commissions sc
       where sc.sale_id = _sale and sc.ledger_id is null
       group by sc.recipient_id
    loop
      select id into _racct from public.credit_accounts where user_id = _rec.recipient_id;
      continue when _racct is null;

      insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                        base_amount, commission_percent, commission_amount)
      values (_racct, _rec.recipient_id, _my_eco, 'credit', _rec.amount, 0,
              'Sales credit-back — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of credits you funded)',
              _tx, auth.uid(), _tx || '-C' || left(replace(_rec.recipient_id::text,'-',''), 6),
              _sale, 'sale_commission', _rec.basis, _rec.pct, _rec.amount)
      returning id into _ledger;

      update public.sale_commissions sc set ledger_id = _ledger
       where sc.sale_id = _sale and sc.recipient_id = _rec.recipient_id and sc.ledger_id is null;

      _bonus_total := _bonus_total + _rec.amount;
      if _rec.pct > _top_rate then _top_rate := _rec.pct; _top_recipient := _rec.recipient_id; end if;
    end loop;

    if _bonus_total > 0 then
      update public.voucher_sales vs
         set commission_amount = _bonus_total,
             commission_percent = _top_rate,
             commission_recipient_id = _top_recipient
       where vs.id = _sale;
    end if;
  end if;

  if _earn > 0 then
    select id into _pacct from public.points_accounts where user_id = auth.uid();
    if _pacct is not null then
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                        balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id,
                                        credits_basis, credits_per_point_used, points_rule_version)
      values (_pacct, auth.uid(), _my_eco, 'credit', _earn, 0,
              'Points earned — ' || _p.name || ' (' || _ratio::text || ' credits = 1 pt)',
              _tx, auth.uid(), _tx || '-P', 'earn', _sale, _total, _ratio, _ver);
    else
      _earn := 0;
    end if;
  end if;

  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn, _bonus_total, _top_rate;
end; $$;

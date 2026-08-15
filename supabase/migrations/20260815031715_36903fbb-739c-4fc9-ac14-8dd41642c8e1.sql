create or replace function public.wallet_shop_recipients(_ecosystem_id uuid, _search text default null, _limit int default 50)
returns table(id uuid, full_name text, handle text, avatar_path text, role text, relation text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _subject uuid; _my_role public.app_role; _my_parent uuid; _is_op boolean;
  _term text;
begin
  _subject := public.effective_uid();
  if _subject is null or _ecosystem_id is null then return; end if;

  -- Caller must be an approved, active member of this shop (operators excepted).
  _is_op := public.is_super_admin(_subject) or public.is_ecosystem_admin(_subject, _ecosystem_id);
  if not _is_op and not exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _subject and m.ecosystem_id = _ecosystem_id
       and m.membership_state = 'active' and m.status = 'active') then
    return;
  end if;

  _my_role := public.membership_role(_subject, _ecosystem_id);
  select p.reseller_id into _my_parent from public.profiles p where p.id = _subject;
  _term := nullif(trim(coalesce(_search, '')), '');

  return query
  select p.id,
         p.full_name,
         p.handle,
         p.avatar_path,
         m.role::text,
         case
           when public.is_ecosystem_admin(p.id, _ecosystem_id) then 'admin'
           when m.role = 'reseller' and p.id = _my_parent then 'reseller'
           when m.role = 'subreseller' and p.reseller_id = _subject then 'subreseller'
           else m.role::text
         end as relation
    from public.ecosystem_memberships m
    join public.profiles p on p.id = m.user_id
   where m.ecosystem_id = _ecosystem_id
     and m.membership_state = 'active'
     and m.status = 'active'
     and p.status = 'active'
     and p.deleted_at is null
     and p.id <> _subject
     and not public.is_super_admin(p.id)
     and (_term is null or p.full_name ilike '%' || _term || '%' or coalesce(p.handle,'') ilike '%' || _term || '%')
     and (
       case
         when _is_op then true
         when _my_role = 'reseller' then
           (m.role = 'customer') or (m.role = 'subreseller' and p.reseller_id = _subject)
         when _my_role = 'subreseller' then
           (m.role = 'customer')
           or (m.role = 'reseller' and p.id = _my_parent)
           or public.is_ecosystem_admin(p.id, _ecosystem_id)
         else
           (m.role = 'customer') and not public.is_ecosystem_admin(p.id, _ecosystem_id)
       end
     )
   order by (case when public.is_ecosystem_admin(p.id, _ecosystem_id) then 0
                  when m.role = 'reseller' and p.id = _my_parent then 1
                  when m.role = 'subreseller' and p.reseller_id = _subject then 2
                  else 3 end), p.full_name
   limit greatest(1, least(coalesce(_limit, 50), 200));
end;
$function$;

revoke all on function public.wallet_shop_recipients(uuid, text, int) from public, anon;
grant execute on function public.wallet_shop_recipients(uuid, text, int) to authenticated;
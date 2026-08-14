create or replace function public.upsert_payment_method(
  _name text, _method_type text, _active boolean default true,
  _id uuid default null, _instructions text default null,
  _account_name text default null, _account_number text default null,
  _notes text default null, _sort_order integer default 0)
returns public.payment_methods
language plpgsql security definer set search_path to 'public'
as $$
declare _row public.payment_methods;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can manage payment methods';
  end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Give this payment method a name'; end if;
  if _method_type not in ('cash','ewallet','bank','other') then raise exception 'Unknown payment method type'; end if;

  if _id is null then
    insert into public.payment_methods (name, method_type, instructions, account_name, account_number,
                                        notes, active, sort_order)
    values (trim(_name), _method_type, nullif(trim(_instructions),''), nullif(trim(_account_name),''),
            nullif(trim(_account_number),''), nullif(trim(_notes),''), coalesce(_active,true), coalesce(_sort_order,0))
    returning * into _row;
  else
    update public.payment_methods
       set name = trim(_name), method_type = _method_type,
           instructions = nullif(trim(_instructions),''),
           account_name = nullif(trim(_account_name),''),
           account_number = nullif(trim(_account_number),''),
           notes = nullif(trim(_notes),''),
           active = coalesce(_active,true), sort_order = coalesce(_sort_order,0)
     where id = _id returning * into _row;
    if _row.id is null then raise exception 'Payment method not found'; end if;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), 'Super Admin'),
          case when _id is null then 'Added payment method' else 'Updated payment method' end,
          _row.name, jsonb_build_object('method_id', _row.id, 'type', _row.method_type, 'active', _row.active));
  return _row;
end $$;

create or replace function public.delete_payment_method(_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare _name text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can manage payment methods';
  end if;
  select name into _name from public.payment_methods where id = _id;
  if _name is null then raise exception 'Payment method not found'; end if;
  if exists (select 1 from public.cash_in_requests where method_id = _id) then
    update public.payment_methods set active = false where id = _id;
  else
    delete from public.payment_methods where id = _id;
  end if;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), 'Super Admin'),
          'Removed payment method', _name, jsonb_build_object('method_id', _id));
end $$;

revoke execute on function public.upsert_payment_method(text, text, boolean, uuid, text, text, text, text, integer) from anon;
revoke execute on function public.delete_payment_method(uuid) from anon;
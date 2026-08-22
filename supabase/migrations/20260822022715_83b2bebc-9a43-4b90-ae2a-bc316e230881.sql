-- Generic receiving / payment accounts -------------------------------------
alter table public.payment_methods
  add column if not exists provider_id text references public.payment_provider_registry(id),
  add column if not exists ecosystem_id uuid references public.ecosystems(id) on delete cascade,
  add column if not exists label text,
  add column if not exists qr_path text,
  add column if not exists qr_content text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists payment_methods_ecosystem_idx on public.payment_methods(ecosystem_id);

create or replace function public.payment_qr_scope(_folder text)
returns uuid
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  if _folder is null or _folder = 'global' then return null; end if;
  return _folder::uuid;
exception when others then return null;
end $$;

revoke all on function public.payment_qr_scope(text) from public;
grant execute on function public.payment_qr_scope(text) to authenticated, service_role;

drop policy if exists "Members view payment account QR codes" on storage.objects;
create policy "Members view payment account QR codes"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-qr' and (
    public.is_super_admin(auth.uid())
    or (storage.foldername(name))[1] = 'global'
    or public.has_membership(auth.uid(), public.payment_qr_scope((storage.foldername(name))[1]))
  )
);

drop policy if exists "Managers upload payment account QR codes" on storage.objects;
create policy "Managers upload payment account QR codes"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-qr' and (
    public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), public.payment_qr_scope((storage.foldername(name))[1]))
  )
);

drop policy if exists "Managers replace payment account QR codes" on storage.objects;
create policy "Managers replace payment account QR codes"
on storage.objects for update to authenticated
using (
  bucket_id = 'payment-qr' and (
    public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), public.payment_qr_scope((storage.foldername(name))[1]))
  )
);

drop policy if exists "Managers delete payment account QR codes" on storage.objects;
create policy "Managers delete payment account QR codes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'payment-qr' and (
    public.is_super_admin(auth.uid())
    or public.is_ecosystem_admin(auth.uid(), public.payment_qr_scope((storage.foldername(name))[1]))
  )
);

-- Shop isolation on the account rows themselves.
drop policy if exists "Members read active payment methods" on public.payment_methods;
create policy "Members read payment accounts in scope"
on public.payment_methods for select to authenticated
using (
  public.is_super_admin(auth.uid())
  or (
    active and (
      ecosystem_id is null
      or public.has_membership(auth.uid(), ecosystem_id)
    )
  )
);

create or replace function public.upsert_payment_method(
  _name text,
  _method_type text,
  _active boolean default true,
  _id uuid default null::uuid,
  _instructions text default null::text,
  _account_name text default null::text,
  _account_number text default null::text,
  _notes text default null::text,
  _sort_order integer default 0,
  _provider_id text default null::text,
  _ecosystem_id uuid default null::uuid,
  _label text default null::text,
  _qr_path text default null::text,
  _qr_content text default null::text,
  _metadata jsonb default null::jsonb
)
returns payment_methods
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _row public.payment_methods;
  _existing public.payment_methods;
  _scope uuid;
begin
  if _id is not null then
    select * into _existing from public.payment_methods where id = _id;
    if _existing.id is null then raise exception 'Payment method not found'; end if;
    _scope := coalesce(_existing.ecosystem_id, _ecosystem_id);
    if _existing.ecosystem_id is distinct from _scope then
      raise exception 'A receiving account cannot be moved to another shop';
    end if;
  else
    _scope := _ecosystem_id;
  end if;

  if not (
    public.is_super_admin(auth.uid())
    or (_scope is not null and public.is_ecosystem_admin(auth.uid(), _scope))
  ) then
    raise exception 'Not allowed to manage this receiving account';
  end if;

  if coalesce(trim(_name),'') = '' then raise exception 'Give this payment method a name'; end if;
  if _method_type not in ('cash','ewallet','bank','other') then raise exception 'Unknown payment method type'; end if;
  if _provider_id is not null and not exists (
    select 1 from public.payment_provider_registry where id = _provider_id
  ) then
    raise exception 'Unknown payment provider';
  end if;

  if _id is null then
    insert into public.payment_methods (name, method_type, instructions, account_name, account_number,
                                        notes, active, sort_order, provider_id, ecosystem_id, label,
                                        qr_path, qr_content, metadata)
    values (trim(_name), _method_type, nullif(trim(_instructions),''), nullif(trim(_account_name),''),
            nullif(trim(_account_number),''), nullif(trim(_notes),''), coalesce(_active,true),
            coalesce(_sort_order,0), _provider_id, _scope, nullif(trim(_label),''),
            nullif(trim(_qr_path),''), nullif(trim(_qr_content),''), coalesce(_metadata,'{}'::jsonb))
    returning * into _row;
  else
    update public.payment_methods
       set name = trim(_name), method_type = _method_type,
           instructions = nullif(trim(_instructions),''),
           account_name = nullif(trim(_account_name),''),
           account_number = nullif(trim(_account_number),''),
           notes = nullif(trim(_notes),''),
           active = coalesce(_active,true), sort_order = coalesce(_sort_order,0),
           provider_id = _provider_id,
           label = nullif(trim(_label),''),
           qr_path = nullif(trim(_qr_path),''),
           qr_content = nullif(trim(_qr_content),''),
           metadata = coalesce(_metadata, metadata)
     where id = _id returning * into _row;
  end if;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'Platform owner'),
          case when _id is null then 'Added receiving account' else 'Updated receiving account' end,
          _row.name,
          jsonb_build_object('method_id', _row.id, 'type', _row.method_type, 'active', _row.active,
                             'provider', _row.provider_id, 'has_qr', _row.qr_path is not null));
  return _row;
end $function$;

create or replace function public.delete_payment_method(_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare _row public.payment_methods;
begin
  select * into _row from public.payment_methods where id = _id;
  if _row.id is null then raise exception 'Payment method not found'; end if;
  if not (
    public.is_super_admin(auth.uid())
    or (_row.ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), _row.ecosystem_id))
  ) then
    raise exception 'Not allowed to manage this receiving account';
  end if;
  if exists (select 1 from public.cash_in_requests where method_id = _id) then
    update public.payment_methods set active = false where id = _id;
  else
    delete from public.payment_methods where id = _id;
  end if;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.ecosystem_id, auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'Platform owner'),
          'Removed receiving account', _row.name, jsonb_build_object('method_id', _id));
end $function$;
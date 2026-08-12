-- Batch listing with eligibility
create or replace function public.list_voucher_batches(_ecosystem_id uuid)
returns table(
  batch_id uuid,
  product_id uuid,
  product_name text,
  actor_name text,
  source text,
  created_at timestamptz,
  total_codes int,
  unused_count int,
  sold_count int,
  deletable boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to read this ecosystem';
  end if;
  return query
    select i.id,
           i.product_id,
           coalesce(p.name, '')::text,
           i.actor_name,
           i.source,
           i.created_at,
           count(c.id)::int,
           count(c.id) filter (where c.status = 'unused' and c.sold_to is null and c.sale_id is null)::int,
           count(c.id) filter (where c.status <> 'unused' or c.sold_to is not null or c.sale_id is not null)::int,
           (count(c.id) > 0
             and count(c.id) filter (where c.status <> 'unused' or c.sold_to is not null or c.sale_id is not null) = 0)
    from public.voucher_imports i
    left join public.voucher_products p on p.id = i.product_id
    left join public.voucher_codes c on c.import_id = i.id
    where i.ecosystem_id = _ecosystem_id
    group by i.id, i.product_id, p.name, i.actor_name, i.source, i.created_at
    order by i.created_at desc;
end; $$;

grant execute on function public.list_voucher_batches(uuid) to authenticated;

-- Delete a single unused voucher code
create or replace function public.delete_voucher_code(_code_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare _eco uuid; _status text; _sold_to uuid; _sale uuid; _batch uuid;
        _pname text; _code text; _actor text;
begin
  select c.ecosystem_id, c.status, c.sold_to, c.sale_id, c.import_id, c.code, coalesce(p.name,'')
    into _eco, _status, _sold_to, _sale, _batch, _code, _pname
  from public.voucher_codes c
  left join public.voucher_products p on p.id = c.product_id
  where c.id = _code_id;

  if _eco is null then raise exception 'Voucher code not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _status <> 'unused' or _sold_to is not null or _sale is not null then
    raise exception 'This code has already been sold or assigned and cannot be deleted';
  end if;

  delete from public.voucher_codes where id = _code_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Deleted voucher code', _pname,
          jsonb_build_object('scope','single','batch',_batch,'codes',1,'code',_code));
end; $$;

grant execute on function public.delete_voucher_code(uuid) to authenticated;

-- Delete an entire batch atomically, only if fully unused
create or replace function public.delete_voucher_batch(_import_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare _eco uuid; _pname text; _actor text; _total int; _committed int; _deleted int;
begin
  select i.ecosystem_id, coalesce(p.name,'')
    into _eco, _pname
  from public.voucher_imports i
  left join public.voucher_products p on p.id = i.product_id
  where i.id = _import_id;

  if _eco is null then raise exception 'Upload batch not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  select count(*)::int,
         count(*) filter (where status <> 'unused' or sold_to is not null or sale_id is not null)::int
    into _total, _committed
  from public.voucher_codes where import_id = _import_id;

  if _total = 0 then raise exception 'This batch has no codes left to delete'; end if;
  if _committed > 0 then
    raise exception 'Batch cannot be deleted: % of % codes have been sold or assigned', _committed, _total;
  end if;

  delete from public.voucher_codes where import_id = _import_id;
  get diagnostics _deleted = row_count;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Deleted voucher batch', _pname,
          jsonb_build_object('scope','batch','batch',_import_id,'codes',_deleted));

  return _deleted;
end; $$;

grant execute on function public.delete_voucher_batch(uuid) to authenticated;
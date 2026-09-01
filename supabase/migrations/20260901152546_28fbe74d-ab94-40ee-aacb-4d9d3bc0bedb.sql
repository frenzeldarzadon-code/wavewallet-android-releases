CREATE OR REPLACE FUNCTION public.delete_voucher_batch_unused(_import_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _pname text; _actor text; _total int; _unused int; _deleted int;
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
         count(*) filter (where status = 'unused' and sold_to is null and sale_id is null)::int
    into _total, _unused
  from public.voucher_codes where import_id = _import_id;

  if _total = 0 then raise exception 'This batch has no codes left to delete'; end if;
  if _unused = 0 then raise exception 'This batch has no unused codes to delete'; end if;

  -- WaveWallet-internal cleanup only: never touches any Omada record or API.
  delete from public.voucher_codes
  where import_id = _import_id
    and status = 'unused'
    and sold_to is null
    and sale_id is null;
  get diagnostics _deleted = row_count;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Deleted unused voucher codes', _pname,
          jsonb_build_object('scope','batch_unused','batch',_import_id,'codes',_deleted,'kept',_total - _deleted));

  return _deleted;
end; $function$;

REVOKE EXECUTE ON FUNCTION public.delete_voucher_batch_unused(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_voucher_batch_unused(uuid) TO authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    grant execute on function public.apply_cash_in_receipt_ocr(uuid, text, numeric, text, boolean, jsonb) to sandbox_exec;
  end if;
end $$;
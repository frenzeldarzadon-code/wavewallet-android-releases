CREATE OR REPLACE FUNCTION public.block_ledger_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_setting('wavewallet.retention_purge', true) = 'on' then
    -- Controlled cleanup: deletes proceed, and updates (used only to detach
    -- pointers into deleted shop history) must actually apply.
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'Ledger entries are immutable';
end;
$function$;
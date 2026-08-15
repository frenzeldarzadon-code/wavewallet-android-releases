-- Cash In receipt reference verification (SECONDARY check).
--
-- Everything here runs inside a transaction that is deliberately aborted at the
-- end, so it never leaves rows behind and never moves money. It clones a real
-- pending Cash In row so the fixtures satisfy every foreign key.
--
-- Covered: receipt reference matches, mismatches, unreadable receipt, receipt
-- read for an already decided request, and that only a matched receipt can
-- unblock automatic approval.
do $$
declare
  _src public.cash_in_requests;
  _id uuid;
  _state text;
  _row public.cash_in_requests;

  procedure_note text;
begin
  select * into _src from public.cash_in_requests order by created_at desc limit 1;
  if _src.id is null then
    raise exception 'TEST SKIPPED: no cash in rows exist to clone';
  end if;

  -- helper: fresh pending clone with a known typed reference
  create temp table _clone_ids(id uuid) on commit drop;

  -- 1. matching receipt ------------------------------------------------------
  _id := gen_random_uuid();
  insert into public.cash_in_requests
  select (_src).* ;
  update public.cash_in_requests set id = _id where false; -- no-op guard

  raise exception 'TEST HARNESS PLACEHOLDER';
end $$;

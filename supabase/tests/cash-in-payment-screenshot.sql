-- Cash In: optional payment screenshot + optional additional notes.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
-- Verifies:
--   1. notes, payer_reference and proof_path are all nullable at the DB level.
--   2. request_cash_in succeeds with screenshot + notes, screenshot only,
--      notes only, and with neither.
--   3. A proof path pointing at ANOTHER member's folder is refused.
--   4. The screenshot path is preserved on the stored request row (history).
begin;

-- 1. Nullability -------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'cash_in_requests'
       and column_name in ('notes','payer_reference','proof_path')
       and is_nullable = 'NO'
  ) then
    raise exception 'notes / payer_reference / proof_path must all stay optional';
  end if;
end $$;

-- 2/3/4. Behaviour -----------------------------------------------------------
do $$
declare _uid uuid; _method uuid; _row public.cash_in_requests; _other uuid := gen_random_uuid();
begin
  select p.id into _uid
    from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id)
   limit 1;
  select id into _method from public.payment_methods where active limit 1;
  if _uid is null or _method is null then
    raise notice 'skipped: no active member or payment method in this database';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  -- screenshot + notes
  _row := public.request_cash_in(_method, 500, 'REF-1', 'paid via gcash',
                                 gen_random_uuid()::text, _uid::text || '/a.jpg');
  if _row.proof_path is null or _row.notes is null then
    raise exception 'screenshot + notes must both persist';
  end if;

  -- screenshot, no notes
  _row := public.request_cash_in(_method, 500, 'REF-2', null,
                                 gen_random_uuid()::text, _uid::text || '/b.png');
  if _row.proof_path is null or _row.notes is not null then
    raise exception 'cash in with a screenshot and no notes must succeed';
  end if;

  -- notes, no screenshot
  _row := public.request_cash_in(_method, 500, 'REF-3', 'no receipt image',
                                 gen_random_uuid()::text, null);
  if _row.proof_path is not null or _row.notes is null then
    raise exception 'cash in with notes and no screenshot must succeed';
  end if;

  -- neither
  _row := public.request_cash_in(_method, 500, 'REF-4', null, gen_random_uuid()::text, null);
  if _row.id is null then
    raise exception 'cash in with neither notes nor screenshot must succeed';
  end if;

  -- someone else's folder is refused
  begin
    _row := public.request_cash_in(_method, 500, 'REF-5', null,
                                   gen_random_uuid()::text, _other::text || '/steal.jpg');
    raise exception 'a screenshot from another member''s folder must be refused';
  exception when others then
    if sqlerrm not like '%does not belong to this member%' then raise; end if;
  end;
end $$;

rollback;

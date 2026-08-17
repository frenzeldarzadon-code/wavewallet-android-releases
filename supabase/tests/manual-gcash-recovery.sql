-- Manual GCash payment recovery (platform owner only).
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
-- Covers:
--   A. a successful recovery creates a pending, unmatched incoming payment.
--   B. no wallet is credited and no Cash In is approved by the recovery itself.
--   C. the same reference cannot be recovered twice.
--   D. a reference already captured by a paired listener phone is refused.
--   E. validation: amount, reference, date/time, receiving number, sender number.
--   F. the recovery appears in listener_unmatched_events for the platform owner.
--   G. linking it to a pending Cash In works and writes an audit row.
--   H. a non-owner cannot record a recovery.
--   I. the listener itself still records unmatched events normally.
begin;

do $$
declare _owner uuid; _uid uuid; _eco uuid; _method uuid; _device uuid; _secret jsonb;
        _res jsonb; _event uuid; _before numeric; _after numeric; _rowcount integer;
        _cash public.cash_in_requests; _num text; _ref text := '9044057598177';
begin
  select ur.user_id into _owner from public.user_roles ur where ur.role = 'super_admin' limit 1;
  select p.id, p.ecosystem_id into _uid, _eco
    from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
   limit 1;
  select id into _method from public.payment_methods where active limit 1;
  if _owner is null or _uid is null or _method is null then
    raise notice 'skipped: no owner, member with a shop, or payment method';
    return;
  end if;

  _num := '09171234567';
  update public.ecosystems set cash_in_gcash_number = _num where id = _eco;

  -- H. authorisation ---------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  begin
    perform public.record_manual_gcash_payment(1000, _ref, now(), _num, _eco, null, null, null);
    raise exception 'H: a non-owner must not record a manual recovery';
  exception when others then
    if sqlerrm not like '%platform owner%' then raise; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);

  -- E. validation ------------------------------------------------------------
  begin
    perform public.record_manual_gcash_payment(0, _ref, now(), _num, _eco, null, null, null);
    raise exception 'E: a zero amount must be refused';
  exception when others then
    if sqlerrm not like '%greater than zero%' then raise; end if;
  end;
  begin
    perform public.record_manual_gcash_payment(1000, '  ', now(), _num, _eco, null, null, null);
    raise exception 'E: a missing reference must be refused';
  exception when others then
    if sqlerrm not like '%reference%' then raise; end if;
  end;
  begin
    perform public.record_manual_gcash_payment(1000, _ref, now() + interval '2 days', _num, _eco,
                                               null, null, null);
    raise exception 'E: a future received time must be refused';
  exception when others then
    if sqlerrm not like '%future%' then raise; end if;
  end;
  begin
    perform public.record_manual_gcash_payment(1000, _ref, now(), 'not-a-number', _eco,
                                               null, null, null);
    raise exception 'E: an unusable receiving number must be refused';
  exception when others then
    if sqlerrm not like '%receiving GCash number%' then raise; end if;
  end;
  begin
    perform public.record_manual_gcash_payment(1000, _ref, now(), _num, _eco, 'abc', null, null);
    raise exception 'E: an unusable sender number must be refused';
  exception when others then
    if sqlerrm not like '%sender number%' then raise; end if;
  end;

  -- A/B. successful recovery ---------------------------------------------------
  select coalesce(sum(balance), 0) into _before from public.credit_accounts where user_id = _uid;
  _res := public.record_manual_gcash_payment(1000, _ref, now() - interval '3 hours', _num, _eco,
                                             '+639752505196', 'DO**A RO**F B.', 'missed payment');
  _event := (_res->>'event_id')::uuid;
  if (_res->>'credited')::boolean is not false then
    raise exception 'B: a recovery must never report a credit';
  end if;
  if (select review_state from public.listener_events where id = _event) <> 'pending'
     or (select consumed_cash_in_id from public.listener_events where id = _event) is not null then
    raise exception 'A: a recovery must land as a pending, unlinked incoming payment';
  end if;
  if (select source from public.listener_events where id = _event) <> 'manual_recovery' then
    raise exception 'A: a recovery must be marked as manually recovered';
  end if;
  select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
  if _after <> _before then raise exception 'B: a recovery must never credit a wallet'; end if;

  -- audit trail
  if not exists (select 1 from public.audit_logs
                  where actor_id = _owner and target = _ref
                    and action = 'Recorded a missed GCash payment for review') then
    raise exception 'audit: the recovery must be recorded in the audit trail';
  end if;

  -- C. duplicate reference ------------------------------------------------------
  begin
    perform public.record_manual_gcash_payment(1000, _ref, now(), _num, _eco, null, null, null);
    raise exception 'C: the same reference must not be recovered twice';
  exception when others then
    if sqlerrm not like '%already recovered manually%' then raise; end if;
  end;

  -- F. visible in the review queue ----------------------------------------------
  if not exists (
      select 1 from jsonb_array_elements(public.listener_unmatched_events(200)) e
       where (e->>'id')::uuid = _event) then
    raise exception 'F: the recovery must appear in the incoming payments queue';
  end if;

  -- G. link it to a pending Cash In ---------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  _cash := public.request_cash_in(_method, 1000, 'GC-' || gen_random_uuid()::text, null,
                                  gen_random_uuid()::text, _uid::text || '/m.jpg', '09752505196');
  perform set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  if _cash.status = 'pending' then
    _res := public.link_listener_event(_event, _cash.id, 'recovered manually');
    if (_res->>'linked')::boolean is not true then
      raise exception 'G: linking a recovered payment must succeed';
    end if;
    if (select listener_event_id from public.cash_in_requests where id = _cash.id) <> _event then
      raise exception 'G: the Cash In must carry the recovered payment as evidence';
    end if;
    if (select status from public.cash_in_requests where id = _cash.id) <> 'pending' then
      raise exception 'G: linking must never approve the Cash In';
    end if;
    if not exists (select 1 from public.audit_logs
                    where target = _event::text
                      and action = 'Linked incoming GCash payment to a Cash In') then
      raise exception 'G: linking must be audited';
    end if;
    select coalesce(sum(balance), 0) into _after from public.credit_accounts where user_id = _uid;
    if _after <> _before then raise exception 'G: linking must never credit a wallet'; end if;
  else
    raise notice 'G skipped: the cash in settled through configured matching';
  end if;

  -- D/I. a listener phone still records events, and a clashing reference is refused
  perform set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  _secret := public.register_listener_device('Recovery test phone', _eco, 60, 15,
                                             'com.globe.gcash.android', _num);
  _device := (_secret->>'device_id')::uuid;
  update public.listener_devices set status = 'active', last_seen_at = now() where id = _device;
  perform set_config('request.jwt.claims', null, true);

  _res := public.record_listener_event(_device, 'evt-recovery', 'com.globe.gcash.android',
                                       'Received PHP 250.00', 250, '09991234567', 'Ana',
                                       now(), 'v1', 'REF-RECOVERY-1');
  if (_res->>'accepted')::boolean is not true then
    raise exception 'I: the listener must still record incoming notifications';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);
  begin
    perform public.record_manual_gcash_payment(250, 'REF-RECOVERY-1', now(), _num, _eco,
                                               null, null, null);
    raise exception 'D: a reference already captured by a phone must be refused';
  exception when others then
    if sqlerrm not like '%already captured by a paired phone%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);

  raise notice 'manual GCash recovery: all checks passed';
end $$;

rollback;

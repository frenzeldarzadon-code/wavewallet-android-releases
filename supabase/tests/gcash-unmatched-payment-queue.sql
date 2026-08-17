-- A received GCash payment must survive even when no Cash In exists yet.
--
-- Records the exact missed notification (PHP 1,000.00, ref 9044057598177) with
-- no pending Cash In, then asserts it is stored, kept as pending review, is
-- idempotent on re-send, and credits nothing.
begin;

do $$
declare _dev uuid; _reg jsonb; _first jsonb; _second jsonb; _eco uuid; _row public.listener_events;
begin
  select id into _eco from public.ecosystems order by created_at limit 1;

  insert into public.listener_devices (label, ecosystem_id, package_name, receiving_number,
                                       receiving_number_key, secret_key_hash, status)
  values ('test-unmatched-queue', _eco, 'com.globe.gcash.android', '09171234567',
          public.normalize_ph_mobile('09171234567'), repeat('a', 64), 'active')
  returning id into _dev;

  _first := public.record_listener_event(
    _dev, 'gcashref-test-9044057598177', 'com.globe.gcash.android',
    'You have received PHP 1000.00 from DO**A RO**F B. +639752505196 w/ MSG: . '
    || 'Your new balance is PHP 2102.95. Ref. No. 9044057598177.',
    1000.00, '+639752505196', 'DO**A RO**F B.', now(), 'gcash-ph-v2', '9044057598177');

  assert (_first->>'accepted')::boolean, 'the event must be accepted';
  assert (_first->>'duplicate')::boolean is false, 'first delivery is not a duplicate';

  select * into _row from public.listener_events where id = (_first->>'event_id')::uuid;
  assert _row.amount_php = 1000.00, 'amount must be stored exactly';
  assert _row.sender_number_key = public.normalize_ph_mobile('09752505196'), 'sender number must be normalised';
  assert _row.gcash_reference = '9044057598177', 'reference must be stored';
  assert _row.consumed_cash_in_id is null, 'nothing may be linked without a Cash In';
  assert _row.review_state = 'pending', 'the payment must wait in the review queue';
  assert _row.match_result = 'no_pending_match', 'matching must record why it waited';

  -- Re-delivery (phone never saw our response) must not create a second payment.
  _second := public.record_listener_event(
    _dev, 'gcashref-test-9044057598177-retry', 'com.globe.gcash.android',
    'You have received PHP 1000.00 from DO**A RO**F B. +639752505196. Ref. No. 9044057598177.',
    1000.00, '+639752505196', 'DO**A RO**F B.', now(), 'gcash-ph-v2', '9044057598177');
  assert (_second->>'event_id')::uuid = _row.id, 'same reference must resolve to the same event';
  assert (select count(*) from public.listener_events
           where device_id = _dev and reference_key is not null) = 1,
         'a reference may exist only once per device';

  -- Re-running reconciliation is safe and still credits nothing.
  perform public.reconcile_listener_events(72);
  select * into _row from public.listener_events where id = _row.id;
  assert _row.consumed_cash_in_id is null, 'reconciliation must not invent a match';
  assert _row.review_state = 'pending', 'the payment stays visible until a human acts';

  raise notice 'unmatched GCash payment queue behaves correctly';
end $$;

rollback;

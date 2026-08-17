-- Cash In: the receiving-account (destination) check is a routing safeguard,
-- never part of the authentication layers, and it must say so.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
-- Covers:
--   A. amount + sender authenticate, but a phone monitoring another receiving
--      GCash number reports 'destination_mismatch' instead of hiding behind
--      'no_pending_match'.
--   B. nothing is linked or approved while the destination disagrees.
--   C. once the shop's receiving number matches the phone, the very same event
--      matches through the normal automatic path (no forcing).
--   D. a truly unrelated payment still reports 'no_pending_match'.
begin;

do $$
declare _uid uuid; _eco uuid; _method uuid; _dev uuid; _ev uuid; _other uuid;
        _row public.cash_in_requests; _res text;
        _shop_num constant text := '09171234567';
        _phone_num constant text := '09171234568';
        _sender constant text := '09991234567';
begin
  select p.id, p.ecosystem_id into _uid, _eco
    from public.profiles p
   where p.status = 'active' and not public.is_super_admin(p.id) and p.ecosystem_id is not null
   limit 1;
  select id into _method from public.payment_methods where active limit 1;
  if _uid is null or _method is null then
    raise notice 'skipped: no active member with a shop, or no payment method';
    return;
  end if;

  update public.ecosystems set cash_in_gcash_number = _shop_num where id = _eco;
  delete from public.cash_in_auto_rules where ecosystem_id is not distinct from _eco;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, require_reference_match,
                                         amount_tolerance_php, require_listener_match,
                                         require_receipt_match, verification_mode)
  values (_eco, true, true, 0, true, false, 'active');

  -- A paired phone that monitors a DIFFERENT receiving GCash number.
  insert into public.listener_devices (label, owner_role, receiving_number, receiving_number_key,
                                       secret_key_hash, status, last_seen_at)
  values ('destination test', 'platform', _phone_num, public.normalize_ph_mobile(_phone_num),
          repeat('a', 64), 'active', now())
  returning id into _dev;

  insert into public.cash_in_requests (user_id, ecosystem_id, method_id, method_name, method_type,
                                       amount_php, credits, rate_php, rate_credits, net_php,
                                       status, requester_name, sender_number, sender_number_key,
                                       payer_reference, payer_reference_key, proof_path)
  values (_uid, _eco, _method, 'Gcash', 'ewallet', 250, 250, 1000, 1000, 250,
          'pending', 'Test Member', _sender, public.normalize_ph_mobile(_sender),
          'DEST-TEST-1', 'DESTTEST1', 'proof.jpg')
  returning * into _row;

  -- The payment arrives first (listener-first ordering).
  insert into public.listener_events (device_id, outcome, amount_php, sender_number,
                                      sender_number_key, posted_at, raw_text)
  values (_dev, 'accepted', 250, _sender, public.normalize_ph_mobile(_sender), now(), 'dest test')
  returning id into _ev;

  -- A. Authentication passes; only routing blocks it, and it is named.
  _res := public.match_listener_event(_ev);
  if _res <> 'destination_mismatch' then
    raise exception 'A: expected destination_mismatch, got %', _res;
  end if;
  if (select match_result from public.listener_events where id = _ev) <> 'destination_mismatch' then
    raise exception 'A: the event must record the destination mismatch';
  end if;

  -- B. Nothing linked, nothing approved.
  if (select listener_event_id from public.cash_in_requests where id = _row.id) is not null then
    raise exception 'B: a mismatched destination must not link a request';
  end if;
  if (select status from public.cash_in_requests where id = _row.id) <> 'pending' then
    raise exception 'B: a mismatched destination must never approve';
  end if;
  if public.try_auto_approve_cash_in(_row.id) <> 'awaiting_listener' then
    raise exception 'B: approval must keep waiting for a confirmed payment';
  end if;

  -- C. Align the shop's receiving number with the phone: the same event now
  --    settles through the ordinary automatic path.
  update public.ecosystems set cash_in_gcash_number = _phone_num where id = _eco;
  _res := public.match_listener_event(_ev);
  if _res not in ('approved', 'staged') then
    raise exception 'C: once the destination agrees the normal path must settle it, got %', _res;
  end if;

  -- D. An unrelated payment is still simply unmatched.
  insert into public.listener_events (device_id, outcome, amount_php, sender_number,
                                      sender_number_key, posted_at, raw_text)
  values (_dev, 'accepted', 7777, '09995550000', '639995550000', now(), 'unrelated')
  returning id into _other;
  if public.match_listener_event(_other) <> 'no_pending_match' then
    raise exception 'D: an unrelated payment must report no_pending_match';
  end if;
end $$;

rollback;

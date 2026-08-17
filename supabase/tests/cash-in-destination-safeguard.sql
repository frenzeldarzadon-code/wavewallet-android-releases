-- Cash In: the receiving GCash number ("destination") is INFORMATIONAL ONLY.
--
-- GCash masks and reformats the receiving number in its notification text, so a
-- difference must never block an otherwise valid automatic approval. The only
-- routing rule left is shop isolation: a phone paired to one shop may settle
-- that shop's Cash In and no other.
--
-- Run inside a transaction and ROLLBACK — this file must never leave rows behind.
-- Covers:
--   A. amount + sender authenticate while the phone monitors a DIFFERENT
--      receiving number: the request still matches and settles.
--   B. an audit note records the receiving-number difference.
--   C. a phone paired to another shop is still refused ('wrong_shop').
--   D. a truly unrelated payment still reports 'no_pending_match'.
begin;

do $$
declare _uid uuid; _eco uuid; _other_eco uuid; _method uuid; _dev uuid; _dev2 uuid;
        _ev uuid; _other uuid; _row public.cash_in_requests; _res text;
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
  select id into _other_eco from public.ecosystems where id <> _eco limit 1;

  update public.ecosystems set cash_in_gcash_number = _shop_num where id = _eco;
  delete from public.cash_in_auto_rules where ecosystem_id is not distinct from _eco;
  insert into public.cash_in_auto_rules (ecosystem_id, enabled, amount_tolerance_php,
                                         require_listener_match, require_receipt_match,
                                         verification_mode)
  values (_eco, true, 0, true, false, 'active');

  -- A paired platform phone that reports a DIFFERENT receiving GCash number.
  insert into public.listener_devices (label, owner_role, receiving_number, receiving_number_key,
                                       secret_key_hash, status, last_seen_at)
  values ('masked destination test', 'platform', _phone_num, public.normalize_ph_mobile(_phone_num),
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

  -- A. A masked/different receiving number must not block the match.
  _res := public.match_listener_event(_ev);
  if _res not in ('approved', 'staged') then
    raise exception 'A: a masked receiving number must not block matching, got %', _res;
  end if;
  if (select listener_event_id from public.cash_in_requests where id = _row.id) is null then
    raise exception 'A: the request must be linked to the confirmed payment';
  end if;

  -- B. The difference is recorded for audit.
  if (select destination_note from public.listener_events where id = _ev) is null then
    raise exception 'B: the receiving-number difference must be recorded as an audit note';
  end if;

  -- C. Shop isolation still blocks a phone paired to another shop.
  if _other_eco is not null then
    insert into public.listener_devices (label, owner_role, ecosystem_id, receiving_number,
                                         receiving_number_key, secret_key_hash, status, last_seen_at)
    values ('other shop phone', 'admin', _other_eco, _shop_num,
            public.normalize_ph_mobile(_shop_num), repeat('b', 64), 'active', now())
    returning id into _dev2;

    insert into public.cash_in_requests (user_id, ecosystem_id, method_id, method_name, method_type,
                                         amount_php, credits, rate_php, rate_credits, net_php,
                                         status, requester_name, sender_number, sender_number_key,
                                         payer_reference, payer_reference_key, proof_path)
    values (_uid, _eco, _method, 'Gcash', 'ewallet', 333, 333, 1000, 1000, 333,
            'pending', 'Test Member', _sender, public.normalize_ph_mobile(_sender),
            'DEST-TEST-2', 'DESTTEST2', 'proof.jpg');

    insert into public.listener_events (device_id, outcome, amount_php, sender_number,
                                        sender_number_key, posted_at, raw_text)
    values (_dev2, 'accepted', 333, _sender, public.normalize_ph_mobile(_sender), now(), 'other shop')
    returning id into _other;
    if public.match_listener_event(_other) <> 'wrong_shop' then
      raise exception 'C: a phone paired to another shop must be refused';
    end if;
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

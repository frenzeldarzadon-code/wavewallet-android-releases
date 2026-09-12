CREATE OR REPLACE FUNCTION public.listener_match_signal_details(_ev listener_events, _row cash_in_requests)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with c as (
    select public.cash_in_sender_key(_row) as sender_key,
           coalesce(_row.receipt_reference_key, _row.payer_reference_key) as ref_key,
           public.cash_in_account_tail(_row) as tail,
           public.listener_event_account_tail(_ev) as ev_tail,
           public.payment_name_key(_row.receipt_sender_name) as name_key,
           public.payment_name_key(_ev.sender_name) as ev_name_key,
           public.cash_in_receiving_tail(_row) as recv_tail,
           public.listener_event_receiving_tail(_ev) as ev_recv_tail,
           coalesce(_row.receipt_paid_at, _row.paid_at) as paid_at,
           coalesce((select r.amount_tolerance_php
                       from public.cash_in_auto_rule(_row.ecosystem_id) r), 0) as tol
  )
  select jsonb_build_array(
    jsonb_build_object(
      'signal', 'reference', 'category', 'identity', 'strength', 'normal',
      'receipt_label', 'Reference no.', 'notification_label', 'Reference no.',
      'receipt', c.ref_key, 'notification', _ev.reference_key,
      'agreed', (_ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key = c.ref_key)),
    jsonb_build_object(
      'signal', 'sender_account', 'category', 'identity', 'strength', 'normal',
      'receipt_label', 'Paid from / Sender', 'notification_label', 'Received from',
      'receipt', c.sender_key, 'notification', _ev.sender_number_key,
      'agreed', (_ev.sender_number_key is not null and c.sender_key is not null
                 and _ev.sender_number_key = c.sender_key)),
    jsonb_build_object(
      'signal', 'account_tail', 'category', 'identity', 'strength', 'normal',
      'receipt_label', 'Paid from (masked)', 'notification_label', 'Received from (masked)',
      'receipt', c.tail, 'notification', c.ev_tail,
      'agreed', (not (_ev.sender_number_key is not null and c.sender_key is not null)
                 and c.tail is not null and c.ev_tail is not null and c.tail = c.ev_tail)),
    jsonb_build_object(
      'signal', 'payer_name', 'category', 'identity', 'strength', 'normal',
      'receipt_label', 'Sender name', 'notification_label', 'Received from (name)',
      'receipt', c.name_key, 'notification', c.ev_name_key,
      'agreed', (c.name_key is not null and c.ev_name_key is not null
                 and c.name_key = c.ev_name_key)),
    jsonb_build_object(
      'signal', 'amount', 'category', 'supporting', 'strength', 'normal',
      'receipt_label', 'Amount sent', 'notification_label', 'Amount received',
      'receipt', _row.amount_php, 'notification', _ev.amount_php,
      'tolerance_php', c.tol,
      'agreed', (_ev.amount_php is not null
                 and abs(_ev.amount_php - _row.amount_php) <= c.tol)),
    -- The receiving account is the SAME for every payment into this account,
    -- so an agreement here says nothing about THIS payment: it is shown to the
    -- reviewer but never counts as one of the two independent facts. The
    -- separate check against the configured receiving account is unaffected.
    jsonb_build_object(
      'signal', 'recipient_account', 'category', 'informational', 'strength', 'informational',
      'receipt_label', 'Sent to / Paid to', 'notification_label', 'Received by',
      'receipt', c.recv_tail, 'notification', c.ev_recv_tail,
      'agreed', (c.recv_tail is not null and c.ev_recv_tail is not null and c.recv_tail = c.ev_recv_tail)),
    jsonb_build_object(
      'signal', 'payment_time', 'category', 'supporting', 'strength', 'normal',
      'receipt_label', 'Date / time on receipt', 'notification_label', 'Notification time',
      'receipt', c.paid_at, 'notification', _ev.posted_at,
      'agreed', (c.paid_at is not null and _ev.posted_at is not null
                 and abs(extract(epoch from (_ev.posted_at - c.paid_at))) <= 600)),
    jsonb_build_object(
      'signal', 'reference_difference', 'category', 'informational', 'strength', 'informational',
      'receipt', c.ref_key, 'notification', _ev.reference_key,
      'agreed', (_ev.reference_key is not null and c.ref_key is not null
                 and _ev.reference_key <> c.ref_key))
  )
  from c
$function$;
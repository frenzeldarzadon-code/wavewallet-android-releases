
DO $$
DECLARE d text; d2 text;
BEGIN
  d := pg_get_functiondef('public.purchase_voucher(uuid,integer)'::regprocedure);
  d2 := replace(d,
    'select id into _acct from public.credit_accounts where user_id = _subject;',
    '_acct := public.wallet_id_for(_subject, _my_eco);');
  IF d2 = d THEN RAISE EXCEPTION 'purchase_voucher buyer wallet lookup not found'; END IF;
  d := d2;
  d2 := replace(d,
    'select id into _pacct from public.points_accounts where user_id = _subject;',
    'select id into _pacct from public.points_accounts where user_id = _subject and (ecosystem_id = _my_eco or ecosystem_id is null) order by (ecosystem_id is null) limit 1;');
  IF d2 = d THEN RAISE EXCEPTION 'purchase_voucher points wallet lookup not found'; END IF;
  d := d2;
  d2 := replace(d,
    'select id into _racct from public.credit_accounts where user_id = _rec.recipient_id;',
    '_racct := public.wallet_id_for(_rec.recipient_id, _my_eco);');
  IF d2 = d THEN RAISE EXCEPTION 'purchase_voucher recipient wallet lookup not found'; END IF;
  EXECUTE d2;

  d := pg_get_functiondef('public.transfer_credits(uuid,numeric,text)'::regprocedure);
  d2 := replace(d,
    'select id into _from from public.credit_accounts where user_id = _subject;',
    '_from := public.wallet_id_for(_subject, _my_eco);');
  IF d2 = d THEN RAISE EXCEPTION 'transfer_credits sender wallet lookup not found'; END IF;
  d := d2;
  d2 := replace(d,
    'select id into _to from public.credit_accounts where user_id = _recipient_id;',
    '_to := public.wallet_id_for(_recipient_id, _my_eco);');
  IF d2 = d THEN RAISE EXCEPTION 'transfer_credits recipient wallet lookup not found'; END IF;
  EXECUTE d2;
END $$;

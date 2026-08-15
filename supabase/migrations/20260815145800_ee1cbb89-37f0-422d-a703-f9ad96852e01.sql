ALTER TABLE public.cash_in_requests ADD COLUMN IF NOT EXISTS proof_path text;

CREATE OR REPLACE FUNCTION public.request_cash_in(_method_id uuid, _amount_php numeric, _payer_reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _request_key text DEFAULT NULL::text, _proof_path text DEFAULT NULL::text)
 RETURNS cash_in_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _subject uuid; _op uuid; _eco uuid; _status public.account_status; _role public.app_role;
        _name text; _m public.payment_methods; _s record; _credits numeric(14,2);
        _fee numeric(14,2); _net numeric(14,2);
        _row public.cash_in_requests; _key text; _ref text; _proof text; _folder text;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  select p.ecosystem_id, p.status, p.full_name into _eco, _status, _name
    from public.profiles p where p.id = _subject;
  if _name is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if public.is_super_admin(_subject) then
    raise exception 'The platform owner does not hold a member credit balance and cannot cash in';
  end if;
  _role := coalesce(public.top_role(_subject), 'customer');

  if _amount_php is null or _amount_php <= 0 then raise exception 'Enter how much you are paying'; end if;
  if _amount_php > 10000000 then raise exception 'A single cash in is limited to 10,000,000'; end if;

  select * into _m from public.payment_methods where id = _method_id;
  if _m.id is null or not _m.active then raise exception 'Choose an available payment method'; end if;

  -- The screenshot is optional. When supplied it must live in the requester's own folder.
  _proof := nullif(trim(_proof_path), '');
  if _proof is not null then
    _folder := split_part(_proof, '/', 1);
    if _folder is null or _folder = '' or (_folder <> _subject::text and _folder <> _op::text) then
      raise exception 'That payment screenshot does not belong to this member';
    end if;
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);
  select * into _row from public.cash_in_requests where request_key = _key;
  if _row.id is not null then return _row; end if;

  select * into _s from public.money_settings();
  _fee := round(_amount_php * coalesce(_s.cash_in_fee_percent,0) / 100.0, 2);
  _net := round(_amount_php - _fee, 2);
  if _net <= 0 then raise exception 'That amount is too small to cash in'; end if;
  _credits := round(_net * _s.credits_per_unit / _s.php_per_unit, 2);
  if _credits <= 0 then raise exception 'That amount is too small to cash in'; end if;

  _ref := 'CI-' || upper(encode(extensions.gen_random_bytes(5), 'hex'));

  insert into public.cash_in_requests (
    reference, request_key, user_id, ecosystem_id, requester_name, requester_role,
    amount_php, rate_credits, rate_php, credits, fee_percent, fee_php, net_php,
    method_id, method_name, method_type,
    method_details, payer_reference, notes, proof_path)
  values (_ref, _key, _subject, _eco, _name, _role::text,
          _amount_php, _s.credits_per_unit, _s.php_per_unit, _credits,
          coalesce(_s.cash_in_fee_percent,0), _fee, _net,
          _m.id, _m.name, _m.method_type,
          jsonb_build_object('instructions', _m.instructions, 'account_name', _m.account_name,
                             'account_number', _m.account_number, 'notes', _m.notes),
          nullif(trim(_payer_reference),''), nullif(trim(_notes),''), _proof)
  returning * into _row;

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce((select full_name from public.profiles where id = _op), _name),
          'Requested cash in', _name,
          jsonb_build_object('reference', _ref, 'amount_php', _amount_php, 'credits', _credits,
                             'fee_percent', coalesce(_s.cash_in_fee_percent,0), 'fee_php', _fee,
                             'net_php', _net,
                             'method', _m.name, 'requester_id', _subject, 'status', 'pending',
                             'has_proof', _proof is not null));
  return _row;
end $function$;

REVOKE ALL ON FUNCTION public.request_cash_in(uuid, numeric, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_cash_in(uuid, numeric, text, text, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.request_cash_in(uuid, numeric, text, text, text);

CREATE POLICY "Members upload their cash in proof"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'cash-in-proofs' AND (storage.foldername(name))[1] = (auth.uid())::text);

CREATE POLICY "Members and platform owner read cash in proofs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'cash-in-proofs' AND ((storage.foldername(name))[1] = (auth.uid())::text OR public.is_super_admin(auth.uid())));

CREATE POLICY "Members remove their own cash in proof"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'cash-in-proofs' AND ((storage.foldername(name))[1] = (auth.uid())::text OR public.is_super_admin(auth.uid())));
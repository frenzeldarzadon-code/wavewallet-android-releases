-- Customer loan requests must carry a valid ID document.
-- The ID lives in the private `loan-ids` bucket; only the owner and the
-- platform owner can read it, and the requirement is enforced in the RPCs.

ALTER TABLE public.coin_loans
  ADD COLUMN IF NOT EXISTS id_document_path text,
  ADD COLUMN IF NOT EXISTS id_document_uploaded_at timestamptz;

COMMENT ON COLUMN public.coin_loans.id_document_path IS
  'Object path in the private loan-ids bucket: <user id>/<uuid>.<ext>. Required for customer requests.';

-- Storage access: own folder only, plus the platform owner for review.
DROP POLICY IF EXISTS "Members upload their loan ID" ON storage.objects;
CREATE POLICY "Members upload their loan ID"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'loan-ids' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Owner and platform owner read loan IDs" ON storage.objects;
CREATE POLICY "Owner and platform owner read loan IDs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'loan-ids'
         AND ((storage.foldername(name))[1] = auth.uid()::text
              OR public.is_super_admin(auth.uid())));

-- Only an ID not yet attached to a loan may be deleted (replace before submit).
DROP POLICY IF EXISTS "Members remove an unsubmitted loan ID" ON storage.objects;
CREATE POLICY "Members remove an unsubmitted loan ID"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'loan-ids'
         AND (storage.foldername(name))[1] = auth.uid()::text
         AND NOT EXISTS (SELECT 1 FROM public.coin_loans l WHERE l.id_document_path = storage.objects.name));

-- Request: a customer must attach an ID; position holders are unchanged.
DROP FUNCTION IF EXISTS public.request_coin_loan(numeric);
CREATE OR REPLACE FUNCTION public.request_coin_loan(_amount numeric, _id_path text DEFAULT NULL)
 RETURNS coin_loans
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _me uuid := public.effective_uid(); _s record; _limit numeric(14,2);
        _free numeric(14,2); _interest numeric(14,2); _loan public.coin_loans;
        _auto boolean; _position boolean; _role text; _path text;
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  select * into _s from public.platform_settings where id = 1;
  if not coalesce(_s.loans_enabled, false) then raise exception 'Coin loans are not available right now'; end if;
  if exists (select 1 from public.coin_loans where user_id = _me and status in ('pending','active')) then
    raise exception 'You already have a loan in progress. Repay it before requesting another one.';
  end if;
  _amount := round(coalesce(_amount, 0), 2);
  if _amount <= 0 then raise exception 'Enter a loan amount greater than zero'; end if;

  perform public.ensure_global_wallet(_me);
  _free := public.free_coin_balance(_me);
  _limit := public.coin_loan_auto_limit(_me);
  _position := public.has_loan_position(_me);
  _role := public.loan_borrower_role(_me);
  -- Customers are never auto-approved, whatever the amount.
  _auto := _position and _amount <= _limit;

  _path := nullif(btrim(coalesce(_id_path, '')), '');
  if _path is not null then
    -- The ID must be the requester's own uploaded file in the private bucket.
    if split_part(_path, '/', 1) <> _me::text then
      raise exception 'That ID does not belong to you';
    end if;
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'loan-ids' and o.name = _path) then
      raise exception 'Upload your valid ID again — the file could not be found';
    end if;
    if exists (select 1 from public.coin_loans l where l.id_document_path = _path) then
      raise exception 'That ID is already attached to another loan request';
    end if;
  end if;
  if not _position and _path is null then
    raise exception 'A valid ID is required for this loan request';
  end if;

  _interest := case when coalesce(_s.loan_first_month_upfront, true)
                    then round(_amount * coalesce(_s.loan_monthly_interest_percent, 0) / 100, 2)
                    else 0 end;

  begin
    insert into public.coin_loans (user_id, principal, interest_percent, auto_limit_snapshot,
                                   base_snapshot, multiplier_snapshot, free_balance_snapshot,
                                   first_month_interest, total_owed, outstanding,
                                   status, approval_mode, borrower_role, universe_spend,
                                   origin, id_document_path, id_document_uploaded_at)
    values (_me, _amount, coalesce(_s.loan_monthly_interest_percent, 0),
            case when _position then _limit else 0 end,
            _s.loan_auto_base_credits, _s.loan_free_balance_multiplier, _free,
            _interest, _amount, _amount, 'pending',
            case when _auto then 'automatic' else 'manual' end,
            _role, not _position, 'member_request',
            _path, case when _path is not null then now() else null end)
    returning * into _loan;
  exception when unique_violation then
    raise exception 'You already have a loan in progress. Repay it before requesting another one.';
  end;

  if _auto then
    _loan := public.release_coin_loan(_loan.id);
  end if;
  return _loan;
end $function$;

GRANT EXECUTE ON FUNCTION public.request_coin_loan(numeric, text) TO authenticated;

-- Review: a customer request without an ID cannot be approved.
CREATE OR REPLACE FUNCTION public.review_coin_loan(_loan_id uuid, _approve boolean, _note text DEFAULT NULL::text)
 RETURNS coin_loans
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _loan public.coin_loans; _s record;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Only the platform owner may decide loans'; end if;
  select * into _loan from public.coin_loans where id = _loan_id for update;
  if _loan.id is null then raise exception 'Loan not found'; end if;
  if _loan.status <> 'pending' then raise exception 'This loan was already %', _loan.status; end if;

  if _approve then
    select * into _s from public.platform_settings where id = 1;
    if not coalesce(_s.loans_enabled, false) then
      raise exception 'Coin loans are switched off. Turn them back on before approving.';
    end if;
    if not _loan.universe_spend and not public.has_loan_position(_loan.user_id) then
      raise exception 'This member is no longer an admin, reseller or subreseller of any shop';
    end if;
    if coalesce(_loan.origin, 'member_request') = 'member_request'
       and not public.has_loan_position(_loan.user_id)
       and _loan.id_document_path is null then
      raise exception 'This customer has not provided a valid ID. The loan cannot be approved until they upload one.';
    end if;
    if exists (select 1 from public.coin_loans
                where user_id = _loan.user_id and status = 'active' and id <> _loan.id) then
      raise exception 'This member already has an active loan';
    end if;
    update public.coin_loans
       set auto_limit_snapshot = case when public.has_loan_position(_loan.user_id)
                                      then public.coin_loan_auto_limit(_loan.user_id) else 0 end,
           free_balance_snapshot = public.free_coin_balance(_loan.user_id)
     where id = _loan.id;
  end if;

  update public.coin_loans
     set decided_by = auth.uid(), decided_at = now(), decision_note = _note,
         status = case when _approve then status else 'rejected' end
   where id = _loan.id returning * into _loan;

  if _approve then _loan := public.release_coin_loan(_loan.id); end if;
  return _loan;
end $function$;

-- Platform owner report: expose the ID path so the reviewer can open it.
DROP FUNCTION IF EXISTS public.super_coin_loans(text, text);
CREATE OR REPLACE FUNCTION public.super_coin_loans(_status text DEFAULT NULL::text, _search text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, user_id uuid, full_name text, handle text, role text, principal numeric, released_amount numeric, first_month_interest numeric, interest_percent numeric, accrued_interest numeric, outstanding numeric, total_owed numeric, repaid numeric, auto_limit_snapshot numeric, free_balance_snapshot numeric, status text, approval_mode text, origin text, created_by uuid, created_by_name text, reference_note text, borrower_role text, universe_spend boolean, id_document_path text, id_document_uploaded_at timestamp with time zone, decided_by uuid, decided_at timestamp with time zone, decision_note text, released_at timestamp with time zone, settled_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _q text := nullif(btrim(coalesce(_search, '')), '');
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  return query
  select l.id, l.user_id, p.full_name, p.handle, public.top_role(l.user_id)::text,
         l.principal, l.released_amount, l.first_month_interest, l.interest_percent,
         l.accrued_interest, l.outstanding, l.total_owed,
         coalesce((select sum(e.amount) from public.coin_loan_entries e
                    where e.loan_id = l.id and e.kind = 'repayment'), 0)::numeric,
         l.auto_limit_snapshot, l.free_balance_snapshot, l.status, l.approval_mode,
         coalesce(l.origin, 'member_request'), l.created_by, c.full_name,
         l.reference_note, l.borrower_role, coalesce(l.universe_spend, false),
         l.id_document_path, l.id_document_uploaded_at,
         l.decided_by, l.decided_at, l.decision_note, l.released_at, l.settled_at, l.created_at
    from public.coin_loans l
    left join public.profiles p on p.id = l.user_id
    left join public.profiles c on c.id = l.created_by
   where (_status is null or l.status = _status)
     and (_q is null
          or coalesce(p.full_name, '') ilike '%' || _q || '%'
          or coalesce(p.handle, '') ilike '%' || _q || '%'
          or coalesce(l.reference_note, '') ilike '%' || _q || '%'
          or l.id::text ilike _q || '%')
   order by case when l.status = 'pending' then 0 when l.status = 'active' then 1 else 2 end,
            l.created_at desc
   limit 500;
end $function$;

GRANT EXECUTE ON FUNCTION public.super_coin_loans(text, text) TO authenticated;

-- Does this member have to attach an ID? (customers only)
CREATE OR REPLACE FUNCTION public.loan_requires_id(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select not public.has_loan_position(coalesce(_user, public.effective_uid())) $function$;

GRANT EXECUTE ON FUNCTION public.loan_requires_id(uuid) TO authenticated;
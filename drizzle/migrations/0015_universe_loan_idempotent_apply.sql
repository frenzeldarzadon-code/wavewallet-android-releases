-- The application token must be honoured before any validation, so a retried
-- submission returns the same loan instead of tripping the ID-reuse guard.
create or replace function public.apply_universe_loan(
  _amount numeric, _term_months integer, _id_path text, _client_token text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare _me uuid := public.effective_uid(); _s record; _amt numeric(14,2); _id uuid;
begin
  if _me is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();

  if _client_token is not null then
    select id into _id from public.universe_loans
     where borrower_id = _me and client_token = _client_token;
    if _id is not null then return _id; end if;
  end if;

  select * into _s from public.universe_loan_settings();
  if not _s.enabled then raise exception 'Universe loans are not available right now'; end if;

  _amt := round(coalesce(_amount,0), 2);
  if _amt <= 0 then raise exception 'Enter an amount greater than zero'; end if;
  if _term_months is null or _term_months <> all (_s.terms) then
    raise exception 'Choose a term of 3, 6 or 12 months';
  end if;
  if _id_path is null or btrim(_id_path) = '' then
    raise exception 'A valid ID is required for this loan request';
  end if;
  if split_part(_id_path, '/', 1) <> _me::text then
    raise exception 'That ID file does not belong to you';
  end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'loan-ids' and o.name = _id_path) then
    raise exception 'Upload your valid ID again';
  end if;
  if exists (select 1 from public.universe_loans where id_document_path = _id_path) then
    raise exception 'That ID file is already attached to another loan request';
  end if;
  if exists (select 1 from public.universe_loans
              where borrower_id = _me
                and status in ('pending_funding','partially_funded','fully_funded','active')) then
    raise exception 'You already have a Universe loan in progress';
  end if;

  insert into public.universe_loans (
    borrower_id, amount, term_months, status,
    interest_percent, platform_fee_percent, owner_share_percent, contributor_share_percent,
    id_document_path, id_document_uploaded_at, client_token
  ) values (
    _me, _amt, _term_months, 'pending_funding',
    _s.interest_percent, _s.platform_fee_percent, _s.owner_share_percent, _s.contributor_share_percent,
    _id_path, now(), _client_token
  ) returning id into _id;

  return _id;
end $$;
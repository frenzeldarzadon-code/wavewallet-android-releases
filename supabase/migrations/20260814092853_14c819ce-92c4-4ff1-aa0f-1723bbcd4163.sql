ALTER TABLE public.social_credit_accounts ALTER COLUMN ecosystem_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.social_wallet(_user uuid)
 RETURNS social_credit_accounts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eco uuid; _acct public.social_credit_accounts; _today date := (now() at time zone 'utc')::date;
        _allow integer; _zero uuid := '00000000-0000-0000-0000-000000000000';
begin
  select ecosystem_id into _eco from public.profiles where id = _user and deleted_at is null;

  insert into public.social_credit_accounts (user_id, ecosystem_id)
  values (_user, _eco)
  on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;

  select * into _acct from public.social_credit_accounts
   where user_id = _user and coalesce(ecosystem_id, _zero) = coalesce(_eco, _zero)
   for update;

  if _acct.last_allowance_on is distinct from _today then
    _allow := (public.social_effective_settings(_acct.ecosystem_id) ->> 'daily_allowance')::integer;
    update public.social_credit_accounts set last_allowance_on = _today where id = _acct.id;
    if coalesce(_allow,0) > 0 then
      insert into public.social_credit_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                               balance_after, source, reason, reference)
      values (_acct.id, _user, _acct.ecosystem_id, 'credit', _allow, 0, 'daily_allowance',
              'Daily free social credits', _today::text);
    end if;
    select * into _acct from public.social_credit_accounts where id = _acct.id;
  end if;
  return _acct;
end; $function$;
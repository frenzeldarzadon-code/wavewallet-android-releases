
alter table public.credit_accounts alter column ecosystem_id drop not null;
alter table public.credit_ledger alter column ecosystem_id drop not null;

create or replace function public.ensure_credit_account(_user_id uuid, _ecosystem_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare _acct uuid; _eco uuid;
begin
  select id into _acct from public.credit_accounts where user_id = _user_id for update;
  if _acct is not null then return _acct; end if;

  if not exists (select 1 from public.profiles where id = _user_id) then
    raise exception 'Member not found';
  end if;

  select coalesce(_ecosystem_id, p.ecosystem_id) into _eco
    from public.profiles p where p.id = _user_id;

  insert into public.credit_accounts (user_id, ecosystem_id, balance)
  values (_user_id, _eco, 0)
  on conflict (user_id) do nothing;

  select id into _acct from public.credit_accounts where user_id = _user_id for update;
  return _acct;
end $$;

revoke all on function public.ensure_credit_account(uuid, uuid) from public;

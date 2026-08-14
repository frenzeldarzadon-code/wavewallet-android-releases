-- Super Admin "Delete Universe user" eligibility regression test.
--
-- Run inside a transaction and ROLLBACK — it creates synthetic accounts only:
--   BEGIN; \i supabase/tests/platform-user-deletion.sql ROLLBACK;
--
-- Covers the bug where the check referenced a social wallet column that no
-- longer exists (s.purchased_balance). The current model is:
--   social_credit_accounts.balance      -> purchased credits (blocks deletion)
--   social_credit_accounts.free_balance -> daily allowance   (ignored)
-- Credits and points are summed across EVERY shop wallet.

BEGIN;

DO $$
declare
  _ecoA uuid := gen_random_uuid();
  _ecoB uuid := gen_random_uuid();
  _slugA text := 'qa-del-a-' || left(gen_random_uuid()::text, 8);
  _slugB text := 'qa-del-b-' || left(gen_random_uuid()::text, 8);
  _owner uuid := gen_random_uuid();
  _zero uuid := gen_random_uuid();
  _rich uuid := gen_random_uuid();
  _social uuid := gen_random_uuid();
  _chk record;
  _p record;
  _n bigint;
begin
  insert into public.ecosystems (id, name, slug, signup_token, plan_name, plan_price,
                                 subscription_state, current_period_end, signup_enabled)
  values (_ecoA, 'QA Del A', _slugA, 'tokA', 'QA', 0, 'active', now() + interval '30 days', true),
         (_ecoB, 'QA Del B', _slugB, 'tokB', 'QA', 0, 'active', now() + interval '30 days', true);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_user_meta_data)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'pd+' || left(u::text,8) || '@example.invalid', 'x', now(), now(),
         jsonb_build_object('full_name','QA','phone','0','ecosystem_slug',_slugA)
  from unnest(array[_owner,_zero,_rich,_social]) u;

  update public.user_roles set role = 'super_admin' where user_id = _owner;
  perform set_config('request.jwt.claims', json_build_object('sub', _owner)::text, true);

  -- Zero-balance account: eligible.
  select * into _chk from public.platform_user_deletion_check(_zero);
  if not _chk.eligible then raise exception 'zero-balance user blocked: %', _chk.blockers; end if;

  -- Balance held in a SECOND shop must still block deletion.
  insert into public.credit_accounts (user_id, ecosystem_id, balance)
  values (_rich, _ecoB, 25)
  on conflict (user_id, ecosystem_id) do update set balance = 25;
  select * into _chk from public.platform_user_deletion_check(_rich);
  if _chk.eligible then raise exception 'user with credits in another shop wrongly eligible'; end if;
  if _chk.credit_total <> 25 then raise exception 'credit total = %, expected 25', _chk.credit_total; end if;

  -- Purchased social credits block; the free daily allowance does not.
  insert into public.social_credit_accounts (user_id, ecosystem_id, balance, free_balance)
  values (_social, null, 0, 10)
  on conflict do nothing;
  select * into _chk from public.platform_user_deletion_check(_social);
  if not _chk.eligible then raise exception 'free allowance wrongly blocked deletion: %', _chk.blockers; end if;
  update public.social_credit_accounts set balance = 7 where user_id = _social;
  select * into _chk from public.platform_user_deletion_check(_social);
  if _chk.eligible then raise exception 'purchased social credits did not block deletion'; end if;
  if _chk.social_purchased <> 7 then raise exception 'social total = %, expected 7', _chk.social_purchased; end if;

  -- A pending cash-out blocks deletion.
  -- (covered by withdrawal_requests status check; skipped here to avoid shop wiring)

  -- Deleting an eligible account anonymises it and keeps financial history.
  perform public.superadmin_delete_platform_user(_zero, 'qa cleanup');
  select * into _p from public.profiles where id = _zero;
  if _p.deleted_at is null then raise exception 'profile not marked deleted'; end if;
  if _p.full_name <> 'Deleted member' then raise exception 'not anonymised: %', _p.full_name; end if;
  select count(*) into _n from public.user_roles where user_id = _zero;
  if _n <> 0 then raise exception 'roles not revoked (%)', _n; end if;
  select count(*) into _n from public.credit_accounts where user_id = _zero;
  if _n = 0 then raise exception 'wallet history destroyed'; end if;
  select count(*) into _n from public.audit_logs
    where action = 'Deleted platform account (anonymised)'
      and metadata->>'user_id' = _zero::text
      and metadata ? 'eligible';
  if _n <> 1 then raise exception 'audit entry missing eligibility result'; end if;

  -- Non-zero balance must be refused by the delete RPC too.
  begin
    perform public.superadmin_delete_platform_user(_rich, 'nope');
    raise exception 'GUARD deletion of funded account should have failed';
  exception when others then
    if sqlerrm like 'GUARD%' then raise; end if;
  end;

  -- Only the platform owner may run the check.
  perform set_config('request.jwt.claims', json_build_object('sub', _rich)::text, true);
  begin
    perform public.platform_user_deletion_check(_social);
    raise exception 'GUARD non-owner was allowed to check';
  exception when others then
    if sqlerrm like 'GUARD%' then raise; end if;
  end;

  raise notice 'PASS: platform user deletion rules';
end $$;

ROLLBACK;

-- Authorization matrix for credit loading / transfers.
--
-- Rules under test:
--   Admin        -> reseller, subreseller, customer in own ecosystem: allowed
--   Reseller     -> any customer in same ecosystem: allowed
--   Reseller     -> own subreseller: allowed; another reseller's subreseller: denied
--   Reseller     -> another reseller / admin: denied
--   Subreseller  -> any customer in same ecosystem: allowed
--   Subreseller  -> reseller / other subreseller / admin: denied
--   Customer     -> customer: allowed; seller roles / admin: denied
--   Any actor    -> member of another ecosystem: denied
--
-- Run inside a transaction and roll back:
--   BEGIN; \i supabase/tests/transfer-authorization.sql ROLLBACK;

BEGIN;

DO $$
DECLARE
  _eco  uuid; _eco2 uuid;
  _admin uuid := gen_random_uuid();
  _resA  uuid := gen_random_uuid();
  _resB  uuid := gen_random_uuid();
  _subA  uuid := gen_random_uuid();
  _subB  uuid := gen_random_uuid();
  _cus1  uuid := gen_random_uuid();
  _cus2  uuid := gen_random_uuid();
  _foreign uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price, subscription_state)
  VALUES ('Auth Test Shop', 'auth-test-shop', 'tok1', 'Test', 0, 'active') RETURNING id INTO _eco;
  INSERT INTO public.ecosystems (name, slug, signup_token, plan_name, plan_price, subscription_state)
  VALUES ('Auth Test Shop 2', 'auth-test-shop-2', 'tok2', 'Test', 0, 'active') RETURNING id INTO _eco2;

  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status) VALUES
    (_admin, _eco, 'Admin',   'a@t.local', '00', 'active'),
    (_resA,  _eco, 'ResA',    'ra@t.local','01', 'active'),
    (_resB,  _eco, 'ResB',    'rb@t.local','02', 'active'),
    (_cus1,  _eco, 'Cus1',    'c1@t.local','03', 'active'),
    (_cus2,  _eco, 'Cus2',    'c2@t.local','04', 'active'),
    (_foreign, _eco2, 'Other','o@t.local', '05', 'active');
  INSERT INTO public.user_roles (user_id, role, ecosystem_id) VALUES
    (_admin,'admin',_eco), (_resA,'reseller',_eco), (_resB,'reseller',_eco),
    (_cus1,'customer',_eco), (_cus2,'customer',_eco), (_foreign,'customer',_eco2);

  -- subresellers need their parent set at insert time (validate_member_parent)
  INSERT INTO public.user_roles (user_id, role, ecosystem_id) VALUES
    (_subA,'subreseller',_eco), (_subB,'subreseller',_eco);
  INSERT INTO public.profiles (id, ecosystem_id, full_name, email, phone, status, reseller_id) VALUES
    (_subA, _eco, 'SubA', 'sa@t.local', '06', 'active', _resA),
    (_subB, _eco, 'SubB', 'sb@t.local', '07', 'active', _resB);

  -- Admin can credit every member role in its own shop
  ASSERT public.can_load_credits(_admin, _resA), 'admin -> reseller must be allowed';
  ASSERT public.can_load_credits(_admin, _subA), 'admin -> subreseller must be allowed';
  ASSERT public.can_load_credits(_admin, _cus1), 'admin -> customer must be allowed';
  ASSERT NOT public.can_load_credits(_admin, _foreign), 'admin -> other ecosystem must fail';

  -- Reseller
  ASSERT public.can_load_credits(_resA, _cus1), 'reseller -> any customer must be allowed';
  ASSERT public.can_load_credits(_resA, _cus2), 'reseller -> customer of another reseller must be allowed';
  ASSERT public.can_load_credits(_resA, _subA), 'reseller -> own subreseller must be allowed';
  ASSERT NOT public.can_load_credits(_resA, _subB), 'reseller -> foreign subreseller must fail';
  ASSERT NOT public.can_load_credits(_resB, _subA), 'reseller -> foreign subreseller must fail';
  ASSERT NOT public.can_load_credits(_resA, _resB), 'reseller -> reseller must fail';
  ASSERT NOT public.can_load_credits(_resA, _admin), 'reseller -> admin must fail';
  ASSERT NOT public.can_load_credits(_resA, _foreign), 'cross-ecosystem load must fail';

  -- Subreseller
  ASSERT public.can_load_credits(_subA, _cus1), 'subreseller -> customer must be allowed';
  ASSERT NOT public.can_load_credits(_subA, _subB), 'subreseller -> subreseller must fail';
  ASSERT NOT public.can_load_credits(_subA, _resA), 'subreseller -> reseller must fail';
  ASSERT NOT public.can_load_credits(_subA, _admin), 'subreseller -> admin must fail';
  ASSERT NOT public.can_load_credits(_subA, _foreign), 'cross-ecosystem load must fail';

  -- Customers never act as loaders
  ASSERT NOT public.can_load_credits(_cus1, _cus2), 'customer is not a loader';
  ASSERT NOT public.can_load_credits(_cus1, _admin), 'customer -> admin must fail';

  -- Cross-ecosystem parent assignment must be rejected
  BEGIN
    UPDATE public.profiles SET reseller_id = _resA WHERE id = _foreign;
    RAISE EXCEPTION 'cross-ecosystem parent assignment should have failed';
  EXCEPTION WHEN others THEN
    IF position('same shop' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  RAISE NOTICE 'transfer authorization matrix passed';
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- Suspended actors may never move money (added in the final verification pass).
-- transfer_credits / reseller_load_credits both call public.assert_actor_active().
-- Run as a privileged role; psql QA role cannot execute SECURITY DEFINER RPCs.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select prosrc from pg_proc where proname = 'transfer_credits')
       not like '%assert_actor_active%' then
    raise exception 'FAIL: transfer_credits does not block suspended senders';
  end if;
  if (select prosrc from pg_proc where proname = 'reseller_load_credits')
       not like '%assert_actor_active%' then
    raise exception 'FAIL: reseller_load_credits does not block suspended senders';
  end if;
  raise notice 'PASS: suspended-sender guard present on both transfer paths';
end $$;

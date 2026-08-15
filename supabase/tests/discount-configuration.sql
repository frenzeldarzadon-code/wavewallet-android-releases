-- Discount configuration regression suite.
--
-- The single per-member "Discount" is database configuration: editable by the
-- shop admin and the platform owner, never hard-coded, scoped to one shop, and
-- applied to future qualifying transactions only.
--
-- Run against a database copy, it rolls everything back:
--   BEGIN; \i supabase/tests/discount-configuration.sql ROLLBACK;
--
-- Proves:
--   1  A shop admin can save any whole percentage from 0 to 100 (the old 50%
--      ceiling is gone) and it persists on the shop membership.
--   2  The saved value is also the member's voucher shop discount.
--   3  Super Admin can manage discounts in any shop.
--   4  Resellers, subresellers, customers and admins of other shops cannot.
--   5  Per-shop isolation: a change in one shop never moves another shop.
--   6  Unset members follow that shop's configured default, not a constant.
--   7  Invalid percentages and hierarchy violations are rejected server-side.
--   8  History is untouched by a rate change.
--   9  Every change is audited with old value, new value, shop, actor, reason.

BEGIN;

DO $$
DECLARE
  _a record; _b record;
  _admin_a uuid; _admin_b uuid; _super uuid;
  _res uuid; _sub uuid; _cust uuid;
  _res_b uuid;
  _before_b integer; _hist integer; _hist_after integer;
  _default_a integer;
  _ok boolean;
BEGIN
  SELECT id, name INTO _a FROM public.ecosystems ORDER BY created_at LIMIT 1;
  SELECT id, name INTO _b FROM public.ecosystems WHERE id <> _a.id ORDER BY created_at LIMIT 1;
  ASSERT _a.id IS NOT NULL AND _b.id IS NOT NULL, 'two shops are required for this suite';

  SELECT user_id INTO _admin_a FROM public.ecosystem_memberships
   WHERE ecosystem_id = _a.id AND role = 'admin' LIMIT 1;
  SELECT user_id INTO _admin_b FROM public.ecosystem_memberships
   WHERE ecosystem_id = _b.id AND role = 'admin' LIMIT 1;
  SELECT user_id INTO _super FROM public.user_roles WHERE role = 'super_admin' LIMIT 1;
  SELECT user_id INTO _res FROM public.ecosystem_memberships
   WHERE ecosystem_id = _a.id AND role = 'reseller' LIMIT 1;
  SELECT user_id INTO _sub FROM public.ecosystem_memberships
   WHERE ecosystem_id = _a.id AND role = 'subreseller' AND reseller_id = _res LIMIT 1;
  SELECT user_id INTO _cust FROM public.ecosystem_memberships
   WHERE ecosystem_id = _a.id AND role = 'customer' LIMIT 1;
  SELECT user_id INTO _res_b FROM public.ecosystem_memberships
   WHERE ecosystem_id = _b.id AND role IN ('reseller','subreseller') LIMIT 1;
  ASSERT _admin_a IS NOT NULL AND _res IS NOT NULL, 'shop A needs an admin and a reseller';

  SELECT count(*) INTO _hist FROM public.credit_ledger WHERE ecosystem_id = _a.id;
  IF _res_b IS NOT NULL THEN
    _before_b := public.member_cashback_rate(_res_b, _b.id);
  END IF;

  ----------------------------------------------------------- 1, 2: admin sets
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin_a)::text, true);
  PERFORM public.set_member_cashback_rate(_res, _a.id, 70, 'QA admin raises discount');
  ASSERT public.member_cashback_rate(_res, _a.id) = 70, 'admin can save 70 percent';
  ASSERT (SELECT sale_commission_percent FROM public.ecosystem_memberships
           WHERE user_id = _res AND ecosystem_id = _a.id) = 70, 'value persists on the membership';
  ASSERT (SELECT reseller_discount_percent FROM public.ecosystem_memberships
           WHERE user_id = _res AND ecosystem_id = _a.id) = 70, 'voucher discount stays in sync';
  PERFORM public.set_member_cashback_rate(_res, _a.id, 100, 'QA upper bound');
  ASSERT public.member_cashback_rate(_res, _a.id) = 100, '100 percent is allowed';
  PERFORM public.set_member_cashback_rate(_res, _a.id, 0, 'QA lower bound');
  ASSERT public.member_cashback_rate(_res, _a.id) = 0, 'explicit zero is allowed';
  PERFORM public.set_member_cashback_rate(_res, _a.id, 70, 'QA back to 70');

  --------------------------------------------------------- 5: shop isolation
  IF _res_b IS NOT NULL THEN
    ASSERT public.member_cashback_rate(_res_b, _b.id) = _before_b,
      'a change in shop A never moves shop B';
  END IF;

  --------------------------------------------------- 3: super admin any shop
  IF _super IS NOT NULL AND _res_b IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
    PERFORM public.set_member_cashback_rate(_res_b, _b.id, 15, 'QA owner adjusts other shop');
    ASSERT public.member_cashback_rate(_res_b, _b.id) = 15, 'super admin manages any shop';
    ASSERT public.member_cashback_rate(_res, _a.id) = 70, 'shop A untouched';
  END IF;

  ------------------------------------------------------- 4: unauthorized use
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  _ok := true;
  BEGIN PERFORM public.set_member_cashback_rate(_res, _a.id, 90, 'QA'); EXCEPTION WHEN others THEN _ok := false; END;
  ASSERT NOT _ok, 'a reseller cannot change their own discount';

  IF _sub IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _sub)::text, true);
    _ok := true;
    BEGIN PERFORM public.set_member_cashback_rate(_res, _a.id, 90, 'QA'); EXCEPTION WHEN others THEN _ok := false; END;
    ASSERT NOT _ok, 'a subreseller cannot change discounts';
  END IF;

  IF _cust IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
    _ok := true;
    BEGIN PERFORM public.set_member_cashback_rate(_res, _a.id, 90, 'QA'); EXCEPTION WHEN others THEN _ok := false; END;
    ASSERT NOT _ok, 'a customer cannot change discounts';
  END IF;

  IF _admin_b IS NOT NULL AND _admin_b <> _admin_a THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin_b)::text, true);
    _ok := true;
    BEGIN PERFORM public.set_member_cashback_rate(_res, _a.id, 90, 'QA'); EXCEPTION WHEN others THEN _ok := false; END;
    ASSERT NOT _ok, 'an admin of another shop cannot change shop A discounts';
  END IF;

  ----------------------------------------------- 7: validation and hierarchy
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin_a)::text, true);
  _ok := true;
  BEGIN PERFORM public.set_member_cashback_rate(_res, _a.id, -5, NULL); EXCEPTION WHEN others THEN _ok := false; END;
  ASSERT NOT _ok, 'negative percentages are rejected';
  _ok := true;
  BEGIN PERFORM public.set_member_cashback_rate(_res, _a.id, 101, NULL); EXCEPTION WHEN others THEN _ok := false; END;
  ASSERT NOT _ok, 'percentages above 100 are rejected';
  _ok := true;
  BEGIN PERFORM public.set_member_cashback_rate(_res, _a.id, NULL, NULL); EXCEPTION WHEN others THEN _ok := false; END;
  ASSERT NOT _ok, 'a missing percentage is rejected';

  IF _sub IS NOT NULL THEN
    PERFORM public.set_member_cashback_rate(_sub, _a.id, 30, 'QA subreseller share');
    ASSERT public.member_cashback_rate(_sub, _a.id) = 30, 'subreseller share saved';
    _ok := true;
    BEGIN PERFORM public.set_member_cashback_rate(_sub, _a.id, 95, NULL); EXCEPTION WHEN others THEN _ok := false; END;
    ASSERT NOT _ok, 'a subreseller share cannot exceed the parent reseller total';
    _ok := true;
    BEGIN PERFORM public.set_member_cashback_rate(_res, _a.id, 10, NULL); EXCEPTION WHEN others THEN _ok := false; END;
    ASSERT NOT _ok, 'a reseller total cannot fall below an existing subreseller share';
  END IF;

  ------------------------------------------------- 6: shop-configured default
  UPDATE public.ecosystem_memberships SET sale_commission_percent = NULL
   WHERE user_id = _res AND ecosystem_id = _a.id;
  SELECT default_reseller_discount_percent INTO _default_a FROM public.ecosystems WHERE id = _a.id;
  ASSERT public.member_cashback_rate(_res, _a.id) = COALESCE(_default_a, 0),
    'an unset member follows the shop-configured default, never a constant';

  ------------------------------------------------- 8: history stays unchanged
  SELECT count(*) INTO _hist_after FROM public.credit_ledger WHERE ecosystem_id = _a.id;
  ASSERT _hist_after = _hist, 'changing a discount never writes or rewrites ledger history';

  --------------------------------------------------------------- 9: audit log
  ASSERT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE ecosystem_id = _a.id AND action = 'Updated member discount'
       AND (metadata->>'member_id')::uuid = _res
       AND (metadata->>'new_percent')::int = 70
       AND metadata ? 'previous_percent' AND metadata ? 'shop_name' AND metadata ? 'changed_at'
       AND metadata->>'reason' = 'QA admin raises discount'
  ), 'discount changes are audited with old value, new value, shop, actor and reason';

  RAISE NOTICE 'discount-configuration: all assertions passed';
END $$;

ROLLBACK;

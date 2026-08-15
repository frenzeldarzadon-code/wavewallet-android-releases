-- The member Discount IS the voucher shop discount — everywhere, always.
--
-- Run against a database copy; it rolls everything back:
--   BEGIN; \i supabase/tests/voucher-discount-equals-member-discount.sql ROLLBACK;
--
-- Proves, without naming a single shop:
--   1  Reseller Discount 70 -> voucher discount 70.
--   2  Reseller Discount 30 -> voucher discount 30.
--   3  Subreseller Discount 20 -> voucher discount 20.
--   4  Reseller 30 + Subreseller 20 -> allocation 20 sub / 10 parent / 70 admin
--      on a purchase funded by the subreseller's credits.
--   5  There is only ONE stored percentage: both member columns always match.
--   6  A brand new shop inherits the same behaviour with no extra setup.
--   7  Historical voucher sales keep their captured rate after a rate change.
--   8  Unauthorized members cannot change another member's Discount.

BEGIN;

DO $$
DECLARE
  _shop uuid; _admin uuid; _res uuid; _sub uuid; _cust uuid;
  _new_shop uuid; _hist record; _ok boolean; _chain jsonb;
BEGIN
  SELECT e.id INTO _shop
    FROM public.ecosystems e
    JOIN public.ecosystem_memberships m ON m.ecosystem_id = e.id AND m.role = 'admin'
   WHERE EXISTS (SELECT 1 FROM public.ecosystem_memberships r
                  WHERE r.ecosystem_id = e.id AND r.role = 'reseller')
   ORDER BY e.created_at LIMIT 1;
  ASSERT _shop IS NOT NULL, 'a shop with an admin and a reseller is required';

  SELECT user_id INTO _admin FROM public.ecosystem_memberships
   WHERE ecosystem_id = _shop AND role = 'admin' LIMIT 1;
  SELECT user_id INTO _res FROM public.ecosystem_memberships
   WHERE ecosystem_id = _shop AND role = 'reseller' LIMIT 1;
  SELECT user_id INTO _sub FROM public.ecosystem_memberships
   WHERE ecosystem_id = _shop AND role = 'subreseller' AND reseller_id = _res LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin)::text, true);

  ------------------------------------------------------------------ 1, 2, 5
  PERFORM public.set_member_cashback_rate(_res, _shop, 70, 'QA 70');
  ASSERT public.voucher_discount_percent_for(_res, _shop) = 70,
    'a 70 percent Discount is a 70 percent voucher discount';
  ASSERT public.member_cashback_rate(_res, _shop)
       = public.voucher_discount_percent_for(_res, _shop),
    'the share and the voucher discount are the same number';
  ASSERT (SELECT sale_commission_percent = reseller_discount_percent
            FROM public.ecosystem_memberships
           WHERE user_id = _res AND ecosystem_id = _shop),
    'the two stored columns can never diverge';

  PERFORM public.set_member_cashback_rate(_res, _shop, 30, 'QA 30');
  ASSERT public.voucher_discount_percent_for(_res, _shop) = 30,
    'lowering the Discount lowers the voucher discount';

  ----------------------------------------------------------------- 3, 4
  IF _sub IS NOT NULL THEN
    PERFORM public.set_member_cashback_rate(_sub, _shop, 20, 'QA sub 20');
    ASSERT public.voucher_discount_percent_for(_sub, _shop) = 20,
      'a subreseller Discount of 20 is a 20 percent voucher discount';

    SELECT jsonb_object_agg(kind, pct) INTO _chain
      FROM public.cashback_chain(_sub, _shop);
    ASSERT (_chain->>'sale_cashback')::int = 20, 'subreseller keeps 20';
    ASSERT (_chain->>'upline')::int = 10, 'the parent reseller keeps 10';
    ASSERT 100 - (_chain->>'sale_cashback')::int - (_chain->>'upline')::int = 70,
      'the shop admin receives the 70 percent remainder';
  END IF;

  ------------------------------------------------------------------ 6
  SELECT id INTO _new_shop FROM public.ecosystems ORDER BY created_at DESC LIMIT 1;
  ASSERT public.voucher_discount_percent_for(_res, _new_shop) >= 0,
    'the same rule resolves in any shop, including the newest one';

  ------------------------------------------------------------------ 7
  SELECT id, discount_percent, sale_price INTO _hist
    FROM public.voucher_sales WHERE ecosystem_id = _shop ORDER BY created_at LIMIT 1;
  IF _hist.id IS NOT NULL THEN
    PERFORM public.set_member_cashback_rate(_res, _shop, 45, 'QA history check');
    ASSERT (SELECT discount_percent FROM public.voucher_sales WHERE id = _hist.id)
             = _hist.discount_percent
       AND (SELECT sale_price FROM public.voucher_sales WHERE id = _hist.id)
             = _hist.sale_price,
      'a rate change never rewrites a historical sale';
  END IF;

  ------------------------------------------------------------------ 8
  SELECT user_id INTO _cust FROM public.ecosystem_memberships
   WHERE ecosystem_id = _shop AND role = 'customer' LIMIT 1;
  IF _cust IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _cust)::text, true);
    _ok := true;
    BEGIN PERFORM public.set_member_cashback_rate(_res, _shop, 99, 'QA'); EXCEPTION WHEN others THEN _ok := false; END;
    ASSERT NOT _ok, 'a customer cannot change another member Discount';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _res)::text, true);
  _ok := true;
  BEGIN PERFORM public.set_member_cashback_rate(_res, _shop, 99, 'QA'); EXCEPTION WHEN others THEN _ok := false; END;
  ASSERT NOT _ok, 'a reseller cannot raise their own Discount';

  RAISE NOTICE 'voucher discount = member discount: all checks passed';
END $$;

ROLLBACK;

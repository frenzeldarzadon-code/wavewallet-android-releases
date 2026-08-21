-- 1) Scope every points wallet lookup and reward authorization to the target shop.
DO $mig$
DECLARE r record; d text; n text;
BEGIN
  FOR r IN
    SELECT oid, proname FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname = ANY (ARRAY['admin_adjust_points','purchase_voucher','purchase_voucher_with_points',
                                'refund_voucher_sale','request_redemption','reverse_sale_points',
                                'review_redemption','list_ecosystem_redemptions','lookup_redemption'])
  LOOP
    d := pg_get_functiondef(r.oid);
    n := d;

    -- wallet lookups: always resolve the shop-specific points account
    n := replace(n, 'select id into _acct from public.points_accounts where user_id = _user_id;',
                    'select id into _acct from public.points_accounts where user_id = _user_id and ecosystem_id = _eco;');
    n := replace(n, 'select id into _pacct from public.points_accounts where user_id = _subject;',
                    'select id into _pacct from public.points_accounts where user_id = _subject and ecosystem_id = _my_eco;');
    n := replace(n, 'select id into _pacct from public.points_accounts where user_id = _s.buyer_id;',
                    'select id into _pacct from public.points_accounts where user_id = _s.buyer_id and ecosystem_id = _s.ecosystem_id;');
    n := replace(n, 'select id into _pacct from public.points_accounts where user_id = _orig.user_id;',
                    'select id into _pacct from public.points_accounts where user_id = _orig.user_id and ecosystem_id = _orig.ecosystem_id;');
    n := replace(n, 'select pa.id into _acct from public.points_accounts pa where pa.user_id = _subject;',
                    'select pa.id into _acct from public.points_accounts pa where pa.user_id = _subject and pa.ecosystem_id = _my_eco;');
    n := replace(n, 'select id into _acct from public.points_accounts where user_id = _orig.user_id;',
                    'select id into _acct from public.points_accounts where user_id = _orig.user_id and ecosystem_id = _orig.ecosystem_id;');
    n := replace(n, 'select id into _acct from public.points_accounts where user_id = _r.user_id;',
                    'select id into _acct from public.points_accounts where user_id = _r.user_id and ecosystem_id = _r.ecosystem_id;');
    n := replace(n, 'select id into _pacct from public.points_accounts where user_id = _subject and (ecosystem_id = _my_eco or ecosystem_id is null) order by (ecosystem_id is null) limit 1;',
                    'select id into _pacct from public.points_accounts where user_id = _subject and ecosystem_id = _my_eco;');

    -- reward authorization: shop-scoped membership role instead of a global role + profile pointer
    n := replace(n, E'          or (public.has_role(auth.uid(), \'reseller\')\n              and public.current_ecosystem(auth.uid()) = _ecosystem_id)) then',
                    E'          or (public.membership_role(auth.uid(), _ecosystem_id) in (\'reseller\',\'subreseller\'))) then');
    n := replace(n, E'            or (public.has_role(auth.uid(), \'reseller\')\n                and public.current_ecosystem(auth.uid()) = _r.ecosystem_id)) then',
                    E'            or (public.membership_role(auth.uid(), _r.ecosystem_id) in (\'reseller\',\'subreseller\'))) then');
    n := replace(n, E'                                    or public.has_role(auth.uid(), \'reseller\')))) then',
                    E'                                    or public.membership_role(auth.uid(), _eco) in (\'reseller\',\'subreseller\')))) then');

    IF n <> d THEN EXECUTE n; END IF;
  END LOOP;

  -- verification: no reward/points routine may resolve a wallet by user alone
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname = ANY (ARRAY['admin_adjust_points','purchase_voucher','purchase_voucher_with_points',
                                'refund_voucher_sale','request_redemption','reverse_sale_points','review_redemption'])
       AND prosrc ~ 'points_accounts[^;]*user_id = [^;]*;'
       AND prosrc !~ 'points_accounts[^;]*ecosystem_id'
  ) THEN
    RAISE EXCEPTION 'Unscoped points wallet lookup still present';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace
       AND proname = ANY (ARRAY['list_ecosystem_redemptions','lookup_redemption','review_redemption'])
       AND prosrc ILIKE '%has_role(auth.uid(), ''reseller'')%'
  ) THEN
    RAISE EXCEPTION 'Unscoped reseller authorization still present in reward routines';
  END IF;
END
$mig$;

-- 2) Members may only read rewards of a shop they are actually an active member of.
DROP POLICY IF EXISTS "Members read active rewards in their shop" ON public.reward_products;
CREATE POLICY "Members read active rewards in their shop"
ON public.reward_products
FOR SELECT
TO authenticated
USING (
  ecosystem_id = current_ecosystem(auth.uid())
  AND has_membership(auth.uid(), ecosystem_id)
);
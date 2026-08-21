DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.ecosystem_dashboard(uuid)',
    'public.platform_unassigned_users(text)',
    'public.platform_user_deletion_check(uuid, boolean)',
    'public.search_members(text, uuid)',
    'public.super_list_members(text, uuid, text, integer, integer)',
    'public.super_member_accounts(uuid)',
    'public.purchase_voucher(uuid, integer)',
    'public.refund_voucher_sale(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
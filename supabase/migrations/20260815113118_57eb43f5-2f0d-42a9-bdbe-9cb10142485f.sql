-- Expense + discount helpers: signed-in only (they were open via PUBLIC)
REVOKE EXECUTE ON FUNCTION public.record_expense(numeric, text, text, uuid, text, timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_expense(numeric, text, text, uuid, text, timestamptz, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.voucher_discount_percent_for(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voucher_discount_percent_for(uuid, uuid) TO authenticated;

-- Internal-only SECURITY DEFINER helpers: not part of the client API surface
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname IN (
        'admin_sale_commission_rate_for','cashback_chain','ecosystem_last_activity',
        'ecosystem_monthly_rate','expire_stale_invitations','membership_role','money_settings',
        'my_rating_eligibility','require_operational','resolve_member_shop','reverse_sale_commission',
        'reverse_sale_points','review_subscription','sale_commission_rate_for',
        'set_admin_sale_commission','set_reseller_discount','social_can_moderate',
        'social_effective_settings','social_free_posts_used','social_move','social_my_credit_history',
        'social_post_visible_in','social_rate_limit','social_wallet','subscription_ok','top_role',
        'upline_commission_rate_for','wallet_id_for'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.sig);
  END LOOP;
END $$;
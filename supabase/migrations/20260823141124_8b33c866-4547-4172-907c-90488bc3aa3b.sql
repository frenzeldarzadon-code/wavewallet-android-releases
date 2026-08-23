-- 1. UI layout configuration is internal app structure: signed-in only.
DROP POLICY IF EXISTS "ui layout readable by everyone" ON public.ui_layout_configs;
CREATE POLICY "ui layout readable by signed-in members"
  ON public.ui_layout_configs FOR SELECT TO authenticated USING (true);

-- 2. Retail product images mirror the retail_products visibility rules.
DROP POLICY IF EXISTS "Anyone can view retail product images" ON storage.objects;
CREATE POLICY "Retail images follow product visibility"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'retail-images'
    AND (
      -- Publicly listed product on a live public storefront.
      EXISTS (
        SELECT 1 FROM public.retail_products p
        JOIN public.ecosystems e ON e.id = p.ecosystem_id
        WHERE p.image_path = storage.objects.name
          AND p.active AND NOT p.archived AND p.public_visible
          AND e.public_storefront_enabled AND e.store_retail_enabled
          AND e.archived_at IS NULL
      )
      -- The shop's own people (and the platform owner) always see their images.
      OR (
        split_part(storage.objects.name, '/', 1)
          ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND (
          public.is_super_admin(auth.uid())
          OR public.is_ecosystem_admin(auth.uid(), split_part(storage.objects.name, '/', 1)::uuid)
          OR public.has_membership(auth.uid(), split_part(storage.objects.name, '/', 1)::uuid)
        )
      )
    )
  );

-- 3. Signed-in-only RPCs must not be callable by anonymous clients.
--    Every function below already refuses an unauthenticated caller; this
--    removes the ability to reach them at all. Public/pre-login functions
--    (signup, shop discovery, guide, listener ingest, bootstrap) are untouched.
DO $$
DECLARE _fn text; _sig text;
BEGIN
  FOR _sig IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'activate_free_subscription','cash_in_duplicate_indicator','cash_in_reference_conflict_list',
        'delete_listener_source_rule','dismiss_listener_event','ecosystem_platform_payment_option',
        'expire_push_device','listener_source_rules_list','listener_unmatched_events',
        'my_notifications','my_push_devices','register_listener_device','register_push_device',
        'remove_push_device','request_cash_in','resolve_cash_in_reference_conflict',
        'restore_ui_layout','set_cash_in_auto_approval','set_ecosystem_cash_in_number',
        'set_ecosystem_platform_payment_methods','set_listener_source_rule','set_push_device_enabled',
        'set_shop_address','set_ui_layout','submit_go_live_payment','update_app_release',
        'upsert_payment_method'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', _sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', _sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _sig);
  END LOOP;
END $$;
-- Profile shop ordering is owner-controlled but only exposes currently visible,
-- authorized Universe storefront sections. Read-only test; transaction rolls back.
DO $$
DECLARE
  _seller uuid; _handle text; _first text; _second text;
  _positions integer[]; _actual text[];
BEGIN
  SELECT p.id, p.handle INTO _seller, _handle
    FROM public.profiles p
   WHERE p.handle IS NOT NULL AND p.deleted_at IS NULL AND p.status = 'active'
     AND (SELECT count(*) FROM public.seller_storefront_section_order(p.handle)) >= 2
   LIMIT 1;
  IF _seller IS NULL THEN
    RAISE NOTICE 'Profile ordering test skipped: no seller with two visible sections';
    RETURN;
  END IF;

  SELECT section_key INTO _first FROM public.seller_storefront_section_order(_handle)
   ORDER BY display_position LIMIT 1;
  SELECT section_key INTO _second FROM public.seller_storefront_section_order(_handle)
   ORDER BY display_position OFFSET 1 LIMIT 1;

  UPDATE public.profiles SET preferences = coalesce(preferences, '{}'::jsonb) ||
    jsonb_build_object('storefront_section_order',
      jsonb_build_array(_second, 'retail:00000000-0000-0000-0000-000000000000', _first, _second))
   WHERE id = _seller;

  SELECT array_agg(section_key ORDER BY display_position), array_agg(display_position ORDER BY display_position)
    INTO _actual, _positions FROM public.seller_storefront_section_order(_handle);
  ASSERT _actual[1:2] = ARRAY[_second, _first],
    'saved visible sections must control order; unknown and duplicate keys must be ignored';
  ASSERT _positions = ARRAY(SELECT generate_series(1, cardinality(_positions))),
    'Profile positions must be contiguous';
  ASSERT NOT has_function_privilege('anon', 'public.seller_storefront_section_order(text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.seller_storefront_section_order(text)', 'EXECUTE');
END;
$$;
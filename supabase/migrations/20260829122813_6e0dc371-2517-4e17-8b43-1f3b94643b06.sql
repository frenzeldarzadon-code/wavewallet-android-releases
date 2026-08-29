CREATE OR REPLACE FUNCTION public.cashback_sale_sources(_sale_ids uuid[])
RETURNS TABLE (sale_id uuid, buyer_role app_role, quantity integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.buyer_role, s.quantity
  FROM public.voucher_sales s
  WHERE s.id = ANY(_sale_ids)
    AND (
      s.buyer_id = auth.uid()
      OR s.commission_recipient_id = auth.uid()
      OR s.upline_recipient_id = auth.uid()
      OR s.reseller_id = auth.uid()
      OR public.is_ecosystem_admin(auth.uid(), s.ecosystem_id)
      OR public.is_super_admin(auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.cashback_sale_sources(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cashback_sale_sources(uuid[]) TO authenticated;

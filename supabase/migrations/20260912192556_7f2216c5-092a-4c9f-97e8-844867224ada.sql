REVOKE ALL ON public.coin_loans FROM anon, authenticated;
REVOKE ALL ON public.coin_loan_entries FROM anon, authenticated;
GRANT SELECT ON public.coin_loans TO authenticated;
GRANT SELECT ON public.coin_loan_entries TO authenticated;
GRANT ALL ON public.coin_loans TO service_role;
GRANT ALL ON public.coin_loan_entries TO service_role;
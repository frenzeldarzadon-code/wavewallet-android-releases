CREATE UNIQUE INDEX IF NOT EXISTS points_ledger_tx_id_key
  ON public.points_ledger (tx_id) WHERE tx_id IS NOT NULL;

ALTER TABLE public.credit_accounts
  ADD CONSTRAINT credit_accounts_balance_nonneg CHECK (balance >= 0) NOT VALID;
ALTER TABLE public.credit_accounts VALIDATE CONSTRAINT credit_accounts_balance_nonneg;

ALTER TABLE public.points_accounts
  ADD CONSTRAINT points_accounts_balance_nonneg CHECK (balance >= 0 AND held >= 0) NOT VALID;
ALTER TABLE public.points_accounts VALIDATE CONSTRAINT points_accounts_balance_nonneg;

ALTER TABLE public.credit_lots
  ADD CONSTRAINT credit_lots_remaining_range CHECK (remaining >= 0 AND remaining <= amount) NOT VALID;
ALTER TABLE public.credit_lots VALIDATE CONSTRAINT credit_lots_remaining_range;

REVOKE ALL ON FUNCTION public.track_credit_lots() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_member_parent() FROM PUBLIC, anon;
ALTER TABLE public.omada_voucher_calibrations
  ADD COLUMN IF NOT EXISTS last_auto_check_at timestamptz;

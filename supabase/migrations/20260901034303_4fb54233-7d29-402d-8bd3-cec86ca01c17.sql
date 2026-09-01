-- Remember the exact controller portal page and the original Omada context so
-- the customer can be sent back to the SAME page to redeem their voucher there.
ALTER TABLE public.portal_sessions
  ADD COLUMN IF NOT EXISTS raw_query jsonb,
  ADD COLUMN IF NOT EXISTS page_url text;

-- Single-use, short-lived tickets: the wallet page sends the browser back to
-- the controller portal with a ticket (never the code); the portal page
-- exchanges it once for the dispensed voucher code and submits Omada's own form.
CREATE TABLE public.portal_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  session_id uuid NOT NULL REFERENCES public.portal_sessions(id) ON DELETE CASCADE,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  authorization_id uuid REFERENCES public.portal_authorizations(id) ON DELETE SET NULL,
  sale_id uuid,
  voucher_code text NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','claimed','succeeded','failed')),
  error text,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backend-only: tickets carry voucher codes, so nothing short of the service
-- role may touch them. RLS is enabled with NO policies on purpose.
GRANT ALL ON public.portal_redemptions TO service_role;
ALTER TABLE public.portal_redemptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_portal_redemptions_session ON public.portal_redemptions (session_id);
CREATE INDEX idx_portal_redemptions_expires ON public.portal_redemptions (expires_at);
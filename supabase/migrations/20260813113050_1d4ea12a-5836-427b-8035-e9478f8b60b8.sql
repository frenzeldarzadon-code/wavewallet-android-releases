-- Platform credit issuance authority: the immutable record of credits minted
-- by the platform owner. Never debits any wallet; it is the supply source.
CREATE TABLE public.platform_credit_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id text NOT NULL,
  request_key text NOT NULL UNIQUE,
  operator_id uuid NOT NULL,
  operator_name text NOT NULL,
  recipient_id uuid NOT NULL,
  recipient_name text NOT NULL,
  recipient_role app_role,
  ecosystem_id uuid REFERENCES public.ecosystems(id) ON DELETE SET NULL,
  ecosystem_name text,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  balance_before numeric(14,2) NOT NULL,
  balance_after numeric(14,2) NOT NULL,
  reason text NOT NULL,
  category text,
  reference text,
  ledger_id uuid REFERENCES public.credit_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_credit_issuances TO authenticated;
GRANT ALL ON public.platform_credit_issuances TO service_role;

ALTER TABLE public.platform_credit_issuances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform owner reads issuances"
  ON public.platform_credit_issuances FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Recipients read their own issuances"
  ON public.platform_credit_issuances FOR SELECT TO authenticated
  USING (recipient_id = public.effective_uid());

-- Immutable: no updates, no deletes.
CREATE TRIGGER platform_credit_issuances_immutable
  BEFORE UPDATE OR DELETE ON public.platform_credit_issuances
  FOR EACH ROW EXECUTE FUNCTION public.block_ledger_mutation();

CREATE INDEX platform_credit_issuances_created_idx
  ON public.platform_credit_issuances (created_at DESC);

-- Issuance RPC: platform owner only, atomic, idempotent per request key.
CREATE OR REPLACE FUNCTION public.superadmin_issue_credits(
  _user_id uuid,
  _amount numeric,
  _reason text,
  _category text DEFAULT NULL,
  _reference text DEFAULT NULL,
  _request_key text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _eco uuid; _eco_name text; _acct uuid; _tx text; _key text;
  _actor text; _target text; _role app_role;
  _before numeric(14,2); _after numeric(14,2); _ledger uuid; _existing text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can issue credits';
  end if;
  if _amount is null or _amount <= 0 then
    raise exception 'Enter how many credits to issue';
  end if;
  if _amount <> trunc(_amount) then
    raise exception 'Credits must be a whole number';
  end if;
  if _amount > 10000000 then
    raise exception 'A single issuance is limited to 10,000,000 credits';
  end if;
  if coalesce(trim(_reason),'') = '' then
    raise exception 'A reason is required';
  end if;

  _key := coalesce(nullif(trim(_request_key),''), gen_random_uuid()::text);

  select tx_id into _existing from public.platform_credit_issuances where request_key = _key;
  if _existing is not null then
    return _existing;  -- duplicate submission: the credits were already issued once
  end if;

  select p.ecosystem_id, p.full_name || ' — ' || p.email
    into _eco, _target
    from public.profiles p where p.id = _user_id;
  if _target is null then raise exception 'Member not found'; end if;

  select name into _eco_name from public.ecosystems where id = _eco;
  select role into _role from public.user_roles
   where user_id = _user_id and (ecosystem_id is not distinct from _eco or ecosystem_id is null)
   limit 1;

  -- Serialize concurrent issuances to the same wallet.
  select id, balance into _acct, _before
    from public.credit_accounts where user_id = _user_id for update;
  if _acct is null then raise exception 'This member has no credit wallet yet'; end if;

  _tx := public.new_tx_id();

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind,
                                    base_amount, commission_percent, commission_amount)
  values (_acct, _user_id, _eco, 'credit', _amount, 0, trim(_reason),
          nullif(trim(_reference),''), auth.uid(), _tx, 'superadmin_credit_issuance',
          _amount, 0, 0)
  returning id, balance_after into _ledger, _after;

  select full_name into _actor from public.profiles where id = auth.uid();

  insert into public.platform_credit_issuances (
    tx_id, request_key, operator_id, operator_name, recipient_id, recipient_name,
    recipient_role, ecosystem_id, ecosystem_name, amount, balance_before, balance_after,
    reason, category, reference, ledger_id)
  values (_tx, _key, auth.uid(), coalesce(_actor,'Super Admin'), _user_id, _target,
          _role, _eco, _eco_name, _amount, _before, _after,
          trim(_reason), nullif(trim(_category),''), nullif(trim(_reference),''), _ledger);

  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Super Admin'),
          'Issued platform credits', _target,
          jsonb_build_object('amount', _amount, 'reason', trim(_reason),
                             'category', nullif(trim(_category),''), 'reference', nullif(trim(_reference),''),
                             'balance_before', _before, 'balance_after', _after,
                             'entry_kind', 'superadmin_credit_issuance', 'tx_id', _tx));
  return _tx;
end; $$;

REVOKE ALL ON FUNCTION public.superadmin_issue_credits(uuid, numeric, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_issue_credits(uuid, numeric, text, text, text, text) TO authenticated;

-- Cumulative issuance supply, readable by the platform owner.
CREATE OR REPLACE FUNCTION public.platform_credit_supply()
RETURNS TABLE (total_issued numeric, issuance_count bigint, last_issued_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select coalesce(sum(amount),0)::numeric, count(*)::bigint, max(created_at)
  from public.platform_credit_issuances
  where public.is_super_admin(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.platform_credit_supply() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_credit_supply() TO authenticated;

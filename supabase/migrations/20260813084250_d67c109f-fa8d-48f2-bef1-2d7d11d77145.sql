-- Secure "Access Account" (act-as) delegation with dual-identity audit.
CREATE TABLE public.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL,
  operator_name text NOT NULL,
  operator_role public.app_role NOT NULL,
  target_id uuid NOT NULL,
  target_name text NOT NULL,
  target_role public.app_role NOT NULL,
  ecosystem_id uuid NOT NULL REFERENCES public.ecosystems(id),
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '60 minutes',
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.impersonation_sessions TO authenticated;
GRANT ALL ON public.impersonation_sessions TO service_role;
ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read their own act-as sessions"
ON public.impersonation_sessions FOR SELECT TO authenticated
USING (operator_id = auth.uid()
       OR public.is_super_admin(auth.uid())
       OR public.is_ecosystem_admin(auth.uid(), ecosystem_id));

CREATE INDEX impersonation_sessions_active_idx
  ON public.impersonation_sessions (operator_id, ended_at, expires_at);

CREATE TRIGGER update_impersonation_sessions_updated_at
BEFORE UPDATE ON public.impersonation_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.top_role(_user_id uuid)
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
   ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'reseller' THEN 2
                      WHEN 'subreseller' THEN 3 ELSE 4 END
   LIMIT 1
$$;

-- Who may enter whose account. Never an admin, never a super admin, never cross-shop.
CREATE OR REPLACE FUNCTION public.can_impersonate(_operator uuid, _target uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare _trole public.app_role; _teco uuid; _tdel timestamptz;
begin
  if _operator is null or _target is null or _operator = _target then return false; end if;
  select p.ecosystem_id, p.deleted_at into _teco, _tdel from public.profiles p where p.id = _target;
  if _teco is null or _tdel is not null then return false; end if;
  _trole := coalesce(public.top_role(_target), 'customer');
  if _trole not in ('reseller','subreseller','customer') then return false; end if;
  if public.is_super_admin(_target) then return false; end if;
  if public.is_super_admin(_operator) then return true; end if;
  return public.is_ecosystem_admin(_operator, _teco);
end $$;

-- The account the operator is currently acting as (null when nobody).
CREATE OR REPLACE FUNCTION public.acting_as()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.target_id FROM public.impersonation_sessions s
   WHERE s.operator_id = auth.uid() AND s.ended_at IS NULL AND s.expires_at > now()
   ORDER BY s.started_at DESC LIMIT 1
$$;

-- Whose data an action applies to. Falls back to the caller.
CREATE OR REPLACE FUNCTION public.effective_uid()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare _t uuid;
begin
  _t := public.acting_as();
  if _t is null then return auth.uid(); end if;
  -- Re-check scope on every use: a revoked operator loses delegation immediately.
  if not public.can_impersonate(auth.uid(), _t) then return auth.uid(); end if;
  return _t;
end $$;

-- Dual-identity audit row. No-op when the caller is acting as themselves.
CREATE OR REPLACE FUNCTION public.log_operator_action(
  _target uuid, _eco uuid, _action text, _entity text, _entity_id uuid, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _op uuid; _opname text; _oprole public.app_role; _tname text; _trole public.app_role; _sess uuid; _reason text;
begin
  _op := auth.uid();
  if _op is null or _target is null or _op = _target then return; end if;
  select full_name into _opname from public.profiles where id = _op;
  select full_name into _tname from public.profiles where id = _target;
  _oprole := coalesce(public.top_role(_op), 'customer');
  _trole := coalesce(public.top_role(_target), 'customer');
  select s.id, s.reason into _sess, _reason from public.impersonation_sessions s
   where s.operator_id = _op and s.target_id = _target and s.ended_at is null and s.expires_at > now()
   order by s.started_at desc limit 1;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op,
          coalesce(_opname,'Operator'),
          initcap(replace(_oprole::text,'_',' ')) || ' Action — Acting as ' || initcap(replace(_trole::text,'_',' ')) || ': ' || _action,
          coalesce(_tname,'Member') || ' (' || _trole::text || ')',
          coalesce(_details,'{}'::jsonb) || jsonb_build_object(
            'operator_id', _op, 'operator_name', coalesce(_opname,''), 'operator_role', _oprole::text,
            'target_id', _target, 'target_name', coalesce(_tname,''), 'target_role', _trole::text,
            'ecosystem_id', _eco, 'entity', _entity, 'entity_id', _entity_id,
            'impersonation_session_id', _sess, 'reason', coalesce(_reason,''),
            'acted_as', true, 'at', now()));
end $$;

CREATE OR REPLACE FUNCTION public.start_impersonation(_target uuid, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _op uuid; _id uuid; _eco uuid; _opname text; _tname text; _oprole public.app_role; _trole public.app_role;
begin
  _op := auth.uid();
  if _op is null then raise exception 'Sign in first'; end if;
  if not public.can_impersonate(_op, _target) then
    raise exception 'You are not allowed to access that account';
  end if;
  select ecosystem_id, full_name into _eco, _tname from public.profiles where id = _target;
  select full_name into _opname from public.profiles where id = _op;
  _oprole := coalesce(public.top_role(_op), 'customer');
  _trole := coalesce(public.top_role(_target), 'customer');

  update public.impersonation_sessions set ended_at = now()
   where operator_id = _op and ended_at is null;

  insert into public.impersonation_sessions (operator_id, operator_name, operator_role, target_id,
                                             target_name, target_role, ecosystem_id, reason)
  values (_op, coalesce(_opname,'Operator'), _oprole, _target, coalesce(_tname,'Member'), _trole, _eco,
          nullif(trim(_reason),''))
  returning id into _id;

  perform public.log_operator_action(_target, _eco, 'Entered account', 'impersonation_session', _id, '{}'::jsonb);
  return _id;
end $$;

CREATE OR REPLACE FUNCTION public.end_impersonation()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _s public.impersonation_sessions;
begin
  select * into _s from public.impersonation_sessions
   where operator_id = auth.uid() and ended_at is null
   order by started_at desc limit 1;
  if _s.id is null then return; end if;
  update public.impersonation_sessions set ended_at = now() where id = _s.id;
  perform public.log_operator_action(_s.target_id, _s.ecosystem_id, 'Exited account', 'impersonation_session', _s.id, '{}'::jsonb);
end $$;

-- Current act-as banner state for the signed-in operator.
CREATE OR REPLACE FUNCTION public.my_impersonation()
RETURNS TABLE(id uuid, target_id uuid, target_name text, target_role public.app_role,
              ecosystem_id uuid, reason text, started_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.target_id, s.target_name, s.target_role, s.ecosystem_id, s.reason, s.started_at, s.expires_at
    FROM public.impersonation_sessions s
   WHERE s.operator_id = auth.uid() AND s.ended_at IS NULL AND s.expires_at > now()
   ORDER BY s.started_at DESC LIMIT 1
$$;

-- Route the member-facing money RPCs through the delegated subject while keeping
-- the real operator on every actor_id and audit row.
DO $mig$
DECLARE
  fn text;
  def text;
  logcall text;
  anchor text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['purchase_voucher','purchase_voucher_with_points','request_redemption','transfer_credits','reseller_load_credits']
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = fn
     LIMIT 1;
    IF def IS NULL THEN CONTINUE; END IF;
    IF position('_subject uuid' in def) > 0 THEN CONTINUE; END IF;

    def := replace(def, 'auth.uid()', '_subject');
    def := replace(def, '_tx, _subject, _tx', '_tx, _op, _tx');
    def := replace(def, 'nullif(trim(_note),''''), _subject, _tx', 'nullif(trim(_note),''''), _op, _tx');
    def := replace(def, 'nullif(trim(_reference),''''), _subject, _tx', 'nullif(trim(_reference),''''), _op, _tx');
    def := replace(def, '_code, _subject, _tx', '_code, _op, _tx');
    def := replace(def, 'from public.profiles where id = _subject;
  insert into public.audit_logs', 'from public.profiles where id = _op;
  insert into public.audit_logs');
    def := replace(def, 'values (_my_eco, _subject, coalesce(', 'values (_my_eco, _op, coalesce(');
    def := replace(def, 'values (_eco, _subject, coalesce(', 'values (_eco, _op, coalesce(');
    def := regexp_replace(def, 'declare', 'declare _subject uuid; _op uuid;', '');
    def := regexp_replace(def, 'begin' || chr(10), 'begin' || chr(10) || '  _op := auth.uid(); _subject := public.effective_uid();' || chr(10), '');

    IF fn = 'purchase_voucher' THEN
      anchor := '  return query select _tx, _codes,';
      logcall := '  perform public.log_operator_action(_subject, _my_eco, ''Voucher purchase'', ''voucher_sale'', _sale, jsonb_build_object(''product'', _p.name, ''quantity'', _qty, ''unit_price'', _unit, ''total'', _total, ''tx_id'', _tx));' || chr(10);
    ELSIF fn = 'purchase_voucher_with_points' THEN
      anchor := '  return query select _tx, _code.code,';
      logcall := '  perform public.log_operator_action(_subject, _my_eco, ''Voucher purchase (points)'', ''voucher_sale'', _sale, jsonb_build_object(''product'', _p.name, ''points_spent'', _pts, ''tx_id'', _tx));' || chr(10);
    ELSIF fn = 'request_redemption' THEN
      anchor := '  return query select _red, _code,';
      logcall := '  perform public.log_operator_action(_subject, _my_eco, ''Reward redemption request'', ''reward_redemption'', _red, jsonb_build_object(''reward'', _r.name, ''points_price'', _r.points_price, ''tx_id'', _tx));' || chr(10);
    ELSIF fn = 'transfer_credits' THEN
      anchor := '  return _tx;';
      logcall := '  perform public.log_operator_action(_subject, _my_eco, ''Credit transfer'', ''credit_transfer'', _recipient_id, jsonb_build_object(''amount'', _amount, ''recipient'', coalesce(_target,''''), ''tx_id'', _tx));' || chr(10);
    ELSE
      anchor := '  return _tx;';
      logcall := '  perform public.log_operator_action(_subject, _eco, ''Credit load to member'', ''credit_load'', _customer_id, jsonb_build_object(''amount'', _amount, ''recipient'', coalesce(_target,''''), ''tx_id'', _tx));' || chr(10);
    END IF;

    IF position(anchor in def) = 0 THEN
      RAISE EXCEPTION 'anchor not found in %', fn;
    END IF;
    def := replace(def, anchor, logcall || anchor);

    EXECUTE def;
  END LOOP;
END
$mig$;
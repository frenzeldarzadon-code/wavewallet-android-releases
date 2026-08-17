-- =====================================================================
-- WaveWallet Financial Notification System
-- Observes committed financial outcomes. Never decides or overrides them.
-- =====================================================================

-- 1. Idempotency + category on the existing notification table -----------
ALTER TABLE public.member_notifications
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'social';

CREATE UNIQUE INDEX IF NOT EXISTS member_notifications_event_key_uidx
  ON public.member_notifications (event_key) WHERE event_key IS NOT NULL;

-- 2. Registered push devices -------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text,
  auth_secret text,
  device_label text,
  user_agent text,
  push_enabled boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0,
  last_error text,
  expired_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_devices_user_idx ON public.push_devices (user_id);

GRANT SELECT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own push devices" ON public.push_devices;
CREATE POLICY "Members read own push devices" ON public.push_devices
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Members update own push devices" ON public.push_devices;
CREATE POLICY "Members update own push devices" ON public.push_devices
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Members delete own push devices" ON public.push_devices;
CREATE POLICY "Members delete own push devices" ON public.push_devices
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 3. Delivery log -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.member_notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  device_id uuid REFERENCES public.push_devices(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending','sent','failed','skipped')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_deliveries_user_idx
  ON public.notification_deliveries (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_unique_idx
  ON public.notification_deliveries
     (notification_id, coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT ON public.notification_deliveries TO authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read own delivery log" ON public.notification_deliveries;
CREATE POLICY "Members read own delivery log" ON public.notification_deliveries
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 4. Money formatting helper -------------------------------------------
CREATE OR REPLACE FUNCTION public.ww_money(_amount numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT trim(to_char(coalesce(_amount, 0), 'FM999,999,990.00'))
$$;

-- 5. Central financial notification service -----------------------------
CREATE OR REPLACE FUNCTION public.notify_financial(
  _user uuid, _ecosystem uuid, _kind text, _title text,
  _body text DEFAULT NULL, _link text DEFAULT NULL, _event_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _id uuid; _muted boolean := false; _account_push boolean := false; _devices integer := 0;
begin
  if _user is null or _event_key is null or _kind is null then return null; end if;
  if exists (select 1 from public.profiles p where p.id = _user and p.deleted_at is not null) then
    return null;
  end if;

  -- In-app history is mandatory for money events, even when muted.
  insert into public.member_notifications
    (user_id, ecosystem_id, kind, category, title, body, link, event_key)
  values (_user, _ecosystem, _kind, 'financial', _title, _body, _link, _event_key)
  on conflict (event_key) do nothing
  returning id into _id;

  if _id is null then return null; end if;  -- already notified for this event

  select coalesce(bool_or(_kind = any(p.disabled_kinds)), false),
         coalesce(bool_or(p.push_enabled), false)
    into _muted, _account_push
    from public.notification_preferences p
   where p.user_id = _user;

  if _muted then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (_id, _user, 'skipped', 'category_muted');
    return _id;
  end if;

  if not _account_push then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (_id, _user, 'skipped', 'account_push_disabled');
    return _id;
  end if;

  insert into public.notification_deliveries (notification_id, user_id, device_id, status)
  select _id, _user, d.id, 'pending'
    from public.push_devices d
   where d.user_id = _user and d.push_enabled and d.expired_at is null;
  get diagnostics _devices = row_count;

  if _devices = 0 then
    insert into public.notification_deliveries (notification_id, user_id, status, reason)
    values (_id, _user, 'skipped', 'no_active_device');
  end if;

  return _id;
end $$;

REVOKE EXECUTE ON FUNCTION public.notify_financial(uuid, uuid, text, text, text, text, text)
  FROM anon, authenticated;

-- Never let alerting break a financial write.
CREATE OR REPLACE FUNCTION public.notify_financial_safe(
  _user uuid, _ecosystem uuid, _kind text, _title text,
  _body text DEFAULT NULL, _link text DEFAULT NULL, _event_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  perform public.notify_financial(_user, _ecosystem, _kind, _title, _body, _link, _event_key);
exception when others then
  null;
end $$;

REVOKE EXECUTE ON FUNCTION public.notify_financial_safe(uuid, uuid, text, text, text, text, text)
  FROM anon, authenticated;

-- 6. Wallet ledger movements -------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_notify_credit_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _kind text; _title text; _amount text := public.ww_money(new.amount);
begin
  -- Owned by dedicated request-state triggers to avoid duplicate wording.
  if new.entry_kind in ('cash_in','withdrawal_hold','withdrawal_return','withdrawal_settlement')
  then return new; end if;

  if new.entry_kind = 'purchase' then
    _kind := 'purchase';
    _title := 'Purchase completed — ' || _amount || ' Coins';
  elsif new.entry_kind in ('sale_commission','upline_commission') then
    _kind := 'cashback';
    _title := 'Cashback received — ' || _amount || ' Coins';
  elsif new.entry_kind in ('transfer','customer_upline_transfer','shop_transfer_in') then
    _kind := 'transfer';
    _title := case when new.direction = 'credit'
                   then 'Coins received — ' || _amount
                   else 'Coins sent — ' || _amount end;
  elsif new.entry_kind in ('transfer_reversal','sale_commission_reversal','refund') then
    _kind := 'refund';
    _title := case when new.direction = 'credit'
                   then 'Refund credited — ' || _amount || ' Coins'
                   else 'Reversal applied — ' || _amount || ' Coins' end;
  elsif new.entry_kind in ('credit_issue','superadmin_credit_issuance') then
    _kind := 'wallet_adjustment';
    _title := 'Coins added by the platform — ' || _amount;
  else
    _kind := 'wallet_adjustment';
    _title := case when new.direction = 'credit'
                   then 'Wallet credited — ' || _amount || ' Coins'
                   else 'Wallet debited — ' || _amount || ' Coins' end;
  end if;

  perform public.notify_financial_safe(
    new.user_id, new.ecosystem_id, _kind, _title, new.reason, null,
    'credit_ledger:' || new.id::text);
  return new;
end $$;

DROP TRIGGER IF EXISTS notify_credit_ledger ON public.credit_ledger;
CREATE TRIGGER notify_credit_ledger AFTER INSERT ON public.credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_credit_ledger();

-- 7. Points ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_notify_points_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _title text;
begin
  if new.direction = 'credit' then
    _title := 'Points earned — ' || new.amount::text;
  else
    _title := 'Points spent — ' || new.amount::text;
  end if;
  perform public.notify_financial_safe(
    new.user_id, new.ecosystem_id, 'points', _title, new.reason, null,
    'points_ledger:' || new.id::text);
  return new;
end $$;

DROP TRIGGER IF EXISTS notify_points_ledger ON public.points_ledger;
CREATE TRIGGER notify_points_ledger AFTER INSERT ON public.points_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_points_ledger();

-- 8. Cash In state -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_notify_cash_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _title text; _body text; _amount text := public.ww_money(new.amount_php);
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;

  if new.status = 'approved' then
    _title := 'Cash In approved — ' || public.ww_money(new.credits) || ' Coins credited';
    _body := 'PHP ' || _amount || ' • reference ' || coalesce(new.reference, '—');
  elsif new.status = 'rejected' or new.status = 'denied' then
    _title := 'Cash In denied — PHP ' || _amount;
    _body := coalesce(nullif(new.decision_reason, ''), 'No reason was recorded.');
  elsif new.status = 'cancelled' then
    _title := 'Cash In cancelled — PHP ' || _amount;
    _body := coalesce(nullif(new.decision_reason, ''), 'The request was cancelled.');
  elsif new.status = 'pending' then
    _title := 'Cash In pending review — PHP ' || _amount;
    _body := 'We will alert you the moment it is approved or denied.';
  else
    _title := 'Cash In updated — PHP ' || _amount;
    _body := 'Current status: ' || new.status;
  end if;

  perform public.notify_financial_safe(
    new.user_id, new.ecosystem_id, 'cash_in', _title, _body, null,
    'cash_in:' || new.id::text || ':' || new.status);
  return new;
end $$;

DROP TRIGGER IF EXISTS notify_cash_in ON public.cash_in_requests;
CREATE TRIGGER notify_cash_in AFTER INSERT OR UPDATE ON public.cash_in_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_cash_in();

-- 9. Withdrawals -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_notify_withdrawal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _title text; _body text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;

  if new.status = 'paid' or new.status = 'released' or new.status = 'completed' then
    _title := 'Cash Out released — PHP ' || public.ww_money(new.net_php);
    _body := public.ww_money(new.credits) || ' Coins • reference ' || coalesce(new.reference, '—');
  elsif new.status in ('rejected','denied','cancelled') then
    _title := 'Cash Out ' || new.status || ' — PHP ' || public.ww_money(new.net_php);
    _body := coalesce(nullif(new.decision_reason, ''), 'Your held Coins were returned.');
  elsif new.status = 'pending' then
    _title := 'Cash Out requested — PHP ' || public.ww_money(new.net_php);
    _body := public.ww_money(new.credits) || ' Coins are held until it is reviewed.';
  else
    _title := 'Cash Out updated — PHP ' || public.ww_money(new.net_php);
    _body := 'Current status: ' || new.status;
  end if;

  perform public.notify_financial_safe(
    new.user_id, new.ecosystem_id, 'withdrawal', _title, _body, null,
    'withdrawal:' || new.id::text || ':' || new.status);
  return new;
end $$;

DROP TRIGGER IF EXISTS notify_withdrawal ON public.withdrawal_requests;
CREATE TRIGGER notify_withdrawal AFTER INSERT OR UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_withdrawal();

-- 10. Reward redemption ------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_notify_reward_redemption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _title text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  _title := case new.status
              when 'claimed' then 'Reward claimed — ' || new.reward_name
              when 'cancelled' then 'Reward redemption cancelled — ' || new.reward_name
              else 'Reward redemption ' || new.status || ' — ' || new.reward_name end;
  perform public.notify_financial_safe(
    new.user_id, new.ecosystem_id, 'reward_redemption', _title,
    new.points_price::text || ' points', null,
    'reward_redemption:' || new.id::text || ':' || new.status);
  return new;
end $$;

DROP TRIGGER IF EXISTS notify_reward_redemption ON public.reward_redemptions;
CREATE TRIGGER notify_reward_redemption AFTER INSERT OR UPDATE ON public.reward_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_reward_redemption();

-- 11. Device + delivery API -------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_device(
  _endpoint text, _p256dh text DEFAULT NULL, _auth text DEFAULT NULL,
  _label text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if coalesce(trim(_endpoint), '') = '' then raise exception 'Missing device endpoint'; end if;

  -- A browser endpoint belongs to exactly one account: re-registering moves it.
  delete from public.push_devices
   where endpoint = _endpoint and user_id <> auth.uid();

  insert into public.push_devices
    (user_id, endpoint, p256dh, auth_secret, device_label, user_agent)
  values (auth.uid(), _endpoint, _p256dh, _auth,
          nullif(trim(coalesce(_label, '')), ''), _user_agent)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        device_label = coalesce(excluded.device_label, public.push_devices.device_label),
        user_agent = coalesce(excluded.user_agent, public.push_devices.user_agent),
        expired_at = null,
        last_error = null,
        failure_count = 0,
        last_seen_at = now()
  returning id into _id;
  return _id;
end $$;

CREATE OR REPLACE FUNCTION public.set_push_device_enabled(_id uuid, _enabled boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  update public.push_devices set push_enabled = coalesce(_enabled, false)
   where id = _id and user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.remove_push_device(_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  delete from public.push_devices where id = _id and user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.expire_push_device(_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  update public.push_devices
     set expired_at = now(),
         push_enabled = false,
         failure_count = failure_count + 1,
         last_error = left(coalesce(_reason, 'subscription expired'), 200)
   where id = _id and user_id = auth.uid();
$$;

-- Never returns endpoint or key material.
CREATE OR REPLACE FUNCTION public.my_push_devices()
RETURNS TABLE(id uuid, device_label text, user_agent text, push_enabled boolean,
              expired_at timestamptz, last_error text, last_seen_at timestamptz,
              created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select d.id, d.device_label, d.user_agent, d.push_enabled, d.expired_at,
         d.last_error, d.last_seen_at, d.created_at
    from public.push_devices d
   where d.user_id = auth.uid()
   order by d.created_at desc
$$;

DROP FUNCTION IF EXISTS public.my_notifications(integer);
CREATE OR REPLACE FUNCTION public.my_notifications(_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, kind text, category text, title text, body text, link text,
              read_at timestamptz, created_at timestamptz, delivery_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select n.id, n.kind, n.category, n.title, n.body, n.link, n.read_at, n.created_at,
         (select string_agg(distinct d.status, ',')
            from public.notification_deliveries d where d.notification_id = n.id)
    from public.member_notifications n
   where n.user_id = auth.uid()
   order by n.created_at desc
   limit least(coalesce(_limit, 50), 200)
$$;

REVOKE EXECUTE ON FUNCTION public.ww_money(numeric) FROM anon;

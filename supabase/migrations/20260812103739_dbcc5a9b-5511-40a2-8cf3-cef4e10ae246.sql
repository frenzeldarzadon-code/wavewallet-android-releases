-- Final credit-loading rules -------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_load_credits(_actor uuid, _target uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _t_eco uuid; _t_parent uuid; _t_status public.account_status; _a_eco uuid;
        _t_is_reseller boolean; _t_is_sub boolean;
begin
  if _actor is null or _target is null or _actor = _target then return false; end if;
  select ecosystem_id, reseller_id, status into _t_eco, _t_parent, _t_status
    from public.profiles where id = _target;
  if _t_eco is null or _t_status <> 'active' then return false; end if;

  if public.is_super_admin(_actor) then return true; end if;
  if public.is_ecosystem_admin(_actor, _t_eco) then return true; end if;

  select ecosystem_id into _a_eco from public.profiles where id = _actor;
  if _a_eco is null or _a_eco is distinct from _t_eco then return false; end if;

  _t_is_reseller := public.has_role(_target, 'reseller');
  _t_is_sub := public.has_role(_target, 'subreseller');

  -- Resellers: any customer in the same shop, plus their OWN subresellers only.
  if public.has_role(_actor, 'reseller') then
    if _t_is_reseller then return false; end if;
    if _t_is_sub then return _t_parent = _actor; end if;
    return true; -- customer in the same ecosystem
  end if;

  -- Subresellers: customers in the same shop only; never resellers/subresellers.
  if public.has_role(_actor, 'subreseller') then
    return not _t_is_reseller and not _t_is_sub;
  end if;

  return false;
end; $function$;

CREATE OR REPLACE FUNCTION public.lookup_transfer_recipient(_query text)
RETURNS TABLE(id uuid, full_name text, phone text, masked_email text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _q text := lower(trim(coalesce(_query,''))); _seller boolean;
begin
  if length(_q) < 4 then return; end if;
  select p0.ecosystem_id into _eco from public.profiles p0 where p0.id = auth.uid();
  if _eco is null then return; end if;
  _seller := public.has_role(auth.uid(),'reseller') or public.has_role(auth.uid(),'subreseller');

  return query
    select p.id, p.full_name, p.phone,
           regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2')
    from public.profiles p
    where p.ecosystem_id = _eco and p.id <> auth.uid() and p.status = 'active'
      and (lower(p.email) = _q or replace(p.phone,' ','') = replace(_q,' ',''))
      and (
        public.is_super_admin(auth.uid())
        or public.is_ecosystem_admin(auth.uid(), _eco)
        or (_seller and public.can_load_credits(auth.uid(), p.id))
        or (not _seller
            and not public.has_role(p.id,'reseller')
            and not public.has_role(p.id,'subreseller'))
      )
    limit 5;
end; $function$;

-- A subreseller must always keep exactly one parent reseller ------------------
CREATE OR REPLACE FUNCTION public.validate_member_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _parent_eco uuid; _is_sub boolean;
begin
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.id and ur.role = 'subreseller'
  ) into _is_sub;

  if new.reseller_id is null then
    if _is_sub then
      raise exception 'A subreseller must always belong to a parent reseller';
    end if;
    return new;
  end if;

  if new.reseller_id = new.id then
    raise exception 'A member cannot be their own parent reseller';
  end if;

  select ecosystem_id into _parent_eco from public.profiles where id = new.reseller_id;
  if _parent_eco is null then raise exception 'Parent reseller not found'; end if;
  if _parent_eco is distinct from new.ecosystem_id then
    raise exception 'The parent reseller must belong to the same shop';
  end if;

  if _is_sub and not exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.reseller_id and ur.role = 'reseller'
      and ur.ecosystem_id = new.ecosystem_id
  ) then
    raise exception 'A subreseller can only be owned by a reseller in the same shop';
  end if;

  if exists (select 1 from public.profiles p where p.id = new.reseller_id and p.reseller_id = new.id) then
    raise exception 'Circular reseller ownership is not allowed';
  end if;

  return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.reseller_load_credits(_customer_id uuid, _amount numeric, _reference text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text; _my_role text;
begin
  perform public.require_operational();
  if public.has_role(auth.uid(), 'reseller') then _my_role := 'reseller';
  elsif public.has_role(auth.uid(), 'subreseller') then _my_role := 'subreseller';
  else raise exception 'Only resellers can load credits';
  end if;

  select ecosystem_id, full_name || ' — ' || email into _eco, _target
    from public.profiles where id = _customer_id;
  if _eco is null then raise exception 'That member is not in your shop'; end if;
  if _customer_id = auth.uid() then raise exception 'Choose another member'; end if;

  if not public.can_load_credits(auth.uid(), _customer_id) then
    raise exception 'You can load credits to customers in your shop and to your own subresellers only';
  end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _customer_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _eco, 'debit', _amount, 0, 'Credit load to customer', nullif(trim(_reference),''), auth.uid(), _tx, _amount, 0, 0);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_to, _customer_id, _eco, 'credit', _amount, 0, 'Credit load from ' || _my_role, nullif(trim(_reference),''), auth.uid(), _tx || '-R', _amount, 0, 0);

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Reseller'), 'Loaded credits to shop member', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx, 'actor_role', _my_role,
                             'recipient_id', _customer_id,
                             'recipient_is_own_subreseller',
                               exists (select 1 from public.profiles p where p.id = _customer_id and p.reseller_id = auth.uid()),
                             'loading_commission_percent', 0));
  return _tx;
end; $function$;
ALTER TABLE public.ecosystems
  ADD COLUMN IF NOT EXISTS default_commission_percent integer NOT NULL DEFAULT 0;

ALTER TABLE public.ecosystems
  DROP CONSTRAINT IF EXISTS ecosystems_default_commission_percent_check;
ALTER TABLE public.ecosystems
  ADD CONSTRAINT ecosystems_default_commission_percent_check
  CHECK (default_commission_percent >= 0 AND default_commission_percent <= 100);

-- A reseller-level rate is now an optional override; NULL means "follow the shop default".
ALTER TABLE public.profiles ALTER COLUMN reseller_commission_percent DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN reseller_commission_percent DROP DEFAULT;
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_reseller_commission_percent_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_reseller_commission_percent_check
  CHECK (reseller_commission_percent IS NULL
         OR (reseller_commission_percent >= 0 AND reseller_commission_percent <= 100));

CREATE OR REPLACE FUNCTION public.set_ecosystem_commission(_ecosystem_id uuid, _percent integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _prev integer; _name text; _actor text;
begin
  if _percent is null or _percent < 0 or _percent > 100 then
    raise exception 'Commission must be between 0 and 100';
  end if;
  select e.default_commission_percent, e.name into _prev, _name
    from public.ecosystems e where e.id = _ecosystem_id;
  if _name is null then raise exception 'Shop not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;

  update public.ecosystems e set default_commission_percent = _percent, updated_at = now()
   where e.id = _ecosystem_id;

  select p.full_name into _actor from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'),
          'Updated default reseller commission', _name,
          jsonb_build_object('previous_percent', _prev, 'new_percent', _percent,
                             'applies_to', 'future credit releases only'));
  return _percent;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_reseller_commission(_user_id uuid, _percent integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _prev integer; _actor_name text;
begin
  perform public.require_operational();
  select p.ecosystem_id, p.reseller_commission_percent into _eco, _prev
  from public.profiles p where p.id = _user_id;
  if _eco is null then raise exception 'Reseller not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _percent is not null and (_percent < 0 or _percent > 100) then
    raise exception 'Commission must be between 0 and 100';
  end if;
  if not exists (select 1 from public.user_roles ur where ur.user_id = _user_id and ur.role = 'reseller') then
    raise exception 'Only resellers can have a commission rate';
  end if;

  update public.profiles p set reseller_commission_percent = _percent where p.id = _user_id;

  select p.full_name into _actor_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          case when _percent is null then 'Cleared reseller commission override'
               else 'Updated reseller commission' end,
          (select p.full_name from public.profiles p where p.id = _user_id),
          jsonb_build_object('previous_percent', _prev, 'new_percent', _percent,
                             'applies_to','future transfers only'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.commission_rate_for(_sender uuid, _recipient uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _override integer; _pct integer;
begin
  select p.ecosystem_id, p.reseller_commission_percent
    into _eco, _override
  from public.profiles p where p.id = _recipient;
  if _eco is null then return 0; end if;

  -- Subresellers and customers never earn commission.
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = _recipient and ur.role = 'reseller' and ur.ecosystem_id = _eco
  ) then
    return 0;
  end if;

  if _override is not null then
    _pct := _override;
  else
    select coalesce(e.default_commission_percent, 0) into _pct
      from public.ecosystems e where e.id = _eco;
  end if;
  _pct := least(greatest(coalesce(_pct, 0), 0), 100);

  -- Commission only applies when the platform owner or the shop owner releases
  -- credits. Reseller -> customer loads and peer transfers are always 0%.
  if public.is_super_admin(_sender) then return _pct; end if;
  if public.is_ecosystem_admin(_sender, _eco)
     and not public.has_role(_sender, 'reseller') then
    return _pct;
  end if;

  return 0;
end;
$function$;

REVOKE ALL ON FUNCTION public.set_ecosystem_commission(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_ecosystem_commission(uuid, integer) TO authenticated;
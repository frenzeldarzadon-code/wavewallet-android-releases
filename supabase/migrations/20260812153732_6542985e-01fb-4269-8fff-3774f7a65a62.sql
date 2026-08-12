CREATE OR REPLACE FUNCTION public.customer_deletion_check(_user_id uuid)
 RETURNS TABLE(eligible boolean, blockers text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _eco uuid;
  _deleted timestamptz;
  _joined timestamptz;
  _blockers text[] := '{}';
  _credits numeric;
  _points integer;
  _held integer;
  _roles text[];
  _pending integer;
begin
  select p.ecosystem_id, p.deleted_at, p.joined_at
    into _eco, _deleted, _joined
  from public.profiles p where p.id = _user_id;
  if _eco is null then
    raise exception 'Member not found';
  end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  select array_agg(distinct r.role::text) into _roles
    from public.user_roles r where r.user_id = _user_id;
  _roles := coalesce(_roles, '{}');

  if _deleted is not null then
    _blockers := array_append(_blockers, 'This account has already been deleted.');
  end if;
  if not ('customer' = any(_roles)) or array_length(_roles, 1) <> 1 then
    _blockers := array_append(_blockers, 'Only plain customer accounts can be deleted here.');
  end if;
  if _joined > now() - interval '3 months' then
    _blockers := array_append(_blockers, 'The account is less than 3 months old.');
  end if;

  select coalesce(sum(a.balance),0) into _credits
    from public.credit_accounts a where a.user_id = _user_id;
  if _credits <> 0 then
    _blockers := array_append(_blockers, 'Credit balance is not zero (' || _credits::text || ').');
  end if;

  select coalesce(sum(a.balance),0), coalesce(sum(a.held),0) into _points, _held
    from public.points_accounts a where a.user_id = _user_id;
  if _points <> 0 then
    _blockers := array_append(_blockers, 'Points balance is not zero (' || _points::text || ').');
  end if;
  if _held <> 0 then
    _blockers := array_append(_blockers, 'There are points on hold (' || _held::text || ').');
  end if;

  select count(*) into _pending from public.reward_redemptions rr
   where rr.user_id = _user_id and rr.status in ('pending','approved');
  if _pending > 0 then
    _blockers := array_append(_blockers,
      'There ' || case when _pending = 1 then 'is 1 reward order'
                       else 'are ' || _pending::text || ' reward orders' end || ' still waiting.');
  end if;

  return query select array_length(_blockers, 1) is null, _blockers;
end;
$function$;
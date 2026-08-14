CREATE OR REPLACE FUNCTION public.platform_user_deletion_check(_user uuid)
 RETURNS TABLE(eligible boolean, credit_total numeric, points_total integer, social_purchased integer, blockers text[], reasons text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _b text[] := '{}'; _r text[] := '{}';
        _credits numeric; _points integer; _social integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can review account deletion';
  end if;

  -- Every shop wallet, not just the active one.
  select coalesce(sum(c.balance), 0) into _credits from public.credit_accounts c where c.user_id = _user;
  select coalesce(sum(p.balance + p.held), 0)::integer into _points from public.points_accounts p where p.user_id = _user;
  -- social_credit_accounts.balance holds PURCHASED credits; free_balance is the
  -- daily allowance and is intentionally ignored.
  select coalesce(sum(s.balance), 0)::integer into _social
    from public.social_credit_accounts s where s.user_id = _user;

  if _credits <> 0 then _b := _b || ('Holds ' || _credits::text || ' credits across their shop wallets.');
  else _r := _r || 'All shop credit balances are zero.'; end if;
  if _points <> 0 then _b := _b || ('Holds ' || _points::text || ' points.');
  else _r := _r || 'No points or held points.'; end if;
  if _social <> 0 then _b := _b || ('Holds ' || _social::text || ' purchased social credits.');
  else _r := _r || 'No purchased social credits.'; end if;

  if exists (select 1 from public.cash_in_requests where user_id = _user and status = 'pending')
    then _b := _b || 'A cash-in request is still pending.';
    else _r := _r || 'No pending cash-in.'; end if;
  if exists (select 1 from public.withdrawal_requests where user_id = _user and status in ('pending','approved'))
    then _b := _b || 'A cash-out request is still open.';
    else _r := _r || 'No open cash-out.'; end if;
  if exists (select 1 from public.reward_redemptions where user_id = _user and status = 'pending')
    then _b := _b || 'A reward redemption is still pending.';
    else _r := _r || 'No pending redemptions.'; end if;
  if exists (select 1 from public.retail_orders where user_id = _user and status = 'pending')
    then _b := _b || 'A retail order is still pending.'; end if;
  if exists (select 1 from public.user_roles where user_id = _user
               and role in ('super_admin','admin','reseller','subreseller'))
    then _b := _b || 'This account holds an operator role — restructure it first.';
    else _r := _r || 'No operator role attached.'; end if;
  if _user = auth.uid() then _b := _b || 'You cannot delete your own account.'; end if;

  return query select cardinality(_b) = 0, _credits, _points, _social, _b, _r;
end $function$;

CREATE OR REPLACE FUNCTION public.superadmin_delete_platform_user(_user uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _check record; _actor text; _target text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner can delete a platform account';
  end if;
  select p.full_name || ' — ' || coalesce(p.email, p.phone, '') into _target
    from public.profiles p where p.id = _user;
  if _target is null then raise exception 'Member not found'; end if;

  select * into _check from public.platform_user_deletion_check(_user);
  if not _check.eligible then
    raise exception 'This account cannot be deleted: %', array_to_string(_check.blockers, ' ');
  end if;

  update public.profiles
     set full_name = 'Deleted member',
         email = 'deleted+' || _user::text || '@deleted.invalid',
         phone = '',
         handle = null,
         avatar_path = null,
         bio = null,
         status = 'suspended',
         deleted_at = now(),
         deleted_by = auth.uid(),
         deleted_reason = nullif(btrim(coalesce(_reason, '')), '')
   where id = _user;

  delete from public.user_roles where user_id = _user;
  delete from public.social_follows where follower_id = _user or followee_id = _user;
  delete from public.social_friendships where requester_id = _user or addressee_id = _user;
  delete from public.member_notifications where user_id = _user;
  update public.ecosystem_memberships set membership_state = 'removed', updated_at = now()
   where user_id = _user;

  select coalesce(full_name, 'Platform owner') into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (null, auth.uid(), _actor, 'Deleted platform account (anonymised)', _target,
          jsonb_build_object('user_id', _user, 'reason', _reason,
                             'history_preserved', true, 'may_register_again', true,
                             'eligible', _check.eligible,
                             'credit_total', _check.credit_total,
                             'points_total', _check.points_total,
                             'social_purchased', _check.social_purchased,
                             'eligibility_reasons', to_jsonb(_check.reasons),
                             'checked_at', now()));
end $function$;
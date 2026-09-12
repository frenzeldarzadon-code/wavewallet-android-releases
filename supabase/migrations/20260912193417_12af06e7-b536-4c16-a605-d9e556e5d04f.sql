CREATE OR REPLACE FUNCTION public.review_coin_loan(_loan_id uuid, _approve boolean, _note text DEFAULT NULL::text)
 RETURNS coin_loans
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _loan public.coin_loans; _s record;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Only the platform owner may decide loans'; end if;
  select * into _loan from public.coin_loans where id = _loan_id for update;
  if _loan.id is null then raise exception 'Loan not found'; end if;
  if _loan.status <> 'pending' then raise exception 'This loan was already %', _loan.status; end if;

  if _approve then
    select * into _s from public.platform_settings where id = 1;
    if not coalesce(_s.loans_enabled, false) then
      raise exception 'Coin loans are switched off. Turn them back on before approving.';
    end if;
    if not public.has_loan_position(_loan.user_id) then
      raise exception 'This member is no longer an admin, reseller or subreseller of any shop';
    end if;
    if exists (select 1 from public.coin_loans
                where user_id = _loan.user_id and status = 'active' and id <> _loan.id) then
      raise exception 'This member already has an active loan';
    end if;
    update public.coin_loans
       set auto_limit_snapshot = public.coin_loan_auto_limit(_loan.user_id),
           free_balance_snapshot = public.free_coin_balance(_loan.user_id)
     where id = _loan.id;
  end if;

  update public.coin_loans
     set decided_by = auth.uid(), decided_at = now(), decision_note = _note,
         status = case when _approve then status else 'rejected' end
   where id = _loan.id returning * into _loan;

  if _approve then _loan := public.release_coin_loan(_loan.id); end if;
  return _loan;
end $function$;
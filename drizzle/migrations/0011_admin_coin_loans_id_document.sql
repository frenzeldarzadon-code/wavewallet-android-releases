-- Show the attached ID (and the borrower's role) in the approval queue.
DROP FUNCTION IF EXISTS public.admin_coin_loans(text);
CREATE OR REPLACE FUNCTION public.admin_coin_loans(_status text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, user_id uuid, full_name text, handle text, principal numeric, interest_percent numeric, first_month_interest numeric, auto_limit_snapshot numeric, free_balance_snapshot numeric, outstanding numeric, released_amount numeric, status text, approval_mode text, borrower_role text, id_document_path text, id_document_uploaded_at timestamp with time zone, decided_by uuid, decided_at timestamp with time zone, decision_note text, released_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'Not allowed'; end if;
  return query
  select l.id, l.user_id, p.full_name, p.handle, l.principal, l.interest_percent,
         l.first_month_interest, l.auto_limit_snapshot, l.free_balance_snapshot,
         l.outstanding, l.released_amount, l.status, l.approval_mode,
         coalesce(l.borrower_role, public.loan_borrower_role(l.user_id)),
         l.id_document_path, l.id_document_uploaded_at, l.decided_by,
         l.decided_at, l.decision_note, l.released_at, l.created_at
    from public.coin_loans l
    left join public.profiles p on p.id = l.user_id
   where _status is null or l.status = _status
   order by case when l.status = 'pending' then 0 else 1 end, l.created_at desc
   limit 300;
end $function$;

GRANT EXECUTE ON FUNCTION public.admin_coin_loans(text) TO authenticated;
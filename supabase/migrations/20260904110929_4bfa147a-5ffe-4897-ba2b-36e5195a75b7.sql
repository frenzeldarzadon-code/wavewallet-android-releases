-- Linking a receipt to a captured notification must use the same identity
-- categories as the match explanation (reference, sender account, account
-- tail, payer name). Previously the payer-name identity signal was ignored here.
CREATE OR REPLACE FUNCTION public.listener_has_strong_signal(_ev listener_events, _row cash_in_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
      from jsonb_array_elements(public.listener_match_signal_details(_ev, _row)) s
     where s->>'category' = 'identity'
       and (s->>'agreed')::boolean
  )
$function$;
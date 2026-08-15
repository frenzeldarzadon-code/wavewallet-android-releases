
CREATE OR REPLACE FUNCTION public.reseller_list_subresellers()
RETURNS TABLE(id uuid, full_name text, handle text, avatar_path text, phone text,
              masked_email text, status public.account_status, balance numeric, joined_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _subject uuid; _eco uuid;
begin
  _subject := public.effective_uid();
  if _subject is null then return; end if;
  perform public.assert_actor_active();
  -- Only a true reseller manages a downline. Subresellers get no management view.
  if not public.has_role(_subject, 'reseller') then return; end if;
  select p.ecosystem_id into _eco from public.profiles p where p.id = _subject;
  if _eco is null then return; end if;

  return query
    select p.id, p.full_name, p.handle, p.avatar_path, p.phone,
           regexp_replace(p.email, '^(.).*(@.*)$', '\1***\2'),
           p.status,
           coalesce((select ca.balance from public.credit_accounts ca
                      where ca.user_id = p.id and ca.ecosystem_id = _eco), 0)::numeric,
           p.created_at
      from public.profiles p
     where p.reseller_id = _subject
       and p.ecosystem_id = _eco
       and p.deleted_at is null
       and public.has_role(p.id, 'subreseller')
     order by p.full_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reseller_subreseller_ledger(_user_id uuid, _limit integer DEFAULT 100)
RETURNS TABLE(id uuid, direction text, amount numeric, balance_after numeric, reason text,
              reference text, tx_id text, created_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _subject uuid; _eco uuid; _ok boolean;
begin
  _subject := public.effective_uid();
  if _subject is null or _user_id is null then return; end if;
  perform public.assert_actor_active();
  if not public.has_role(_subject, 'reseller') then
    raise exception 'Only resellers can view a subreseller history';
  end if;
  select p.ecosystem_id into _eco from public.profiles p where p.id = _subject;
  if _eco is null then return; end if;

  select exists (
    select 1 from public.profiles p
     where p.id = _user_id and p.reseller_id = _subject
       and p.ecosystem_id = _eco and p.deleted_at is null
       and public.has_role(p.id, 'subreseller')
  ) into _ok;
  if not _ok then raise exception 'That member is not one of your subresellers'; end if;

  return query
    select l.id, l.direction::text, l.amount, l.balance_after, l.reason,
           l.reference, l.tx_id, l.created_at
      from public.credit_ledger l
     where l.user_id = _user_id and l.ecosystem_id = _eco
     order by l.created_at desc
     limit greatest(1, least(coalesce(_limit, 100), 500));
end;
$function$;

REVOKE ALL ON FUNCTION public.reseller_list_subresellers() FROM public, anon;
REVOKE ALL ON FUNCTION public.reseller_subreseller_ledger(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reseller_list_subresellers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reseller_subreseller_ledger(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_redemption(_reward_id uuid)
 RETURNS TABLE(id uuid, code text, reward_name text, points_price integer, status text, tx_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _my_eco uuid; _r public.reward_products; _acct uuid; _tx text;
        _code text; _red uuid; _status public.account_status; _me text;
begin
  perform public.require_operational();
  select p.ecosystem_id, p.status, p.full_name into _my_eco, _status, _me
    from public.profiles p where p.id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;

  select rp.* into _r from public.reward_products rp where rp.id = _reward_id for update;
  if _r.id is null or _r.ecosystem_id <> _my_eco then raise exception 'Reward not available'; end if;
  if not _r.active or _r.archived then raise exception 'This reward is not available right now'; end if;
  if (_r.stock - _r.reserved) < 1 then raise exception 'This reward is out of stock'; end if;

  select pa.id into _acct from public.points_accounts pa where pa.user_id = auth.uid();
  if _acct is null then raise exception 'Points wallet not found'; end if;

  update public.reward_products rp set reserved = rp.reserved + 1 where rp.id = _r.id;

  _tx := public.new_tx_id();
  _code := 'RDM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));

  insert into public.reward_redemptions (ecosystem_id, reward_id, reward_name, points_price,
                                         user_id, user_name, code, status, tx_id, reward_image_path)
  values (_my_eco, _r.id, _r.name, _r.points_price, auth.uid(), coalesce(_me,''), _code, 'pending', _tx, _r.image_path)
  returning reward_redemptions.id into _red;

  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type, redemption_id)
  values (_acct, auth.uid(), _my_eco, 'debit', _r.points_price, 0,
          'Points held — ' || _r.name, _code, auth.uid(), _tx, 'hold', _red);

  return query select _red, _code, _r.name, _r.points_price, 'pending'::text, _tx;
end; $function$;

REVOKE ALL ON FUNCTION public.request_redemption(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_redemption(uuid) TO authenticated;
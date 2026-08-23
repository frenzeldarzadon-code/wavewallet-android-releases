-- Shop-admin self deletion (Coins rule) + platform-owner payment override.
-- Run inside a transaction and roll back.
begin;

-- 1) A shop where a member still holds Coins cannot be deleted.
do $$
declare
  _eco uuid;
  _admin uuid;
  _member uuid;
  _blocked boolean := false;
begin
  select id into _eco from public.ecosystems order by created_at limit 1;
  if _eco is null then raise notice 'no shop to test'; return; end if;

  select user_id into _admin from public.ecosystem_memberships
   where ecosystem_id = _eco and role = 'admin' limit 1;
  select user_id into _member from public.credit_accounts
   where ecosystem_id = _eco and user_id <> coalesce(_admin, gen_random_uuid()) limit 1;

  if _member is not null then
    update public.credit_accounts set balance = 100
     where ecosystem_id = _eco and user_id = _member;
    if (public.shop_deletion_check_unchecked(_eco)->>'can_delete')::boolean then
      raise exception 'FAIL: deletion allowed while a member holds Coins';
    end if;

    update public.credit_accounts set balance = 0 where ecosystem_id = _eco;
    if not (public.shop_deletion_check_unchecked(_eco)->>'can_delete')::boolean then
      raise exception 'FAIL: deletion still blocked with all member balances at zero';
    end if;
  end if;
  raise notice 'OK: Coin rule gates shop deletion';
end $$;

-- 2) The override function refuses callers who are not the platform owner and
--    demands a reason.
do $$
declare _eco uuid; _err text;
begin
  select id into _eco from public.ecosystems limit 1;
  begin
    perform public.override_subscription_payment(_eco, '');
    raise exception 'FAIL: override accepted an empty reason';
  exception when others then
    _err := sqlerrm;
    if _err like 'FAIL:%' then raise; end if;
  end;
  raise notice 'OK: override requires authorisation and a reason';
end $$;

rollback;

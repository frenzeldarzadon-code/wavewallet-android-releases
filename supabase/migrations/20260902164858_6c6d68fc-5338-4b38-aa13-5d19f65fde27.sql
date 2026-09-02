-- ============================================================
-- 1. Shop kind: add 'universe'
-- ============================================================
alter table public.ecosystems drop constraint if exists ecosystems_shop_kind_check;
alter table public.ecosystems add constraint ecosystems_shop_kind_check
  check (shop_kind = any (array['legacy'::text, 'subscription'::text, 'universe'::text]));

create or replace function public.is_universe_shop(_ecosystem_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select e.shop_kind = 'universe' from public.ecosystems e where e.id = _ecosystem_id), false)
$$;

-- Legacy-only exceptions (platform payment option, go-live wording) keep applying to converted shops.
create or replace function public.is_legacy_shop(_ecosystem_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select e.shop_kind in ('legacy','universe') from public.ecosystems e where e.id = _ecosystem_id), false)
$$;

-- ============================================================
-- 2. Universe-aware wallet resolution
-- ============================================================
create or replace function public.wallet_id_for(_user_id uuid, _ecosystem_id uuid)
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
begin
  if _ecosystem_id is not null and public.is_universe_shop(_ecosystem_id) then
    return (select id from public.credit_accounts where user_id = _user_id and ecosystem_id is null);
  end if;
  return (select id from public.credit_accounts
           where user_id = _user_id and (ecosystem_id = _ecosystem_id or ecosystem_id is null)
           order by (ecosystem_id is null) limit 1);
end $$;

create or replace function public.ensure_credit_account(_user_id uuid, _ecosystem_id uuid default null::uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
DECLARE _acct uuid; _eco uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  SELECT COALESCE(_ecosystem_id, public.active_ecosystem(_user_id)) INTO _eco;

  -- Universe shops share the member's single global wallet.
  IF _eco IS NOT NULL AND public.is_universe_shop(_eco) THEN
    _acct := public.ensure_global_wallet(_user_id);
    PERFORM 1 FROM public.credit_accounts WHERE id = _acct FOR UPDATE;
    RETURN _acct;
  END IF;

  SELECT id INTO _acct FROM public.credit_accounts
  WHERE user_id = _user_id AND ecosystem_id IS NOT DISTINCT FROM _eco FOR UPDATE;
  IF _acct IS NOT NULL THEN RETURN _acct; END IF;

  INSERT INTO public.credit_accounts (user_id, ecosystem_id, balance)
  VALUES (_user_id, _eco, 0)
  ON CONFLICT (user_id, COALESCE(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

  SELECT id INTO _acct FROM public.credit_accounts
  WHERE user_id = _user_id AND ecosystem_id IS NOT DISTINCT FROM _eco FOR UPDATE;
  RETURN _acct;
END $$;

-- ============================================================
-- 3. Ledger guard: wallet/shop-kind isolation
-- ============================================================
create or replace function public.guard_shop_kind_ledger()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _kind text; _review boolean; _acct_eco uuid;
begin
  select ecosystem_id into _acct_eco from public.credit_accounts where id = new.account_id;
  if new.ecosystem_id is null then
    -- Rows without a shop context must sit on the global wallet.
    if _acct_eco is not null then
      raise exception 'A wallet entry without a shop cannot be booked on a shop wallet';
    end if;
    return new;
  end if;
  select shop_kind, is_review into _kind, _review
    from public.ecosystems where id = new.ecosystem_id;
  if coalesce(_review, false) then
    raise exception 'This is a review shop — its coins are simulated and never touch real balances';
  end if;
  if _kind = 'subscription' then
    if new.entry_kind in ('shop_transfer_in','shop_transfer_out') then
      raise exception 'Coins cannot move between shops in a Subscription Shop';
    end if;
    if _acct_eco is null then
      raise exception 'New Generation coins never use the Universe wallet';
    end if;
  elsif _kind = 'universe' then
    if _acct_eco is not null and new.entry_kind <> 'universe_consolidation_out' then
      raise exception 'Universe shop coins live in the member''s Universe wallet';
    end if;
  end if;
  if _acct_eco is not null and _acct_eco <> new.ecosystem_id then
    raise exception 'Wallet entry shop does not match the wallet''s shop';
  end if;
  return new;
end $$;

-- ============================================================
-- 4. Coin lots keyed by the wallet that holds the coins
-- ============================================================
create or replace function public.track_credit_lots()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  _kind text; _src uuid; _left numeric(14,2); _take numeric(14,2); _lot record; _cons record;
  _srole public.app_role; _nil uuid := '00000000-0000-0000-0000-000000000000'; _sender_ledger uuid;
  _pool uuid;
begin
  -- The lot pool is the wallet's shop (NULL = global Universe wallet), never the
  -- ledger row's reporting shop: a Universe sale is reported under the selling
  -- shop but consumes coins from the buyer's global wallet.
  select ecosystem_id into _pool from public.credit_accounts where id = new.account_id;

  if new.direction='credit' then
    if new.entry_kind='general' and new.actor_id is not null and new.actor_id<>new.user_id then
      select id into _sender_ledger from public.credit_ledger where tx_id=regexp_replace(new.tx_id,'-R$','') and direction='debit' limit 1;
      if _sender_ledger is not null then
        for _cons in
          select cl.source_user_id,cl.source_kind,clc.amount
            from public.credit_lot_consumptions clc join public.credit_lots cl on cl.id=clc.lot_id
           where clc.ledger_id=_sender_ledger order by cl.seq
        loop
          _kind:=coalesce(_cons.source_kind,'system'); _src:=_cons.source_user_id;
          insert into public.credit_lots(ecosystem_id,user_id,ledger_id,source_user_id,source_kind,amount,remaining)
          values(_pool,new.user_id,new.id,_src,_kind,_cons.amount,_cons.amount)
          on conflict(ledger_id) do nothing;
        end loop;
        if exists(select 1 from public.credit_lots where ledger_id=new.id) then return null; end if;
      end if;
    end if;

    _src:=new.actor_id;
    if new.entry_kind='customer_upline_transfer' or new.entry_kind='shop_transfer_in' or new.entry_kind='transfer_reversal' or new.entry_kind='universe_consolidation_in' then
      _kind:=case when new.entry_kind='shop_transfer_in' then 'transfer' else 'system' end; _src:=null;
    elsif new.entry_kind='sale_commission' or new.entry_kind='upline_commission' or _src is null then
      _kind:='system'; _src:=null;
    elsif _src=new.user_id then
      _kind:='self';
    elsif public.is_super_admin(_src) or public.is_ecosystem_admin(_src,new.ecosystem_id) then
      _kind:='admin';
    else
      _srole:=public.membership_role(_src,new.ecosystem_id);
      if _srole is null then select ur.role into _srole from public.user_roles ur where ur.user_id=_src and ur.ecosystem_id=new.ecosystem_id order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1; end if;
      if _srole='reseller' then _kind:='reseller'; elsif _srole='subreseller' then _kind:='subreseller'; else _kind:='system'; _src:=null; end if;
    end if;
    insert into public.credit_lots(ecosystem_id,user_id,ledger_id,source_user_id,source_kind,amount,remaining)
    values(_pool,new.user_id,new.id,_src,_kind,new.amount,new.amount) on conflict(ledger_id) do nothing;
    return null;
  end if;

  if new.entry_kind='transfer_reversal' and new.reverses_ledger_id is not null then
    select id,remaining into _lot from public.credit_lots where ledger_id=new.reverses_ledger_id for update;
    if _lot.id is null then raise exception 'Original transfer credits can no longer be traced'; end if;
    if _lot.remaining<new.amount then raise exception 'Cannot reverse automatically because some credits have already been spent or transferred.'; end if;
    update public.credit_lots set remaining=remaining-new.amount where id=_lot.id;
    insert into public.credit_lot_consumptions(ecosystem_id,ledger_id,lot_id,user_id,amount) values(new.ecosystem_id,new.id,_lot.id,new.user_id,new.amount) on conflict(ledger_id,lot_id) do nothing;
    return null;
  end if;

  _left:=new.amount;
  for _lot in select id,remaining from public.credit_lots where user_id=new.user_id and coalesce(ecosystem_id,_nil)=coalesce(_pool,_nil) and remaining>0 order by seq for update loop
    exit when _left<=0;
    _take:=least(_left,_lot.remaining);
    update public.credit_lots set remaining=remaining-_take where id=_lot.id;
    insert into public.credit_lot_consumptions(ecosystem_id,ledger_id,lot_id,user_id,amount) values(new.ecosystem_id,new.id,_lot.id,new.user_id,_take) on conflict(ledger_id,lot_id) do nothing;
    _left:=_left-_take;
  end loop;
  return null;
end;
$$;

-- ============================================================
-- 5. Notifications: consolidation wording
-- ============================================================
create or replace function public.tg_notify_credit_ledger()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _kind text; _title text; _amount text := public.ww_money(new.amount); _shop text;
begin
  if new.entry_kind in ('cash_in','withdrawal_hold','withdrawal_return','withdrawal_settlement','universe_consolidation_out')
  then return new; end if;

  if new.entry_kind = 'universe_consolidation_in' then
    _kind := 'wallet_adjustment';
    _title := 'Universe wallet — ' || _amount || ' Coins moved from your shop wallet';
  elsif new.entry_kind = 'purchase' then
    _kind := 'purchase';
    _title := 'Purchase completed — ' || _amount || ' Coins';
  elsif new.entry_kind in ('sale_commission','upline_commission') then
    _kind := 'cashback';
    _title := 'Cashback received — ' || _amount || ' Coins';
  elsif new.entry_kind in ('transfer','customer_upline_transfer','shop_transfer_in') then
    _kind := 'transfer';
    _title := case when new.direction = 'credit'
                   then 'Coins received — ' || _amount
                   else 'Coins sent — ' || _amount end;
  elsif new.entry_kind in ('transfer_reversal','sale_commission_reversal','refund') then
    _kind := 'refund';
    _title := case when new.direction = 'credit'
                   then 'Refund credited — ' || _amount || ' Coins'
                   else 'Reversal applied — ' || _amount || ' Coins' end;
  elsif new.entry_kind in ('credit_issue','superadmin_credit_issuance') then
    _kind := 'wallet_adjustment';
    _title := 'Coins added by the platform — ' || _amount;
  else
    _kind := 'wallet_adjustment';
    _title := case when new.direction = 'credit'
                   then 'Wallet credited — ' || _amount || ' Coins'
                   else 'Wallet debited — ' || _amount || ' Coins' end;
  end if;

  perform public.notify_financial_safe(
    new.user_id, new.ecosystem_id, _kind, _title, new.reason, null,
    'credit_ledger:' || new.id::text);
  return new;
end $$;

-- ============================================================
-- 6. New tables / columns
-- ============================================================
create table public.shop_seller_authorizations (
  id uuid primary key default gen_random_uuid(),
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ecosystem_id, user_id)
);
grant select on public.shop_seller_authorizations to authenticated;
grant all on public.shop_seller_authorizations to service_role;
alter table public.shop_seller_authorizations enable row level security;
create policy "Read active seller authorizations"
  on public.shop_seller_authorizations for select to authenticated
  using (active or user_id = auth.uid() or public.is_ecosystem_admin(auth.uid(), ecosystem_id) or public.is_super_admin(auth.uid()));
create trigger shop_seller_authorizations_updated_at before update on public.shop_seller_authorizations
  for each row execute function public.set_updated_at();
create index shop_seller_authorizations_user_idx on public.shop_seller_authorizations (user_id) where active;

create table public.universe_wallet_consolidations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ecosystem_id uuid not null references public.ecosystems(id) on delete cascade,
  shop_account_id uuid not null references public.credit_accounts(id),
  global_account_id uuid not null references public.credit_accounts(id),
  amount numeric(14,2) not null,
  tx_id text not null,
  shop_ledger_id uuid references public.credit_ledger(id),
  global_ledger_id uuid references public.credit_ledger(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (user_id, ecosystem_id)
);
grant select on public.universe_wallet_consolidations to authenticated;
grant all on public.universe_wallet_consolidations to service_role;
alter table public.universe_wallet_consolidations enable row level security;
create policy "Read own or platform consolidations"
  on public.universe_wallet_consolidations for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin(auth.uid()));

alter table public.voucher_sales add column if not exists seller_id uuid references public.profiles(id) on delete set null;
create index if not exists voucher_sales_seller_idx on public.voucher_sales (seller_id) where seller_id is not null;

-- ============================================================
-- 7. Seller authorizations follow admin/reseller/subreseller memberships
-- ============================================================
create or replace function public.sync_seller_authorization(_user_id uuid, _ecosystem_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _should boolean;
begin
  if _user_id is null or _ecosystem_id is null then return; end if;
  if not public.is_universe_shop(_ecosystem_id) then return; end if;
  if public.is_super_admin(_user_id) then return; end if;
  _should := exists (
    select 1 from public.ecosystem_memberships m
     where m.user_id = _user_id and m.ecosystem_id = _ecosystem_id
       and m.membership_state = 'active' and m.status = 'active'
       and m.role in ('admin','reseller','subreseller'))
    or exists (
    select 1 from public.user_roles ur
     where ur.user_id = _user_id and ur.ecosystem_id = _ecosystem_id and ur.role in ('admin','reseller','subreseller')
       and not exists (select 1 from public.ecosystem_memberships m
                        where m.user_id = _user_id and m.ecosystem_id = _ecosystem_id));
  if _should then
    insert into public.shop_seller_authorizations (ecosystem_id, user_id, active, created_by)
    values (_ecosystem_id, _user_id, true, auth.uid())
    on conflict (ecosystem_id, user_id) do update set active = true, updated_at = now();
  else
    update public.shop_seller_authorizations set active = false
     where ecosystem_id = _ecosystem_id and user_id = _user_id and active;
  end if;
end $$;

create or replace function public.tg_sync_seller_authorization()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_seller_authorization(old.user_id, old.ecosystem_id);
    return old;
  end if;
  perform public.sync_seller_authorization(new.user_id, new.ecosystem_id);
  return new;
end $$;
create trigger ecosystem_memberships_seller_sync
  after insert or update or delete on public.ecosystem_memberships
  for each row execute function public.tg_sync_seller_authorization();

create or replace function public.seed_seller_authorizations(_ecosystem_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare _r record; _n integer := 0;
begin
  if auth.uid() is not null and not public.is_super_admin(auth.uid()) then
    raise exception 'Only the platform owner may seed seller authorizations';
  end if;
  for _r in
    select distinct user_id from (
      select m.user_id from public.ecosystem_memberships m where m.ecosystem_id = _ecosystem_id
      union select ur.user_id from public.user_roles ur where ur.ecosystem_id = _ecosystem_id
    ) u
  loop
    perform public.sync_seller_authorization(_r.user_id, _ecosystem_id);
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke execute on function public.seed_seller_authorizations(uuid) from public, anon;

-- ============================================================
-- 8. purchase_voucher with optional authorized seller
-- ============================================================
drop function if exists public.purchase_voucher(uuid, integer);

create function public.purchase_voucher(_product_id uuid, _quantity integer default 1, _seller_id uuid default null::uuid)
returns table(tx_id text, codes text[], sale_price numeric, unit_price numeric, quantity integer, product_name text, sale_id uuid, points_earned numeric, commission_amount numeric, commission_percent integer)
language plpgsql security definer set search_path to 'public' as $$
declare _subject uuid; _op uuid; _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _unit numeric; _total numeric;
        _tx text; _sale uuid; _status public.account_status; _parent uuid; _mparent uuid;
        _ratio numeric; _ver integer; _earn numeric(14,2) := 0;
        _qty integer; _ids uuid[]; _codes text[]; _debit uuid;
        _c record; _s record; _amt numeric(14,2); _uprate integer := 0;
        _bonus_total numeric(14,2) := 0; _top_recipient uuid; _top_rate integer := 0;
        _upline_total numeric(14,2) := 0; _upline_recipient uuid;
        _racct uuid; _ledger uuid; _rec record; _seq integer := 0;
        _admrate integer := 0; _admin_id uuid; _applied numeric(14,2) := 0;
        _universe boolean := false; _seller uuid; _seller_role public.app_role; _seller_parent uuid;
        _sale_reseller uuid; _sale_parent uuid;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  if _subject is null then raise exception 'Not signed in'; end if;
  _qty := coalesce(_quantity, 1);
  if _qty < 1 or _qty > 500 then raise exception 'Choose between 1 and 500 vouchers'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null then raise exception 'Product not available'; end if;
  _universe := public.is_universe_shop(_p.ecosystem_id);

  select ecosystem_id, status, reseller_id into _my_eco, _status, _parent
    from public.profiles where id = _subject and deleted_at is null;
  if _status is null then raise exception 'Member not found'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;

  if _universe then
    -- Universe shop: any active member of the Universe may buy; no shop membership needed.
    _my_eco := _p.ecosystem_id;
    if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
    if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
      raise exception 'This shop is temporarily frozen by the platform owner';
    end if;
    if _seller_id is not null and _seller_id <> _subject then
      if not exists (select 1 from public.shop_seller_authorizations a
                      where a.ecosystem_id = _my_eco and a.user_id = _seller_id and a.active) then
        raise exception 'That seller is not authorized to sell for this shop';
      end if;
      _seller := _seller_id;
    end if;
    _acct := public.ensure_global_wallet(_subject);
  else
    if _seller_id is not null then
      raise exception 'Seller storefronts are only available in Universe shops';
    end if;
    perform public.require_operational();
    if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
    if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
    if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
      raise exception 'This shop is temporarily frozen by the platform owner';
    end if;
    if _p.ecosystem_id <> _my_eco then
      if exists (select 1 from public.ecosystem_memberships m
                  where m.user_id = _subject and m.ecosystem_id = _p.ecosystem_id
                    and m.membership_state = 'active') then
        _my_eco := _p.ecosystem_id;
        if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;
        if (select coalesce(operations_frozen,false) from public.ecosystems where id = _my_eco) then
          raise exception 'This shop is temporarily frozen by the platform owner';
        end if;
      else
        raise exception 'Product not available';
      end if;
    end if;
  end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

  select m.role, m.reseller_id into _role, _mparent
    from public.ecosystem_memberships m
   where m.user_id = _subject and m.ecosystem_id = _my_eco and m.membership_state = 'active';
  if _role is null then
    select role into _role from public.user_roles where user_id = _subject and ecosystem_id = _my_eco
     order by case role when 'reseller' then 0 when 'subreseller' then 1 when 'admin' then 2 else 3 end limit 1;
  end if;
  _role := coalesce(_role, 'customer');
  _parent := coalesce(_mparent, _parent);

  if _role in ('reseller','subreseller','admin') then
    _discount := public.voucher_discount_percent_for(_subject, _my_eco);
  end if;
  _discount := coalesce(_discount, 0);

  _list := coalesce(_p.promo_price, _p.credit_price);
  _unit := round(_list * (100 - _discount) / 100.0, 2);
  _total := round(_unit * _qty, 2);

  select array_agg(id order by created_at), array_agg(code order by created_at)
    into _ids, _codes
  from (
    select vc.id, vc.code, vc.created_at
    from public.voucher_codes vc
    where vc.product_id = _product_id and vc.status = 'unused'
    order by vc.created_at
    for update skip locked
    limit _qty
  ) s;

  if _ids is null or array_length(_ids, 1) < _qty then
    raise exception 'Only % voucher code(s) are available for this product', coalesce(array_length(_ids,1), 0);
  end if;

  if not _universe then
    _acct := public.wallet_id_for(_subject, _my_eco);
  end if;
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := round(_total / _ratio, 2); end if;

  if _earn > 0 then
    if _universe and not public.is_super_admin(_subject) then
      -- Rewards stay shop-scoped: the buyer earns in the SELLING shop's points account.
      insert into public.points_accounts (user_id, ecosystem_id) values (_subject, _my_eco)
      on conflict (user_id, coalesce(ecosystem_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;
    end if;
    select id into _pacct from public.points_accounts where user_id = _subject and ecosystem_id = _my_eco;
    if _pacct is null then _earn := 0; end if;
  end if;

  -- Seller attribution (Universe only): the storefront seller is the sale's reseller.
  if _universe and _seller is not null then
    select m.role, m.reseller_id into _seller_role, _seller_parent
      from public.ecosystem_memberships m
     where m.user_id = _seller and m.ecosystem_id = _my_eco and m.membership_state = 'active';
    if _seller_role is null then
      select ur.role into _seller_role from public.user_roles ur
       where ur.user_id = _seller and ur.ecosystem_id = _my_eco
       order by case ur.role when 'reseller' then 0 when 'subreseller' then 1 when 'admin' then 2 else 3 end limit 1;
      select p.reseller_id into _seller_parent from public.profiles p where p.id = _seller;
    end if;
  end if;

  if _universe then
    if _role in ('reseller','subreseller') then
      _sale_reseller := _subject; _sale_parent := _parent;
    elsif _seller is not null and _seller_role in ('reseller','subreseller') then
      _sale_reseller := _seller; _sale_parent := _seller_parent;
    else
      _sale_reseller := null; _sale_parent := null;
    end if;
  else
    _sale_reseller := case when _role in ('reseller','subreseller') then _subject else _parent end;
    _sale_parent := _parent;
  end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, parent_reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version,
                                    quantity, unit_price, commission_percent, commission_amount, seller_id)
  values (_my_eco, _p.id, _p.name, _subject, _role,
          _sale_reseller, _sale_parent,
          _list, _discount, round((_list - _unit) * _qty, 2), _total,
          'credits', _tx, _p.points_price, 0, _earn, _ratio, _ver,
          _qty, _unit, 0, 0, _seller)
  returning id into _sale;

  if _total > 0 then
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _subject, _my_eco, 'debit', _total, 0,
            'Voucher purchase — ' || _p.name || case when _qty > 1 then ' ×' || _qty else '' end,
            _tx, _op, _tx, _sale, 'purchase')
    returning id into _debit;
  end if;

  update public.voucher_codes vc
     set status = 'sold', sold_to = _subject, sale_id = _sale, sold_at = now()
   where vc.id = any(_ids) and vc.status = 'unused';
  if not found then raise exception 'Those voucher codes were just sold. Please try again.'; end if;

  if _debit is not null and _total > 0 then
    if _role = 'customer' and _universe then
      -- Universe cashback follows the SELLING shop's rules for the storefront
      -- seller — never the provenance of the buyer's coins.
      if _seller is not null and _seller_role in ('reseller','subreseller') then
        for _s in select * from public.cashback_chain(_seller, _my_eco) loop
          _amt := round(_total * _s.pct / 100.0, 2);
          continue when _amt <= 0;
          insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                               source_ledger_id, credits_consumed, commission_percent,
                                               commission_amount, kind)
          values (_my_eco, _sale, _s.recipient_id, null, _debit, _total, _s.pct, _amt, _s.kind);
        end loop;
      end if;
    elsif _role = 'customer' then
      for _c in
        select cc.amount, l.id as lot_id, l.ledger_id, l.source_user_id, l.source_kind
          from public.credit_lot_consumptions cc
          join public.credit_lots l on l.id = cc.lot_id
         where cc.ledger_id = _debit
           and l.source_user_id is not null
           and l.source_kind in ('reseller','subreseller')
      loop
        if _c.source_user_id = _subject then continue; end if;
        for _s in select * from public.cashback_chain(_c.source_user_id, _my_eco) loop
          _amt := round(_c.amount * _s.pct / 100.0, 2);
          continue when _amt <= 0;
          update public.sale_commissions sc
             set credits_consumed = sc.credits_consumed + _c.amount,
                 commission_amount = sc.commission_amount + _amt,
                 commission_percent = _s.pct
           where sc.sale_id = _sale and sc.recipient_id = _s.recipient_id
             and sc.kind = _s.kind and sc.ledger_id is null;
          if not found then
            insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                                 source_ledger_id, credits_consumed, commission_percent,
                                                 commission_amount, kind)
            values (_my_eco, _sale, _s.recipient_id,
                    case when _s.kind = 'sale_cashback' then _c.lot_id else null end,
                    _debit, _c.amount, _s.pct, _amt, _s.kind);
          end if;
        end loop;
      end loop;
    elsif _role = 'subreseller' then
      if _parent is not null then
        _uprate := greatest(
          coalesce(public.member_cashback_rate(_parent, _my_eco), 0)
          - coalesce(public.member_cashback_rate(_subject, _my_eco), 0), 0);
        _amt := least(round(coalesce(_list,0) * _qty * _uprate / 100.0, 2), _total);
        if _amt > 0 then
          insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                               source_ledger_id, credits_consumed, commission_percent,
                                               commission_amount, kind)
          values (_my_eco, _sale, _parent, null, _debit, _total, _uprate, _amt, 'upline');
        end if;
        _uprate := 0;
      end if;
    end if;
  end if;

  if _debit is not null and _total > 0 then
    select ur.user_id into _admin_id
      from public.user_roles ur
      join public.profiles pr on pr.id = ur.user_id
     where ur.ecosystem_id = _my_eco and ur.role = 'admin'
       and pr.deleted_at is null and pr.status = 'active'
     order by pr.joined_at
     limit 1;
    if _admin_id is null then
      select m.user_id into _admin_id
        from public.ecosystem_memberships m
        join public.profiles pr on pr.id = m.user_id
       where m.ecosystem_id = _my_eco and m.role = 'admin' and m.membership_state = 'active'
         and pr.deleted_at is null and pr.status = 'active'
       order by pr.joined_at
       limit 1;
    end if;
    if _admin_id is not null and _admin_id <> _subject then
      select coalesce(sum(sc.commission_amount), 0) into _applied
        from public.sale_commissions sc where sc.sale_id = _sale;
      _amt := round(_total - _applied, 2);
      if _amt > 0 then
        _admrate := round(_amt * 100.0 / NULLIF(_list * _qty, 0))::int;
        insert into public.sale_commissions (ecosystem_id, sale_id, recipient_id, source_lot_id,
                                             source_ledger_id, credits_consumed, commission_percent,
                                             commission_amount, kind)
        values (_my_eco, _sale, _admin_id, null, _debit, _total, _admrate, _amt, 'admin')
        on conflict do nothing;
      end if;
    end if;
  end if;

  for _rec in
    select sc.recipient_id, sc.kind,
           sum(sc.commission_amount) as amount,
           sum(sc.credits_consumed) as basis,
           max(sc.commission_percent) as pct
      from public.sale_commissions sc
     where sc.sale_id = _sale and sc.ledger_id is null
     group by sc.recipient_id, sc.kind
  loop
    if _universe then
      _racct := case when public.is_super_admin(_rec.recipient_id) then null
                     else public.ensure_global_wallet(_rec.recipient_id) end;
    else
      _racct := public.wallet_id_for(_rec.recipient_id, _my_eco);
    end if;
    continue when _racct is null;
    _seq := _seq + 1;

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind,
                                      base_amount, commission_percent, commission_amount)
    values (_racct, _rec.recipient_id, _my_eco, 'credit', _rec.amount, 0,
            case _rec.kind
                 when 'upline'
                   then 'Upline cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% remaining share of your reseller total)'
                 when 'admin'
                   then 'Shop cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% remainder of a member purchase)'
                 else case when _universe
                           then 'Sales cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of a sale through your storefront)'
                           else 'Sales cashback — ' || _p.name || ' ×' || _qty || ' (' || _rec.pct || '% of credits you supplied)' end
            end,
            _tx, _op, _tx || '-C' || _seq,
            _sale, case when _rec.kind = 'upline' then 'upline_commission' else 'sale_commission' end,
            _rec.basis, _rec.pct, _rec.amount)
    returning id into _ledger;

    update public.sale_commissions sc set ledger_id = _ledger
     where sc.sale_id = _sale and sc.recipient_id = _rec.recipient_id
       and sc.kind = _rec.kind and sc.ledger_id is null;

    if _rec.kind = 'upline' then
      _upline_total := _upline_total + _rec.amount;
      _upline_recipient := _rec.recipient_id;
      _uprate := _rec.pct;
    elsif _rec.kind = 'sale_cashback' then
      _bonus_total := _bonus_total + _rec.amount;
      if _rec.pct > _top_rate then _top_rate := _rec.pct; _top_recipient := _rec.recipient_id; end if;
    end if;
  end loop;

  if _bonus_total > 0 or _upline_total > 0 then
    update public.voucher_sales vs
       set commission_amount = _bonus_total,
           commission_percent = _top_rate,
           commission_recipient_id = _top_recipient,
           upline_commission_amount = _upline_total,
           upline_commission_percent = case when _upline_total > 0 then _uprate else 0 end,
           upline_recipient_id = _upline_recipient
     where vs.id = _sale;
  end if;

  if _earn > 0 and _pacct is not null then
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                      balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id,
                                      credits_basis, credits_per_point_used, points_rule_version)
    values (_pacct, _subject, _my_eco, 'credit', _earn, 0,
            'Points earned — ' || _p.name || ' (' || _ratio::text || ' credits = 1 pt)',
            _tx, _op, _tx || '-P', 'earn', _sale, _total, _ratio, _ver);
  end if;

  perform public.log_operator_action(_subject, _my_eco, 'Voucher purchase', 'voucher_sale', _sale,
    jsonb_build_object('product', _p.name, 'quantity', _qty, 'unit_price', _unit, 'total', _total, 'tx_id', _tx,
                       'universe', _universe, 'seller_id', _seller));
  return query select _tx, _codes, _total, _unit, _qty, _p.name, _sale, _earn,
                      _bonus_total + _upline_total, greatest(_top_rate, case when _upline_total > 0 then _uprate else 0 end);
end; $$;
revoke execute on function public.purchase_voucher(uuid, integer, uuid) from public, anon;
grant execute on function public.purchase_voucher(uuid, integer, uuid) to authenticated, service_role;

-- ============================================================
-- 9. Universe-aware wallet resolution in existing money functions
-- ============================================================
create or replace function public.refund_voucher_sale(_sale_id uuid, _reason text)
returns table(tx_id text, credits_refunded numeric, points_refunded numeric, points_reversed numeric, commission_reversed numeric, codes_voided integer)
language plpgsql security definer set search_path to 'public' as $$
declare
  _s public.voucher_sales; _ref text; _acct uuid; _pacct uuid; _actor text; _rec record;
  _credits numeric(14,2) := 0; _points_back numeric := 0; _points_rev numeric := 0;
  _comm numeric(14,2) := 0; _codes integer := 0; _orig public.points_ledger;
begin
  perform public.require_operational();

  select * into _s from public.voucher_sales where id = _sale_id for update;
  if _s.id is null then raise exception 'Sale not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _s.ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;
  if _s.refunded_at is not null then raise exception 'This sale was already refunded'; end if;
  if coalesce(trim(_reason), '') = '' then raise exception 'A reason is required'; end if;

  _ref := public.new_tx_id();

  if _s.points_spent > 0 then
    select id into _pacct from public.points_accounts where user_id = _s.buyer_id and ecosystem_id = _s.ecosystem_id;
    if _pacct is null then raise exception 'Buyer points wallet not found'; end if;
    insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_type, sale_id)
    values (_pacct, _s.buyer_id, _s.ecosystem_id, 'credit', _s.points_spent, 0,
            'Voucher sale refunded — ' || trim(_reason), _ref, auth.uid(),
            public.new_tx_id(), 'adjust', _sale_id);
    _points_back := _s.points_spent;
  end if;

  if _s.sale_price > 0 then
    _acct := public.wallet_id_for(_s.buyer_id, _s.ecosystem_id);
    if _acct is null then raise exception 'Buyer credit wallet not found'; end if;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _s.buyer_id, _s.ecosystem_id, 'credit', _s.sale_price, 0,
            'Voucher sale refunded — ' || trim(_reason), _ref, auth.uid(),
            public.new_tx_id(), _sale_id, 'refund');
    _credits := _s.sale_price;
  end if;

  for _rec in
    select recipient_id, sum(commission_amount) as amount
      from public.sale_commissions
     where sale_id = _sale_id and reversed_at is null
     group by recipient_id
  loop
    _acct := public.wallet_id_for(_rec.recipient_id, _s.ecosystem_id);
    continue when _acct is null;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _rec.recipient_id, _s.ecosystem_id, 'debit', _rec.amount, 0,
            'Credit-back reversed — sale refunded', _ref, auth.uid(),
            public.new_tx_id(), _sale_id, 'sale_commission_reversal');
    _comm := _comm + _rec.amount;
  end loop;
  update public.sale_commissions set reversed_at = now()
   where sale_id = _sale_id and reversed_at is null;

  select * into _orig from public.points_ledger
   where sale_id = _sale_id and entry_type = 'earn' limit 1;
  if _orig.id is not null and not exists (
      select 1 from public.points_ledger
       where sale_id = _sale_id and entry_type = 'adjust' and direction = 'debit') then
    select id into _pacct from public.points_accounts where user_id = _orig.user_id and ecosystem_id = _orig.ecosystem_id;
    if _pacct is not null then
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                        reason, reference, actor_id, tx_id, entry_type, sale_id,
                                        credits_basis, credits_per_point_used, points_rule_version)
      values (_pacct, _orig.user_id, _orig.ecosystem_id, 'debit', _orig.amount, 0,
              'Points reversed — sale refunded', _ref, auth.uid(),
              public.new_tx_id(), 'adjust', _sale_id,
              _orig.credits_basis, _orig.credits_per_point_used, _orig.points_rule_version);
      _points_rev := _orig.amount;
    end if;
  end if;

  update public.voucher_codes set status = 'void'
   where sale_id = _sale_id and status = 'sold';
  get diagnostics _codes = row_count;

  update public.voucher_sales
     set refunded_at = now(), refund_reason = trim(_reason), refund_tx = _ref
   where id = _sale_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_s.ecosystem_id, auth.uid(), coalesce(_actor, 'Admin'), 'Refunded voucher sale',
          _s.product_name || ' — ' || _s.tx_id,
          jsonb_build_object('sale_id', _sale_id, 'refund_ref', _ref, 'reason', trim(_reason),
                             'credits_refunded', _credits, 'points_refunded', _points_back,
                             'points_reversed', _points_rev, 'commission_reversed', _comm,
                             'codes_voided', _codes));

  return query select _ref, _credits, _points_back, _points_rev, _comm, _codes;
end;
$$;

create or replace function public.reverse_sale_commission(_sale_id uuid, _reason text default null::text)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _rec record; _acct uuid; _tx text; _sum numeric(14,2) := 0; _actor text;
begin
  perform public.require_operational();
  select ecosystem_id into _eco from public.voucher_sales where id = _sale_id;
  if _eco is null then raise exception 'Sale not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;

  _tx := public.new_tx_id();
  for _rec in
    select recipient_id, sum(commission_amount) as amount
      from public.sale_commissions
     where sale_id = _sale_id and reversed_at is null
     group by recipient_id
  loop
    _acct := public.wallet_id_for(_rec.recipient_id, _eco);
    continue when _acct is null;
    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, sale_id, entry_kind)
    values (_acct, _rec.recipient_id, _eco, 'debit', _rec.amount, 0,
            'Credit-back reversed' || coalesce(' — ' || nullif(trim(_reason),''), ''),
            _tx, auth.uid(), _tx, _sale_id, 'sale_commission_reversal');
    _sum := _sum + _rec.amount;
  end loop;

  update public.sale_commissions set reversed_at = now()
   where sale_id = _sale_id and reversed_at is null;
  update public.voucher_sales set commission_amount = 0, commission_percent = 0
   where id = _sale_id;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor,'Admin'), 'Reversed sale credit-back', _sale_id::text,
          jsonb_build_object('amount', _sum, 'reason', _reason, 'tx_id', _tx));

  return _sum;
end;
$$;

create or replace function public.admin_load_credits(_user_id uuid, _amount numeric, _reason text default null::text, _reference text default null::text, _ecosystem_id uuid default null::uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text;
begin
  perform public.require_operational();
  perform public.assert_actor_active();

  select p.full_name || ' — ' || p.email into _target
    from public.profiles p where p.id = _user_id and p.deleted_at is null;
  if _target is null then raise exception 'Member not found'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  _eco := public.resolve_member_shop(_user_id, _ecosystem_id);

  if public.is_super_admin(auth.uid()) then
    return public.superadmin_issue_credits(
      _user_id, _amount,
      coalesce(nullif(trim(_reason),''), 'Super Admin Credit Issuance'),
      'Manual credit', nullif(trim(_reference),''), null, _eco);
  end if;

  if not public.is_ecosystem_admin(auth.uid(), _eco) then
    raise exception 'Only the shop admin can load credits to shop members';
  end if;
  if _user_id = auth.uid() then raise exception 'Choose another member'; end if;

  _from := public.ensure_credit_account(auth.uid(), _eco);
  _to := public.ensure_credit_account(_user_id, _eco);
  if _from is null or _to is null then raise exception 'Wallet not found in this shop'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _eco, 'debit', _amount, 0,
          coalesce(nullif(trim(_reason),''), 'Credit load to shop member'),
          nullif(trim(_reference),''), auth.uid(), _tx, _amount, 0, 0);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_to, _user_id, _eco, 'credit', _amount, 0,
          coalesce(nullif(trim(_reason),''), 'Credit load from shop admin'),
          nullif(trim(_reference),''), auth.uid(), _tx || '-R', _amount, 0, 0);

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Admin'), 'Loaded credits to shop member', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx, 'recipient_id', _user_id,
                             'ecosystem_id', _eco,
                             'reason', nullif(trim(_reason),''), 'reference', nullif(trim(_reference),'')));
  return _tx;
end $$;

create or replace function public.reseller_load_credits(_customer_id uuid, _amount numeric, _reference text default null::text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _subject uuid; _op uuid; _eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text; _my_role text;
begin
  _op := auth.uid(); _subject := public.effective_uid();
  perform public.require_operational();
  perform public.assert_actor_active();
  if public.has_role(_subject, 'reseller') then _my_role := 'reseller';
  elsif public.has_role(_subject, 'subreseller') then _my_role := 'subreseller';
  else raise exception 'Only resellers can load credits';
  end if;

  select ecosystem_id, full_name || ' — ' || email into _eco, _target
    from public.profiles where id = _customer_id;
  if _eco is null then raise exception 'That member is not in your shop'; end if;
  if _customer_id = _subject then raise exception 'Choose another member'; end if;

  if not public.can_load_credits(_subject, _customer_id) then
    raise exception 'You can load credits to customers in your shop and to your own subresellers only';
  end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  _from := public.ensure_credit_account(_subject, _eco);
  _to := public.ensure_credit_account(_customer_id, _eco);
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_from, _subject, _eco, 'debit', _amount, 0, 'Credit load to customer', nullif(trim(_reference),''), _op, _tx, _amount, 0, 0);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_to, _customer_id, _eco, 'credit', _amount, 0, 'Credit load from ' || _my_role, nullif(trim(_reference),''), _op, _tx || '-R', _amount, 0, 0);

  select full_name into _me from public.profiles where id = _op;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, _op, coalesce(_me,'Reseller'), 'Loaded credits to shop member', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx, 'actor_role', _my_role,
                             'recipient_id', _customer_id,
                             'recipient_is_own_subreseller',
                               exists (select 1 from public.profiles p where p.id = _customer_id and p.reseller_id = _subject),
                             'loading_commission_percent', 0));
  perform public.log_operator_action(_subject, _eco, 'Credit load to member', 'credit_load', _customer_id, jsonb_build_object('amount', _amount, 'recipient', coalesce(_target,''), 'tx_id', _tx));
  return _tx;
end;
$$;

create or replace function public.transfer_credits_in_shop(_ecosystem_id uuid, _recipient_id uuid, _amount numeric, _note text default null::text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  _op uuid := auth.uid(); _subject uuid := public.effective_uid(); _tx text;
  _frozen boolean; _reason text; _eco_name text; _recipient_status public.account_status; _deleted timestamptz;
  _from uuid; _to uuid; _bal numeric(14,2); _target text; _actor_name text;
begin
  if _subject is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  if _ecosystem_id is null or _recipient_id is null then raise exception 'Choose a shop and a recipient'; end if;
  if _recipient_id = _subject then raise exception 'You cannot send credits to yourself'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;
  select e.name, coalesce(e.operations_frozen,false), e.frozen_reason into _eco_name,_frozen,_reason from public.ecosystems e where e.id=_ecosystem_id and e.archived_at is null;
  if _eco_name is null then raise exception 'That shop is not available right now'; end if;
  if _frozen then raise exception 'This shop is temporarily frozen by the platform owner%',coalesce(' — '||nullif(trim(_reason),''),''); end if;
  if not public.subscription_ok(_ecosystem_id) then raise exception 'This shop is not active — the operator must renew the subscription before making changes'; end if;
  if not exists (select 1 from public.ecosystem_memberships m where m.user_id=_subject and m.ecosystem_id=_ecosystem_id and m.membership_state='active' and m.status='active') then raise exception 'You are not an approved member of that shop'; end if;
  if not exists (select 1 from public.ecosystem_memberships m where m.user_id=_recipient_id and m.ecosystem_id=_ecosystem_id and m.membership_state='active' and m.status='active') then raise exception 'That member does not belong to this shop'; end if;
  select p.status,p.deleted_at,p.full_name||' — '||p.email into _recipient_status,_deleted,_target from public.profiles p where p.id=_recipient_id;
  if _target is null or _deleted is not null then raise exception 'Recipient not found'; end if;
  if _recipient_status <> 'active' then raise exception 'That account is suspended'; end if;
  if public.is_super_admin(_recipient_id) then raise exception 'The platform owner does not hold a shop wallet'; end if;
  perform public.ensure_membership_wallets(_subject,_ecosystem_id);
  perform public.ensure_membership_wallets(_recipient_id,_ecosystem_id);
  _from := public.ensure_credit_account(_subject,_ecosystem_id);
  _to := public.ensure_credit_account(_recipient_id,_ecosystem_id);
  select ca.balance into _bal from public.credit_accounts ca where ca.id=_from;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;
  if coalesce(_bal,0) < _amount then raise exception 'Not enough credits in %',_eco_name; end if;
  _tx:=public.new_tx_id();
  insert into public.credit_ledger(account_id,user_id,ecosystem_id,direction,amount,balance_after,reason,reference,actor_id,tx_id,entry_kind,base_amount,commission_percent,commission_amount)
  values(_from,_subject,_ecosystem_id,'debit',_amount,0,'Credit transfer sent',nullif(trim(_note),''),_subject,_tx,'general',_amount,0,0);
  insert into public.credit_ledger(account_id,user_id,ecosystem_id,direction,amount,balance_after,reason,reference,actor_id,tx_id,entry_kind,base_amount,commission_percent,commission_amount)
  values(_to,_recipient_id,_ecosystem_id,'credit',_amount,0,'Credit transfer received',nullif(trim(_note),''),_subject,_tx||'-R','general',_amount,0,0);
  select full_name into _actor_name from public.profiles where id=_op;
  insert into public.audit_logs(ecosystem_id,actor_id,actor_name,action,target,metadata)
  values(_ecosystem_id,_op,coalesce(_actor_name,'Member'),'Transferred credits',coalesce(_target,''),jsonb_build_object('amount',_amount,'commission_percent',0,'commission_amount',0,'total_received',_amount,'tx_id',_tx,'shop_scoped',true,'sender_id',_subject,'lineage_preserved',true));
  perform public.log_operator_action(_subject,_ecosystem_id,'Credit transfer','credit_transfer',_recipient_id,jsonb_build_object('amount',_amount,'recipient',coalesce(_target,''),'tx_id',_tx,'lineage_preserved',true));
  return _tx;
end;
$$;

create or replace function public.admin_cash_in_capacity(_ecosystem uuid)
returns table(admin_id uuid, admin_name text, balance numeric, reserved numeric, available numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare _admin uuid; _bal numeric(14,2); _res numeric(14,2);
begin
  _admin := public.shop_funding_admin(_ecosystem);
  if _admin is null then
    return query select null::uuid, null::text, 0::numeric, 0::numeric, 0::numeric;
    return;
  end if;
  select coalesce(ca.balance, 0) into _bal from public.credit_accounts ca
   where ca.id = public.wallet_id_for(_admin, _ecosystem);
  select coalesce(sum(c.credits), 0) into _res from public.cash_in_requests c
   where c.funding_source = 'admin' and c.funding_admin_id = _admin
     and c.ecosystem_id is not distinct from _ecosystem and c.status = 'pending';
  return query select _admin,
                      (select p.full_name from public.profiles p where p.id = _admin),
                      coalesce(_bal,0),
                      coalesce(_res,0),
                      greatest(coalesce(_bal,0) - coalesce(_res,0), 0);
end $$;

create or replace function public.my_shop_wallets()
returns table(ecosystem_id uuid, ecosystem_name text, balance numeric)
language sql stable security definer set search_path to 'public' as $$
  select e.id, e.name,
         coalesce((select ca.balance from public.credit_accounts ca
                    where ca.id = public.wallet_id_for(m.user_id, e.id)), 0)
    from public.ecosystem_memberships m
    join public.ecosystems e on e.id = m.ecosystem_id
   where m.user_id = public.effective_uid()
     and m.membership_state = 'active'
     and m.status = 'active'
     and e.archived_at is null
   order by e.name;
$$;

-- Shop-to-shop transfers never involve a Universe shop: its coins already live in
-- the one global wallet, so there is nothing to move and nothing to charge.
create or replace function public.transfer_credits_between_shops(_from_ecosystem_id uuid, _to_ecosystem_id uuid, _amount numeric, _note text default null::text)
returns table(tx_id text, fee_credits numeric, net_credits numeric)
language plpgsql security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid(); _fee numeric(14,2); _net numeric(14,2);
  _from uuid; _to uuid; _global uuid; _bal numeric(14,2); _tx text;
  _from_name text; _to_name text; _actor text;
begin
  if _uid is null then raise exception 'Not signed in'; end if;
  if public.acting_as() is not null then
    raise exception 'Cannot move credits between shops while acting as another member';
  end if;
  perform public.assert_actor_active();

  if _from_ecosystem_id is null or _to_ecosystem_id is null then
    raise exception 'Choose both a source and a destination shop';
  end if;
  if _from_ecosystem_id = _to_ecosystem_id then
    raise exception 'Choose two different shops';
  end if;
  if public.is_universe_shop(_from_ecosystem_id) or public.is_universe_shop(_to_ecosystem_id) then
    raise exception 'Universe shops share your single Universe wallet — no transfer is needed';
  end if;

  select coalesce(shop_transfer_fee_credits, 5) into _fee from public.platform_settings where id = 1;
  _fee := coalesce(_fee, 5);

  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;
  if _amount <= _fee then
    raise exception 'Transfer at least % credits so the % credit fee leaves something to receive', _fee + 1, _fee;
  end if;
  _net := round(_amount - _fee, 2);

  if not exists (select 1 from public.ecosystem_memberships
                  where user_id = _uid and ecosystem_id = _from_ecosystem_id
                    and membership_state = 'active' and status = 'active') then
    raise exception 'You are not an approved member of the source shop';
  end if;
  if not exists (select 1 from public.ecosystem_memberships
                  where user_id = _uid and ecosystem_id = _to_ecosystem_id
                    and membership_state = 'active' and status = 'active') then
    raise exception 'You are not an approved member of the destination shop';
  end if;

  select name into _from_name from public.ecosystems
   where id = _from_ecosystem_id and archived_at is null and not coalesce(operations_frozen, false);
  if _from_name is null then raise exception 'The source shop is not available right now'; end if;
  select name into _to_name from public.ecosystems
   where id = _to_ecosystem_id and archived_at is null and not coalesce(operations_frozen, false);
  if _to_name is null then raise exception 'The destination shop is not available right now'; end if;

  perform public.ensure_membership_wallets(_uid, _from_ecosystem_id);
  perform public.ensure_membership_wallets(_uid, _to_ecosystem_id);
  _global := public.ensure_global_wallet(_uid);

  select id, balance into _from, _bal from public.credit_accounts
   where user_id = _uid and ecosystem_id = _from_ecosystem_id for update;
  select id into _to from public.credit_accounts
   where user_id = _uid and ecosystem_id = _to_ecosystem_id for update;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;
  if coalesce(_bal, 0) < _amount then
    raise exception 'Not enough credits in %', _from_name;
  end if;

  _tx := public.new_tx_id();

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_from, _uid, _from_ecosystem_id, 'debit', _amount, 0,
          'Shop transfer sent — to ' || _to_name, nullif(btrim(coalesce(_note,'')),''), _uid, _tx, 'shop_transfer_out');
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_global, _uid, null, 'credit', _amount, 0,
          'Shop transfer in transit — from ' || _from_name, nullif(btrim(coalesce(_note,'')),''), _uid, _tx || '-G', 'shop_transfer_in');
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_global, _uid, null, 'debit', _amount, 0,
          'Shop transfer released — to ' || _to_name, nullif(btrim(coalesce(_note,'')),''), _uid, _tx || '-GO', 'shop_transfer_out');
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                    reason, reference, actor_id, tx_id, entry_kind)
  values (_to, _uid, _to_ecosystem_id, 'credit', _net, 0,
          'Shop transfer received — from ' || _from_name ||
            case when _fee > 0 then ' (fee ' || _fee::text || ' credits)' else '' end,
          nullif(btrim(coalesce(_note,'')),''), _uid, _tx || '-R', 'shop_transfer_in');

  if _fee > 0 then
    insert into public.shop_transfer_fees (tx_id, user_id, from_ecosystem_id, to_ecosystem_id,
                                           gross_credits, fee_credits, net_credits)
    values (_tx, _uid, _from_ecosystem_id, _to_ecosystem_id, _amount, _fee, _net);
  end if;

  select coalesce(full_name, email) into _actor from public.profiles where id = _uid;
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_from_ecosystem_id, _uid, coalesce(_actor, 'Member'), 'Transferred credits between shops', _to_name,
          jsonb_build_object('amount', _amount, 'fee', _fee, 'net', _net,
                             'from_ecosystem_id', _from_ecosystem_id,
                             'to_ecosystem_id', _to_ecosystem_id, 'tx_id', _tx));
  perform public.log_operator_action(_uid, _from_ecosystem_id, 'Shop-to-shop credit transfer',
          'credit_transfer', _uid,
          jsonb_build_object('amount', _amount, 'fee', _fee, 'net', _net, 'to', _to_name, 'tx_id', _tx));

  return query select _tx, _fee, _net;
end $$;

-- ============================================================
-- 10. Wallet consolidation (Super Admin), idempotent per member/shop
-- ============================================================
create or replace function public.consolidate_universe_wallets(_ecosystem_id uuid, _dry_run boolean default true)
returns table(user_id uuid, ecosystem_id uuid, amount numeric, outcome text, detail text)
language plpgsql security definer set search_path to 'public' as $$
declare _r record; _kind text; _name text; _frozen boolean; _global uuid; _tx text;
        _out uuid; _in uuid; _block text; _actor uuid := auth.uid();
begin
  if _actor is not null and not public.is_super_admin(_actor) then
    raise exception 'Only the platform owner may consolidate wallets';
  end if;
  select e.shop_kind, e.name, coalesce(e.operations_frozen,false) into _kind, _name, _frozen
    from public.ecosystems e where e.id = _ecosystem_id;
  if _kind is null then raise exception 'Shop not found'; end if;
  if _kind <> 'universe' then
    raise exception 'Only Universe shops can be consolidated (this shop is %)', _kind;
  end if;

  for _r in
    select a.id as account_id, a.user_id as uid, a.balance
      from public.credit_accounts a
     where a.ecosystem_id = _ecosystem_id
     order by a.created_at
     for update
  loop
    user_id := _r.uid; ecosystem_id := _ecosystem_id; amount := _r.balance; detail := null;

    if exists (select 1 from public.universe_wallet_consolidations c
                where c.user_id = _r.uid and c.ecosystem_id = _ecosystem_id) then
      outcome := 'already_consolidated'; return next; continue;
    end if;
    if _r.balance <= 0 then
      outcome := 'zero'; return next; continue;
    end if;
    if public.is_super_admin(_r.uid) then
      outcome := 'blocked'; detail := 'platform owner holds no member wallet'; return next; continue;
    end if;

    _block := null;
    if _frozen then _block := 'shop is frozen'; end if;
    if _block is null and exists (select 1 from public.withdrawal_requests w
          where w.user_id = _r.uid and w.ecosystem_id = _ecosystem_id and w.status in ('pending','approved')) then
      _block := 'pending withdrawal';
    end if;
    if _block is null and exists (select 1 from public.cash_in_requests c
          where (c.user_id = _r.uid or c.funding_admin_id = _r.uid) and c.ecosystem_id = _ecosystem_id and c.status = 'pending') then
      _block := 'pending cash in';
    end if;
    if _block is null and exists (select 1 from public.credit_purchase_orders o
          where o.user_id = _r.uid and o.ecosystem_id = _ecosystem_id and o.status = 'pending') then
      _block := 'pending credit order';
    end if;
    if _block is null and exists (select 1 from public.retail_orders o
          where o.customer_id = _r.uid and o.ecosystem_id = _ecosystem_id and o.status = 'pending') then
      _block := 'pending retail order';
    end if;
    if _block is not null then
      outcome := 'blocked'; detail := _block; return next; continue;
    end if;

    if _dry_run then
      outcome := 'would_move'; return next; continue;
    end if;

    _global := public.ensure_global_wallet(_r.uid);
    perform 1 from public.credit_accounts where id = _global for update;
    _tx := public.new_tx_id();

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_r.account_id, _r.uid, _ecosystem_id, 'debit', _r.balance, 0,
            'Moved to your Universe wallet — ' || _name, _tx, null, _tx, 'universe_consolidation_out')
    returning id into _out;

    insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after,
                                      reason, reference, actor_id, tx_id, entry_kind)
    values (_global, _r.uid, null, 'credit', _r.balance, 0,
            'Universe wallet consolidation — from ' || _name, _tx, null, _tx || '-R', 'universe_consolidation_in')
    returning id into _in;

    insert into public.universe_wallet_consolidations
      (user_id, ecosystem_id, shop_account_id, global_account_id, amount, tx_id, shop_ledger_id, global_ledger_id, created_by)
    values (_r.uid, _ecosystem_id, _r.account_id, _global, _r.balance, _tx, _out, _in, _actor);

    insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
    values (_ecosystem_id, _actor, 'Platform', 'Consolidated shop wallet into Universe wallet', _r.uid::text,
            jsonb_build_object('amount', _r.balance, 'tx_id', _tx, 'shop_account_id', _r.account_id,
                               'global_account_id', _global));

    outcome := 'moved'; detail := _tx; return next;
  end loop;
  return;
end $$;
revoke execute on function public.consolidate_universe_wallets(uuid, boolean) from public, anon;
grant execute on function public.consolidate_universe_wallets(uuid, boolean) to authenticated, service_role;

-- ============================================================
-- 11. Read helpers for the app
-- ============================================================
-- Which wallet backs (member, shop) and its balance. Self, shop admin or platform owner only.
create or replace function public.wallet_view(_user_id uuid, _ecosystem_id uuid default null::uuid)
returns table(account_id uuid, balance numeric, is_global boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare _me uuid := public.effective_uid();
begin
  if _me is null then raise exception 'Not signed in'; end if;
  if not (_me = _user_id or auth.uid() = _user_id or public.is_super_admin(auth.uid())
          or (_ecosystem_id is not null and public.is_ecosystem_admin(auth.uid(), _ecosystem_id))
          or exists (select 1 from public.profiles p where p.id = _user_id and p.reseller_id = auth.uid())) then
    raise exception 'Not allowed to read that wallet';
  end if;
  return query
    select ca.id, ca.balance, ca.ecosystem_id is null
      from public.credit_accounts ca
     where ca.id = case when _ecosystem_id is null
                        then (select id from public.credit_accounts where credit_accounts.user_id = _user_id and credit_accounts.ecosystem_id is null)
                        else public.wallet_id_for(_user_id, _ecosystem_id) end;
end $$;
revoke execute on function public.wallet_view(uuid, uuid) from public, anon;
grant execute on function public.wallet_view(uuid, uuid) to authenticated, service_role;

-- Public seller storefront: identity + the voucher products the seller is
-- authorized to sell. No roles, rates, uplines or wallets.
create or replace function public.seller_storefront(_handle text)
returns table(seller_id uuid, seller_name text, seller_handle text, avatar_path text,
              shop_id uuid, shop_name text, shop_slug text,
              product_id uuid, product_name text, description text, price numeric, available integer)
language sql stable security definer set search_path to 'public' as $$
  with seller as (
    select p.id, p.full_name, p.handle, p.avatar_path
      from public.profiles p
     where lower(p.handle) = lower(ltrim(_handle, '@')) and p.deleted_at is null and p.status = 'active'
  )
  select s.id, s.full_name, s.handle, s.avatar_path,
         e.id, e.name, e.slug,
         v.id, v.name, v.description, coalesce(v.promo_price, v.credit_price),
         (select count(*)::int from public.voucher_codes c where c.product_id = v.id and c.status = 'unused')
    from seller s
    join public.shop_seller_authorizations a on a.user_id = s.id and a.active
    join public.ecosystems e on e.id = a.ecosystem_id
         and e.shop_kind = 'universe' and e.archived_at is null
         and e.public_storefront_enabled and e.store_voucher_enabled
         and (not e.is_test or public.can_see_test_shop(e.id))
    join public.voucher_products v on v.ecosystem_id = e.id and v.active and not v.archived
   order by e.name, v.name;
$$;
grant execute on function public.seller_storefront(text) to anon, authenticated, service_role;

-- Sellers of a Universe shop (identity only) for the public shop page.
create or replace function public.universe_sellers_for_shop(_slug text)
returns table(seller_id uuid, seller_name text, seller_handle text, avatar_path text)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.full_name, p.handle, p.avatar_path
    from public.ecosystems e
    join public.shop_seller_authorizations a on a.ecosystem_id = e.id and a.active
    join public.profiles p on p.id = a.user_id and p.deleted_at is null and p.status = 'active' and p.handle is not null
   where e.slug = _slug and e.shop_kind = 'universe' and e.archived_at is null and e.public_storefront_enabled
     and (not e.is_test or public.can_see_test_shop(e.id))
   order by p.full_name;
$$;
grant execute on function public.universe_sellers_for_shop(text) to anon, authenticated, service_role;

-- Review shop simulation ------------------------------------------------
create or replace function public.demo_guard(_ecosystem_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _rev boolean; _ends timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in to use the review shop'; end if;
  select e.is_review, e.review_ends_at into _rev, _ends
    from public.ecosystems e where e.id = _ecosystem_id;
  if not coalesce(_rev,false) then raise exception 'This is not a review shop'; end if;
  if not exists (select 1 from public.ecosystem_memberships m
                  where m.ecosystem_id = _ecosystem_id and m.user_id = auth.uid()
                    and m.role = 'admin' and m.membership_state = 'active') then
    raise exception 'Only the owner of this review shop can simulate transactions';
  end if;
  if _ends is not null and _ends <= now() then
    raise exception 'Your 5-day review has ended — subscribe to continue';
  end if;
end $$;

revoke all on function public.demo_guard(uuid) from public, anon;
grant execute on function public.demo_guard(uuid) to authenticated, service_role;

create or replace function public.demo_shop_state(_ecosystem_id uuid)
returns jsonb language plpgsql security definer stable set search_path to 'public' as $$
declare _out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view the review shop'; end if;
  if not exists (select 1 from public.ecosystem_memberships m
                  where m.ecosystem_id = _ecosystem_id and m.user_id = auth.uid()
                    and m.membership_state = 'active') then
    raise exception 'You are not a member of this shop';
  end if;
  select jsonb_build_object(
    'ecosystem_id', e.id,
    'name', e.name,
    'is_review', e.is_review,
    'review_ends_at', e.review_ends_at,
    'ended', (e.review_ends_at is not null and e.review_ends_at <= now()),
    'wallets', coalesce((select jsonb_agg(to_jsonb(w) order by
                          case w.role when 'admin' then 1 when 'reseller' then 2
                                      when 'subreseller' then 3 else 4 end)
                         from public.demo_wallets w where w.ecosystem_id = e.id), '[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(to_jsonb(v) order by v.display_order)
                          from public.demo_vouchers v where v.ecosystem_id = e.id), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc)
                        from (select * from public.demo_ledger d where d.ecosystem_id = e.id
                              order by d.created_at desc limit 60) l), '[]'::jsonb)
  ) into _out
  from public.ecosystems e where e.id = _ecosystem_id;
  return coalesce(_out, '{}'::jsonb);
end $$;

revoke all on function public.demo_shop_state(uuid) from public, anon;
grant execute on function public.demo_shop_state(uuid) to authenticated, service_role;

-- Move simulated coins down the chain (admin -> reseller -> subreseller -> customer)
create or replace function public.demo_transfer(
  _ecosystem_id uuid, _from text, _to text, _amount numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _fb numeric; _tb numeric; _fname text; _tname text; _tx text;
begin
  perform public.demo_guard(_ecosystem_id);
  if _amount is null or _amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  if _from = _to then raise exception 'Choose two different wallets'; end if;

  select balance, display_name into _fb, _fname from public.demo_wallets
   where ecosystem_id = _ecosystem_id and member_key = _from for update;
  select balance, display_name into _tb, _tname from public.demo_wallets
   where ecosystem_id = _ecosystem_id and member_key = _to for update;
  if _fb is null or _tb is null then raise exception 'Unknown demo wallet'; end if;
  if _fb < _amount then raise exception 'Not enough Demo Coins in that wallet'; end if;

  _tx := 'DEMO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  update public.demo_wallets set balance = balance - _amount
   where ecosystem_id = _ecosystem_id and member_key = _from returning balance into _fb;
  update public.demo_wallets set balance = balance + _amount
   where ecosystem_id = _ecosystem_id and member_key = _to returning balance into _tb;

  insert into public.demo_ledger (ecosystem_id, member_key, direction, amount, balance_after, entry_kind, reason, tx_id)
  values
    (_ecosystem_id, _from, 'debit', _amount, _fb, 'demo_transfer', 'Loaded Demo Coins to ' || _tname, _tx),
    (_ecosystem_id, _to, 'credit', _amount, _tb, 'demo_transfer', 'Received Demo Coins from ' || _fname, _tx);

  return jsonb_build_object('tx_id', _tx);
end $$;

revoke all on function public.demo_transfer(uuid, text, text, numeric) from public, anon;
grant execute on function public.demo_transfer(uuid, text, text, numeric) to authenticated, service_role;

-- Simulated WiFi voucher sale with the same cashback shape as a live shop
create or replace function public.demo_sell_voucher(
  _ecosystem_id uuid, _voucher_id uuid, _quantity integer default 1,
  _reseller_rate numeric default 10, _subreseller_rate numeric default 4)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _v public.demo_vouchers; _total numeric; _cb_r numeric; _cb_s numeric; _admin numeric;
        _bal numeric; _tx text; _pts numeric;
begin
  perform public.demo_guard(_ecosystem_id);
  if coalesce(_quantity,0) < 1 or _quantity > 50 then raise exception 'Choose between 1 and 50 vouchers'; end if;
  if _reseller_rate < 0 or _reseller_rate > 50 or _subreseller_rate < 0 or _subreseller_rate > _reseller_rate then
    raise exception 'Cashback rates must be between 0 and 50, and the subreseller share comes out of the reseller share';
  end if;

  select * into _v from public.demo_vouchers
   where id = _voucher_id and ecosystem_id = _ecosystem_id for update;
  if _v.id is null then raise exception 'Unknown demo voucher'; end if;
  if _v.stock < _quantity then raise exception 'Not enough demo stock left'; end if;

  _total := round(_v.price * _quantity, 2);
  select balance into _bal from public.demo_wallets
   where ecosystem_id = _ecosystem_id and member_key = 'customer' for update;
  if coalesce(_bal,0) < _total then
    raise exception 'The demo customer needs more Demo Coins — load the chain first';
  end if;

  _cb_r := round(_total * _reseller_rate / 100, 2);
  _cb_s := round(_total * _subreseller_rate / 100, 2);
  _cb_r := round(_cb_r - _cb_s, 2);            -- subreseller share comes out of the reseller total
  _admin := round(_total - _cb_r - _cb_s, 2);  -- admin keeps the remainder
  _pts := floor(_total / 10);
  _tx := 'DEMO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  update public.demo_vouchers set stock = stock - _quantity where id = _v.id;

  update public.demo_wallets set balance = balance - _total, points = points + _pts
   where ecosystem_id = _ecosystem_id and member_key = 'customer' returning balance into _bal;
  insert into public.demo_ledger (ecosystem_id, member_key, direction, amount, balance_after, entry_kind, reason, tx_id)
  values (_ecosystem_id, 'customer', 'debit', _total, _bal, 'demo_purchase',
          _quantity || ' x ' || _v.name || ' (+' || _pts || ' demo points)', _tx);

  if _cb_r > 0 then
    update public.demo_wallets set balance = balance + _cb_r
     where ecosystem_id = _ecosystem_id and member_key = 'reseller' returning balance into _bal;
    insert into public.demo_ledger (ecosystem_id, member_key, direction, amount, balance_after, entry_kind, reason, tx_id)
    values (_ecosystem_id, 'reseller', 'credit', _cb_r, _bal, 'demo_cashback', 'Cashback on ' || _v.name, _tx);
  end if;
  if _cb_s > 0 then
    update public.demo_wallets set balance = balance + _cb_s
     where ecosystem_id = _ecosystem_id and member_key = 'subreseller' returning balance into _bal;
    insert into public.demo_ledger (ecosystem_id, member_key, direction, amount, balance_after, entry_kind, reason, tx_id)
    values (_ecosystem_id, 'subreseller', 'credit', _cb_s, _bal, 'demo_cashback', 'Cashback on ' || _v.name, _tx);
  end if;
  if _admin > 0 then
    update public.demo_wallets set balance = balance + _admin
     where ecosystem_id = _ecosystem_id and member_key = 'admin' returning balance into _bal;
    insert into public.demo_ledger (ecosystem_id, member_key, direction, amount, balance_after, entry_kind, reason, tx_id)
    values (_ecosystem_id, 'admin', 'credit', _admin, _bal, 'demo_sale', 'Shop share of ' || _quantity || ' x ' || _v.name, _tx);
  end if;

  return jsonb_build_object('tx_id', _tx, 'total', _total, 'reseller', _cb_r,
                            'subreseller', _cb_s, 'admin', _admin, 'points', _pts);
end $$;

revoke all on function public.demo_sell_voucher(uuid, uuid, integer, numeric, numeric) from public, anon;
grant execute on function public.demo_sell_voucher(uuid, uuid, integer, numeric, numeric) to authenticated, service_role;

create or replace function public.demo_reset(_ecosystem_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _seed numeric;
begin
  perform public.demo_guard(_ecosystem_id);
  select coalesce(demo_seed_credits, 1000) into _seed
    from public.shop_subscriptions where ecosystem_id = _ecosystem_id;
  _seed := coalesce(_seed, 1000);

  delete from public.demo_ledger where ecosystem_id = _ecosystem_id;
  update public.demo_wallets
     set balance = case when member_key = 'admin' then _seed else 0 end, points = 0
   where ecosystem_id = _ecosystem_id;
  update public.demo_vouchers
     set stock = case when price <= 10 then 200 when price <= 50 then 100 else 40 end
   where ecosystem_id = _ecosystem_id;
  insert into public.demo_ledger (ecosystem_id, member_key, direction, amount, balance_after, entry_kind, reason)
  values (_ecosystem_id, 'admin', 'credit', _seed, _seed, 'demo_seed', 'Review simulation reset');
end $$;

revoke all on function public.demo_reset(uuid) from public, anon;
grant execute on function public.demo_reset(uuid) to authenticated, service_role;

-- My review shop, for the countdown and the review workspace
create or replace function public.my_review_shop()
returns jsonb language sql security definer stable set search_path to 'public' as $$
  select coalesce((
    select jsonb_build_object('id', e.id, 'name', e.name, 'slug', e.slug,
                              'review_ends_at', e.review_ends_at,
                              'ended', (e.review_ends_at is not null and e.review_ends_at <= now()))
      from public.ecosystems e
      join public.ecosystem_memberships m on m.ecosystem_id = e.id
     where e.is_review and e.archived_at is null and m.user_id = auth.uid()
       and m.role = 'admin' and m.membership_state = 'active'
     order by e.created_at desc limit 1), 'null'::jsonb)
$$;

revoke all on function public.my_review_shop() from public, anon;
grant execute on function public.my_review_shop() to authenticated, service_role;

-- Public guide questions: keep obvious link spam out
create or replace function public.submit_guide_question(_question text, _contact text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _id uuid; _recent int; _links int;
begin
  if length(coalesce(trim(_question),'')) < 10 then
    raise exception 'Please write a little more detail in your question';
  end if;
  if length(_question) > 1000 then raise exception 'Please keep the question under 1000 characters'; end if;

  _links := coalesce(array_length(regexp_split_to_array(lower(_question), '(https?://|www\.)'), 1), 1) - 1;
  if _links > 0 then
    raise exception 'Please ask your question without links';
  end if;

  select count(*) into _recent from public.guide_questions
   where created_at > now() - interval '1 hour';
  if _recent > 60 then raise exception 'Too many questions right now — please try again later'; end if;

  if exists (select 1 from public.guide_questions
              where question = trim(_question) and created_at > now() - interval '1 day') then
    raise exception 'That question was already sent — WaveWallet Support will answer it here';
  end if;

  insert into public.guide_questions (question, contact)
  values (trim(_question), nullif(trim(_contact),''))
  returning id into _id;
  return _id;
end $$;

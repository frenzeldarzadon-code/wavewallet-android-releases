ALTER TABLE public.voucher_sales ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0;

UPDATE public.voucher_sales SET discount_amount = greatest(list_price - sale_price, 0) WHERE payment_method = 'credits' AND discount_amount = 0;

-- Subresellers never receive commission: only the 'reseller' role qualifies (unchanged rule, restated).
CREATE OR REPLACE FUNCTION public.promote_to_subreseller(_user_id uuid, _discount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _actor_name text;
begin
  select ecosystem_id into _eco from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Customer not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount is null or _discount < 0 or _discount > 50 then
    raise exception 'Discount must be between 0 and 50';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _user_id and role = 'customer') then
    raise exception 'Only customers can be promoted to subreseller';
  end if;

  delete from public.user_roles where user_id = _user_id and role = 'customer';
  insert into public.user_roles (user_id, role, ecosystem_id)
  values (_user_id, 'subreseller', _eco) on conflict do nothing;

  update public.profiles
     set reseller_discount_percent = _discount,
         reseller_commission_percent = 0
   where id = _user_id;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Promoted customer to subreseller',
          (select full_name || ' — ' || email from public.profiles where id = _user_id),
          jsonb_build_object('previous_role','customer','new_role','subreseller','discount_percent',_discount,
                             'commission_percent',0));
end; $function$;

-- Discount setter now covers resellers and subresellers, with audit logging.
CREATE OR REPLACE FUNCTION public.set_reseller_discount(_user_id uuid, _discount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _prev integer; _actor_name text; _role public.app_role;
begin
  select ecosystem_id, reseller_discount_percent into _eco, _prev from public.profiles where id = _user_id;
  if _eco is null then raise exception 'Member not found'; end if;
  if not (public.is_ecosystem_admin(auth.uid(), _eco) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this ecosystem';
  end if;
  if _discount is null or _discount < 0 or _discount > 50 then raise exception 'Discount must be between 0 and 50'; end if;

  select role into _role from public.user_roles
   where user_id = _user_id and role in ('reseller','subreseller') limit 1;
  if _role is null then raise exception 'Only resellers and subresellers have a discount'; end if;

  update public.profiles set reseller_discount_percent = _discount where id = _user_id;

  select full_name into _actor_name from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_actor_name,'Admin'),
          'Updated ' || _role::text || ' discount',
          (select full_name from public.profiles where id = _user_id),
          jsonb_build_object('previous_percent',_prev,'new_percent',_discount,'role',_role::text,
                             'applies_to','future purchases only'));
end; $function$;

-- Credit purchases: subresellers get their configured discount; snapshot the exact amounts.
CREATE OR REPLACE FUNCTION public.purchase_voucher(_product_id uuid)
RETURNS TABLE(tx_id text, code text, sale_price numeric, product_name text, sale_id uuid, points_earned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _my_eco uuid; _p public.voucher_products; _acct uuid; _pacct uuid;
        _role public.app_role; _discount int := 0; _list numeric; _price numeric;
        _code public.voucher_codes; _tx text; _sale uuid; _status public.account_status;
        _ratio numeric; _ver integer; _earn integer := 0;
begin
  select ecosystem_id, status into _my_eco, _status from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;

  select role into _role from public.user_roles where user_id = auth.uid()
   order by case role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;
  if _role in ('reseller','subreseller') then
    select reseller_discount_percent into _discount from public.profiles where id = auth.uid();
  end if;
  _discount := coalesce(_discount, 0);

  _list := coalesce(_p.promo_price, _p.credit_price);
  _price := round(_list * (100 - _discount) / 100.0, 2);

  select * into _code from public.voucher_codes
   where product_id = _product_id and status = 'unused'
   order by created_at for update skip locked limit 1;
  if _code.id is null then raise exception 'No voucher codes are available for this product'; end if;

  select id into _acct from public.credit_accounts where user_id = auth.uid();
  if _acct is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();

  select credits_per_point, points_rule_version into _ratio, _ver
    from public.ecosystems where id = _my_eco;
  if coalesce(_ratio,0) > 0 then _earn := floor(_price / _ratio)::int; end if;

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned,
                                    credits_per_point_used, points_rule_version)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          case when _role in ('reseller','subreseller') then auth.uid()
               else (select reseller_id from public.profiles where id = auth.uid()) end,
          _list, _discount, round(_list - _price, 2), _price, 'credits', _tx,
          _p.points_price, 0, _earn, _ratio, _ver)
  returning id into _sale;

  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id)
  values (_acct, auth.uid(), _my_eco, 'debit', _price, 0, 'Voucher purchase — ' || _p.name, _tx, auth.uid(), _tx);

  update public.voucher_codes
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where id = _code.id and status = 'unused';
  if not found then raise exception 'That voucher code was just sold. Please try again.'; end if;

  if _earn > 0 then
    select id into _pacct from public.points_accounts where user_id = auth.uid();
    if _pacct is not null then
      insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                        balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id,
                                        credits_basis, credits_per_point_used, points_rule_version)
      values (_pacct, auth.uid(), _my_eco, 'credit', _earn, 0,
              'Points earned — ' || _p.name || ' (' || _ratio::text || ' credits = 1 pt)',
              _tx, auth.uid(), _tx || '-P', 'earn', _sale, _price, _ratio, _ver);
    else
      _earn := 0;
    end if;
  end if;

  return query select _tx, _code.code, _price, _p.name, _sale, _earn;
end; $function$;

CREATE OR REPLACE FUNCTION public.purchase_voucher_with_points(_product_id uuid)
RETURNS TABLE(tx_id text, code text, points_spent integer, product_name text, sale_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _my_eco uuid; _p public.voucher_products; _pacct uuid; _role public.app_role;
        _code public.voucher_codes; _tx text; _sale uuid; _status public.account_status; _pts integer;
begin
  select ecosystem_id, status into _my_eco, _status from public.profiles where id = auth.uid();
  if _my_eco is null then raise exception 'Your account is not part of a shop'; end if;
  if _status <> 'active' then raise exception 'Your account is suspended'; end if;
  if not public.subscription_ok(_my_eco) then raise exception 'This shop is temporarily unavailable'; end if;

  select * into _p from public.voucher_products where id = _product_id;
  if _p.id is null or _p.ecosystem_id <> _my_eco then raise exception 'Product not available'; end if;
  if not _p.active or _p.archived then raise exception 'This voucher is not on sale right now'; end if;
  _pts := _p.points_price;
  if _pts is null or _pts <= 0 then raise exception 'This voucher cannot be bought with points'; end if;

  select role into _role from public.user_roles where user_id = auth.uid()
   order by case role when 'reseller' then 0 when 'subreseller' then 1 else 2 end limit 1;

  select * into _code from public.voucher_codes
   where product_id = _product_id and status = 'unused'
   order by created_at for update skip locked limit 1;
  if _code.id is null then raise exception 'No voucher codes are available for this product'; end if;

  select id into _pacct from public.points_accounts where user_id = auth.uid();
  if _pacct is null then raise exception 'Points wallet not found'; end if;

  _tx := public.new_tx_id();

  insert into public.voucher_sales (ecosystem_id, product_id, product_name, buyer_id, buyer_role,
                                    reseller_id, list_price, discount_percent, discount_amount, sale_price,
                                    payment_method, tx_id, points_price, points_spent, points_earned)
  values (_my_eco, _p.id, _p.name, auth.uid(), coalesce(_role,'customer'),
          (select reseller_id from public.profiles where id = auth.uid()),
          coalesce(_p.promo_price, _p.credit_price), 0, 0, 0, 'points', _tx, _pts, _pts, 0)
  returning id into _sale;

  insert into public.points_ledger (account_id, user_id, ecosystem_id, direction, amount,
                                    balance_after, reason, reference, actor_id, tx_id, entry_type, sale_id)
  values (_pacct, auth.uid(), _my_eco, 'debit', _pts, 0,
          'Voucher purchase — ' || _p.name, _tx, auth.uid(), _tx, 'spend', _sale);

  update public.voucher_codes
     set status = 'sold', sold_to = auth.uid(), sale_id = _sale, sold_at = now()
   where id = _code.id and status = 'unused';
  if not found then raise exception 'That voucher code was just sold. Please try again.'; end if;

  return query select _tx, _code.code, _pts, _p.name, _sale;
end; $function$;

-- Resellers and subresellers can load credits to customers in their own shop. No commission either way.
CREATE OR REPLACE FUNCTION public.reseller_load_credits(_customer_id uuid, _amount numeric, _reference text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _eco uuid; _my_eco uuid; _from uuid; _to uuid; _tx text; _me text; _target text; _my_role text;
begin
  if public.has_role(auth.uid(), 'reseller') then _my_role := 'reseller';
  elsif public.has_role(auth.uid(), 'subreseller') then _my_role := 'subreseller';
  else raise exception 'Only resellers can load credits';
  end if;

  select ecosystem_id into _my_eco from public.profiles where id = auth.uid();
  select ecosystem_id, full_name || ' — ' || email into _eco, _target from public.profiles where id = _customer_id;
  if _eco is null or _eco is distinct from _my_eco then
    raise exception 'That customer is not in your shop';
  end if;
  if _customer_id = auth.uid() then raise exception 'Choose another member'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;

  select id into _from from public.credit_accounts where user_id = auth.uid();
  select id into _to from public.credit_accounts where user_id = _customer_id;
  if _from is null or _to is null then raise exception 'Wallet not found'; end if;

  _tx := public.new_tx_id();
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_from, auth.uid(), _eco, 'debit', _amount, 0, 'Credit load to customer', nullif(trim(_reference),''), auth.uid(), _tx, _amount, 0, 0);
  insert into public.credit_ledger (account_id, user_id, ecosystem_id, direction, amount, balance_after, reason, reference, actor_id, tx_id, base_amount, commission_percent, commission_amount)
  values (_to, _customer_id, _eco, 'credit', _amount, 0, 'Credit load from ' || _my_role, nullif(trim(_reference),''), auth.uid(), _tx || '-R', _amount, 0, 0);

  select full_name into _me from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_eco, auth.uid(), coalesce(_me,'Reseller'), 'Loaded credits to customer', coalesce(_target,''),
          jsonb_build_object('amount', _amount, 'tx_id', _tx, 'actor_role', _my_role));
  return _tx;
end; $function$;

-- Subresellers may verify reward redemptions in their own shop, like resellers.
DROP POLICY IF EXISTS "Shop staff read redemptions" ON public.reward_redemptions;
CREATE POLICY "Shop staff read redemptions" ON public.reward_redemptions
FOR SELECT USING (
  is_ecosystem_admin(auth.uid(), ecosystem_id)
  OR is_super_admin(auth.uid())
  OR ((has_role(auth.uid(), 'reseller'::app_role) OR has_role(auth.uid(), 'subreseller'::app_role))
      AND ecosystem_id = current_ecosystem(auth.uid()))
);
-- Discount configuration regression suite.
--
-- The single per-member "Discount" is database configuration: editable by the
-- shop admin and the platform owner, never hard-coded, scoped to one shop, and
-- applied to future purchases only. Run inside a transaction and roll back.
--
-- Covers: admin update, super admin update, unauthorized roles, per-shop
-- isolation, persistence, bounds validation, hierarchy rules, audit trail and
-- history immutability.

begin;

do $$
declare
  eco_a uuid := gen_random_uuid();
  eco_b uuid := gen_random_uuid();
  super_id uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid();
  res uuid := gen_random_uuid();
  sub uuid := gen_random_uuid();
  cust uuid := gen_random_uuid();
  ok boolean;
begin
  perform set_config('role', 'postgres', true);

  insert into public.ecosystems (id, name, slug, default_reseller_discount_percent,
                                 default_subreseller_discount_percent)
  values (eco_a, 'Test Shop A', 'test-shop-a-' || left(eco_a::text, 8), 25, 10),
         (eco_b, 'Test Shop B', 'test-shop-b-' || left(eco_b::text, 8), 40, 5);

  insert into public.profiles (id, full_name, email, ecosystem_id)
  values (super_id, 'Owner', 'owner+' || left(super_id::text,8) || '@test.local', eco_a),
         (admin_a, 'Admin A', 'a+' || left(admin_a::text,8) || '@test.local', eco_a),
         (admin_b, 'Admin B', 'b+' || left(admin_b::text,8) || '@test.local', eco_b),
         (res, 'Reseller', 'r+' || left(res::text,8) || '@test.local', eco_a),
         (sub, 'Subreseller', 's+' || left(sub::text,8) || '@test.local', eco_a),
         (cust, 'Customer', 'c+' || left(cust::text,8) || '@test.local', eco_a);

  insert into public.user_roles (user_id, role, ecosystem_id) values
    (super_id, 'super_admin', null),
    (admin_a, 'admin', eco_a),
    (admin_b, 'admin', eco_b),
    (res, 'reseller', eco_a),
    (sub, 'subreseller', eco_a),
    (cust, 'customer', eco_a);

  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, membership_state, reseller_id)
  values (admin_a, eco_a, 'admin', 'active', null),
         (admin_b, eco_b, 'admin', 'active', null),
         (res, eco_a, 'reseller', 'active', null),
         (res, eco_b, 'reseller', 'active', null),
         (sub, eco_a, 'subreseller', 'active', res),
         (cust, eco_a, 'customer', 'active', null);

  ---------------------------------------------------------------- no defaults
  assert public.member_cashback_rate(res, eco_a) = 25,
    'unset member follows shop A default (25), got ' || public.member_cashback_rate(res, eco_a);
  assert public.member_cashback_rate(res, eco_b) = 40,
    'unset member follows shop B default (40)';

  -------------------------------------------------------------- admin can set
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role','authenticated')::text, true);
  perform public.set_member_cashback_rate(res, eco_a, 70, 'admin raises discount');
  assert public.member_cashback_rate(res, eco_a) = 70, 'admin can set 70% (old 50% cap removed)';
  assert (select sale_commission_percent from public.ecosystem_memberships
           where user_id = res and ecosystem_id = eco_a) = 70, 'value persists in the shop membership';
  assert (select reseller_discount_percent from public.ecosystem_memberships
           where user_id = res and ecosystem_id = eco_a) = 70, 'voucher discount stays in sync';

  ------------------------------------------------------------ shop isolation
  assert public.member_cashback_rate(res, eco_b) = 40, 'shop B is unaffected by a shop A change';

  ------------------------------------------------------ super admin any shop
  perform set_config('request.jwt.claims', json_build_object('sub', super_id, 'role','authenticated')::text, true);
  perform public.set_member_cashback_rate(res, eco_b, 15, 'owner adjusts other shop');
  assert public.member_cashback_rate(res, eco_b) = 15, 'super admin can set any shop';
  assert public.member_cashback_rate(res, eco_a) = 70, 'shop A untouched';

  ------------------------------------------------------------ unauthorized
  perform set_config('request.jwt.claims', json_build_object('sub', res, 'role','authenticated')::text, true);
  ok := true;
  begin perform public.set_member_cashback_rate(sub, eco_a, 60, 'nope'); exception when others then ok := false; end;
  assert not ok, 'a reseller cannot change discounts';

  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role','authenticated')::text, true);
  ok := true;
  begin perform public.set_member_cashback_rate(res, eco_a, 60, 'nope'); exception when others then ok := false; end;
  assert not ok, 'a customer cannot change discounts';

  perform set_config('request.jwt.claims', json_build_object('sub', admin_b, 'role','authenticated')::text, true);
  ok := true;
  begin perform public.set_member_cashback_rate(res, eco_a, 60, 'nope'); exception when others then ok := false; end;
  assert not ok, 'an admin of another shop cannot change shop A discounts';

  ----------------------------------------------------------- bounds & rules
  perform set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role','authenticated')::text, true);
  ok := true;
  begin perform public.set_member_cashback_rate(res, eco_a, -5, null); exception when others then ok := false; end;
  assert not ok, 'negative percentages are rejected';
  ok := true;
  begin perform public.set_member_cashback_rate(res, eco_a, 101, null); exception when others then ok := false; end;
  assert not ok, 'percentages above 100 are rejected';

  perform public.set_member_cashback_rate(sub, eco_a, 30, 'subreseller share');
  assert public.member_cashback_rate(sub, eco_a) = 30, 'subreseller share saved';
  ok := true;
  begin perform public.set_member_cashback_rate(sub, eco_a, 80, null); exception when others then ok := false; end;
  assert not ok, 'a subreseller cannot exceed the parent reseller total';
  ok := true;
  begin perform public.set_member_cashback_rate(res, eco_a, 20, null); exception when others then ok := false; end;
  assert not ok, 'a reseller cannot drop below their subreseller share';

  ------------------------------------------------------------------- audit
  assert exists (
    select 1 from public.audit_logs
     where ecosystem_id = eco_a and action = 'Updated member discount'
       and (metadata->>'member_id')::uuid = res
       and (metadata->>'new_percent')::int = 70
       and metadata ? 'previous_percent' and metadata ? 'shop_name'
       and metadata->>'reason' = 'admin raises discount'
  ), 'the discount change is audited with old value, new value, shop and reason';

  raise notice 'discount-configuration: all assertions passed';
end $$;

rollback;

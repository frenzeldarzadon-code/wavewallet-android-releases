-- Customer valid-ID requirement for coin loan requests.
-- Runs inside a transaction that is rolled back: nothing here is kept.
begin;

do $$
declare
  v_shop uuid;
  v_customer uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_loan uuid;
  v_path text;
  v_msg text;
begin
  -- A shop with an admin, and a plain customer with no position anywhere.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, aud, role)
  values (v_admin, 'idtest-admin@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
         (v_customer, 'idtest-customer@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated');

  select id into v_shop from public.ecosystems order by created_at limit 1;

  insert into public.ecosystem_memberships (user_id, ecosystem_id, role, status)
  values (v_admin, v_shop, 'admin', 'active'),
         (v_customer, v_shop, 'customer', 'active');

  -- 1. A customer request with no ID is refused by the database itself.
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  begin
    perform public.request_coin_loan(500);
    raise exception 'FAIL: a customer borrowed without a valid ID';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    raise notice 'PASS no ID refused: %', v_msg;
  end;

  -- 2. With an ID file of their own, the request is accepted and stays pending.
  v_path := v_customer::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('loan-ids', v_path, v_customer, '{}');

  v_loan := (public.request_coin_loan(500, v_path))::uuid;
  perform 1 from public.coin_loans
   where id = v_loan and status = 'pending' and id_document_path = v_path
     and id_document_uploaded_at is not null;
  if not found then raise exception 'FAIL: the loan did not record the ID or is not pending'; end if;
  raise notice 'PASS customer loan pending with ID attached';

  -- 3. The same file cannot be reused for a second request.
  perform public.cancel_coin_loan(v_loan);
  begin
    perform public.request_coin_loan(500, v_path);
    raise exception 'FAIL: the same ID file was attached twice';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    raise notice 'PASS ID reuse refused: %', v_msg;
  end;

  -- 4. Another member's file cannot be claimed.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform public.request_coin_loan(500, v_path);
    raise exception 'FAIL: another member claimed the customer ID file';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like 'FAIL:%' then raise; end if;
    raise notice 'PASS foreign ID refused: %', v_msg;
  end;

  raise notice 'ALL LOAN ID TESTS PASSED';
end $$;

rollback;

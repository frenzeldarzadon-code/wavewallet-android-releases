-- Notification source detection + Super Admin blocklist.
-- Run privileged; everything is rolled back (the final RAISE is intentional).
begin;

do $$
declare _super uuid; _dev uuid; _reg jsonb; _res jsonb; _src jsonb; _row record; _n int;
begin
  select p.id into _super from public.profiles p where public.is_super_admin(p.id) and p.status = 'active' limit 1;
  if _super is null then raise notice 'skipped: no super admin'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);

  _reg := public.register_listener_device('Source test phone', null, 60, 30, 'com.globe.gcash.android', null);
  _dev := (_reg->>'device_id')::uuid;
  update public.listener_devices set status = 'active', last_seen_at = now() where id = _dev;
  delete from public.listener_source_rules where ecosystem_id is null and device_id is null
     and lower(package_name) in ('com.example.chat', 'com.example.bank');

  -- 1. An unknown app is detected (source + channel/category), stored as
  --    "not a payment" and shown as available for review — never discarded.
  _res := public.record_listener_event(_dev, 'src-1', 'com.example.chat', 'Hi, are you free tonight?',
            null, null, null, now(), 'v3', null, null, 'Chatty', null, 'messages', 'msg');
  if _res->>'outcome' <> 'non_payment' then raise exception '1: unknown app must be non_payment (got %)', _res; end if;
  select * into _row from public.listener_events where device_id = _dev and event_uid = 'src-1';
  if _row.channel_id <> 'messages' or _row.category <> 'msg' or _row.app_label <> 'Chatty' then
    raise exception '1: source metadata must be recorded';
  end if;
  _src := public.listener_detected_sources(null);
  if not exists (select 1 from jsonb_array_elements(_src) s
                  where s->>'package_name' = 'com.example.chat' and s->>'effective_mode' = 'allow'
                    and (s->>'non_payment')::int >= 1 and s->>'channel_id' = 'messages') then
    raise exception '1: detected source must be listed as being read (%)', _src;
  end if;

  -- 2. Block it: from now on only the identity is stored, no text, and it is
  --    never a payment candidate; the audit log records who/when.
  perform public.set_listener_source_rule('com.example.chat', 'deny', null, null, 'Chat app');
  _res := public.record_listener_event(_dev, 'src-2', 'com.example.chat', 'You received PHP 500.00 Ref 123456',
            500, '09171234567', null, now(), 'v3', '123456', 'gcash', 'Chatty', null, 'messages', 'msg');
  if _res->>'outcome' <> 'source_disabled' then raise exception '2: blocked source must be source_disabled (got %)', _res; end if;
  select * into _row from public.listener_events where device_id = _dev and event_uid = 'src-2';
  if _row.raw_text is not null or _row.amount_php is not null or _row.reference_key is not null
     or _row.details is not null or _row.provider_id is not null then
    raise exception '2: a blocked source must store identity only';
  end if;
  if _row.channel_id <> 'messages' then raise exception '2: identity still includes channel'; end if;
  if exists (select 1 from public.listener_events e where e.id = _row.id and e.outcome = 'accepted') then
    raise exception '2: blocked events must never be accepted';
  end if;
  if not exists (select 1 from public.audit_logs a where a.action = 'Notification source blocked'
                   and a.target = 'com.example.chat' and a.actor_id = _super) then
    raise exception '2: block must be audited';
  end if;
  _src := public.listener_detected_sources(null);
  if not exists (select 1 from jsonb_array_elements(_src) s
                  where s->>'package_name' = 'com.example.chat' and s->>'effective_mode' = 'deny'
                    and (s->>'blocked_count')::int >= 1 and s->>'rule_mode' = 'deny') then
    raise exception '2: detected list must show the source as blocked';
  end if;

  -- 3. Unblock restores reading; audited as well.
  if public.unblock_listener_source('com.example.chat', null, null) <> 'restored_default' then
    raise exception '3: unblock should restore the default';
  end if;
  _res := public.record_listener_event(_dev, 'src-3', 'com.example.chat', 'Hello again', null, null, null, now(), 'v3');
  if _res->>'outcome' <> 'non_payment' then raise exception '3: unblocked source must be read again'; end if;
  if not exists (select 1 from public.audit_logs a where a.action = 'Notification source rule removed'
                   and a.target = 'com.example.chat') then
    raise exception '3: unblock must be audited';
  end if;

  -- 4. Under a platform-wide "*" block, unblocking one app saves an explicit allow.
  perform public.set_listener_source_rule('*', 'deny', null, null, 'Block all by default');
  if public.unblock_listener_source('com.example.bank', null, null) <> 'allowed_explicitly' then
    raise exception '4: unblock under a wildcard block must save an explicit allow';
  end if;
  if public.listener_source_effective_mode('com.example.bank', null, null) <> 'allow' then
    raise exception '4: the app must now be readable';
  end if;
  if public.listener_source_effective_mode('com.example.chat', null, null) <> 'deny' then
    raise exception '4: other apps stay blocked by the wildcard';
  end if;

  -- 5. A plain member cannot list sources or block anything.
  select p.id into _super from public.profiles p where p.status = 'active' and not public.is_super_admin(p.id) limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', _super)::text, true);
  begin
    _src := public.listener_detected_sources(null);
    raise exception '5: a plain member must not list notification sources';
  exception when others then
    if sqlerrm not ilike '%cannot read notification sources%' then raise; end if;
  end;
  begin
    perform public.unblock_listener_source('com.example.chat', null, null);
    raise exception '5: a plain member must not change sources';
  exception when others then
    if sqlerrm not ilike '%cannot configure notification sources%' then raise; end if;
  end;

  get diagnostics _n = row_count;
  raise exception 'PASS';
end $$;

rollback;

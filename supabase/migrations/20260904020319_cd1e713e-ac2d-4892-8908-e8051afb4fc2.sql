-- Universe-wide recipient search: identity only (name, @handle, avatar).
create or replace function public.lookup_universe_recipient(_query text, _limit integer default 10)
returns table(id uuid, full_name text, handle text, avatar_path text)
language sql
stable security definer
set search_path to 'public'
as $$
  select p.id, p.full_name, p.handle, p.avatar_path
    from public.profiles p
   where auth.uid() is not null
     and length(btrim(coalesce(_query,''))) >= 2
     and p.deleted_at is null
     and p.status = 'active'
     and coalesce(p.is_demo, false) = false
     and p.id <> public.effective_uid()
     and not public.is_super_admin(p.id)
     and (lower(p.full_name) like '%' || lower(btrim(_query)) || '%'
          or (public.normalize_handle(_query) is not null
              and lower(coalesce(p.handle,'')) like '%' || public.normalize_handle(_query) || '%'))
   order by case when lower(coalesce(p.handle,'')) = coalesce(public.normalize_handle(_query),'') then 0
                 when lower(p.full_name) = lower(btrim(_query)) then 1
                 when lower(p.full_name) like lower(btrim(_query)) || '%' then 2
                 else 3 end,
            p.full_name
   limit least(greatest(coalesce(_limit, 10), 1), 20)
$$;

revoke all on function public.lookup_universe_recipient(text, integer) from public, anon;
grant execute on function public.lookup_universe_recipient(text, integer) to authenticated;

-- Global Universe Wallet -> global Universe Wallet. Never a purchase.
create or replace function public.transfer_universe_coins(
  _recipient_id uuid,
  _amount numeric,
  _note text default null,
  _client_key text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _op uuid := auth.uid();
  _subject uuid := public.effective_uid();
  _tx text; _from uuid; _to uuid; _bal numeric(14,2);
  _recipient_status public.account_status; _deleted timestamptz; _demo boolean;
  _target text; _target_handle text; _sender_name text; _sender_handle text; _actor_name text;
  _existing text; _key text := nullif(btrim(coalesce(_client_key,'')),'');
begin
  if _subject is null then raise exception 'Not signed in'; end if;
  perform public.assert_actor_active();
  if _recipient_id is null then raise exception 'Choose a recipient'; end if;
  if _recipient_id = _subject then raise exception 'You cannot send coins to yourself'; end if;
  if _amount is null or _amount <= 0 then raise exception 'Enter a positive amount'; end if;
  if _amount <> round(_amount, 2) then raise exception 'Amounts use at most two decimals'; end if;
  if public.is_super_admin(_subject) then raise exception 'The platform owner issues coins through credit management, not transfers'; end if;

  -- One transfer at a time per sender: blocks double-tap / parallel sends.
  perform pg_advisory_xact_lock(hashtext('universe_transfer:' || _subject::text));

  -- Same client key from the same sender = the same transfer; return it.
  if _key is not null then
    select a.metadata->>'tx_id' into _existing
      from public.audit_logs a
     where a.actor_id = _op
       and a.action = 'Transferred Universe coins'
       and a.metadata->>'sender_id' = _subject::text
       and a.metadata->>'client_key' = _key
       and a.created_at > now() - interval '1 day'
     order by a.created_at desc limit 1;
    if _existing is not null then return _existing; end if;
  end if;

  select p.status, p.deleted_at, coalesce(p.is_demo,false), p.full_name, p.handle
    into _recipient_status, _deleted, _demo, _target, _target_handle
    from public.profiles p where p.id = _recipient_id;
  if _target is null or _deleted is not null or _demo then raise exception 'Recipient not found'; end if;
  if _recipient_status <> 'active' then raise exception 'That account is suspended'; end if;
  if public.is_super_admin(_recipient_id) then raise exception 'The platform owner does not hold a member wallet'; end if;

  select p.full_name, p.handle into _sender_name, _sender_handle from public.profiles p where p.id = _subject;

  -- Global wallets only: ecosystem_id NULL. NG shop wallets are never touched.
  _from := public.ensure_credit_account(_subject, null);
  _to := public.ensure_credit_account(_recipient_id, null);
  if _from is null or _to is null then raise exception 'Universe wallet not found'; end if;
  select ca.balance into _bal from public.credit_accounts ca where ca.id = _from for update;
  if coalesce(_bal,0) < _amount then raise exception 'Not enough Universe coins'; end if;

  _tx := public.new_tx_id();
  -- Plain wallet-to-wallet pair. entry_kind 'general', zero commission, no
  -- sale_id: nothing downstream can read this as a purchase or cashback event.
  insert into public.credit_ledger(account_id,user_id,ecosystem_id,direction,amount,balance_after,reason,reference,actor_id,tx_id,entry_kind,base_amount,commission_percent,commission_amount)
  values(_from,_subject,null,'debit',_amount,0,
         'Credit transfer sent — Universe coins to ' || coalesce('@'||_target_handle, _target),
         nullif(btrim(_note),''),_subject,_tx,'general',_amount,0,0);
  insert into public.credit_ledger(account_id,user_id,ecosystem_id,direction,amount,balance_after,reason,reference,actor_id,tx_id,entry_kind,base_amount,commission_percent,commission_amount)
  values(_to,_recipient_id,null,'credit',_amount,0,
         'Credit transfer received — Universe coins from ' || coalesce('@'||_sender_handle, _sender_name, 'a member'),
         nullif(btrim(_note),''),_subject,_tx||'-R','general',_amount,0,0);

  select full_name into _actor_name from public.profiles where id = _op;
  insert into public.audit_logs(ecosystem_id,actor_id,actor_name,action,target,metadata)
  values(null,_op,coalesce(_actor_name,'Member'),'Transferred Universe coins',coalesce(_target,''),
         jsonb_build_object('amount',_amount,'commission_percent',0,'commission_amount',0,'total_received',_amount,
                            'tx_id',_tx,'global_wallet',true,'sender_id',_subject,'recipient_id',_recipient_id,'client_key',_key));
  return _tx;
end;
$$;

revoke all on function public.transfer_universe_coins(uuid, numeric, text, text) from public, anon;
grant execute on function public.transfer_universe_coins(uuid, numeric, text, text) to authenticated;
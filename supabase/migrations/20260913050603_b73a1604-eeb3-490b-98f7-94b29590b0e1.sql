create or replace function public.retail_order_workspace(_thread_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare _o public.retail_orders; _uid uuid := auth.uid(); _eff uuid := public.effective_uid();
        _seller uuid; _role text; _admin boolean; _manager boolean; _e record;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  select o.* into _o from public.retail_orders o
    join public.dm_threads t on t.order_id = o.id where t.id = _thread_id;
  if _o.id is null then return null; end if;
  if not public.dm_is_active_member(_thread_id, _uid) then
    raise exception 'You are not part of this order';
  end if;
  select name, slug into _e from public.ecosystems where id = _o.ecosystem_id;
  _seller := coalesce(_o.seller_id, public.retail_settlement_recipient(_o.ecosystem_id));
  _admin := public.is_ecosystem_admin(_uid, _o.ecosystem_id) or public.is_super_admin(_uid);
  _manager := public.retail_cod_manager(_o, _uid);
  _role := case when _manager then 'seller'
                when _o.customer_id = _eff then 'customer'
                when _uid = _o.delivery_person_id then 'delivery'
                when _uid = _o.collector_id then 'collector'
                else 'member' end;
  return jsonb_build_object(
    'order_id', _o.id,
    'thread_id', _thread_id,
    'order_no', _o.order_no,
    'shop_name', _e.name,
    'shop_slug', _e.slug,
    'ecosystem_id', _o.ecosystem_id,
    'status', _o.status,
    'fulfillment', _o.fulfillment,
    'fulfillment_status', _o.fulfillment_status,
    'payment_method', _o.payment_method,
    'total', _o.total,
    'delivery_fee', _o.delivery_fee,
    'buyer_charge', coalesce(_o.buyer_charge, _o.total),
    'delivery_address', _o.delivery_address,
    'collector_status', _o.collector_status,
    'cod_cash_received_at', _o.cod_cash_received_at,
    'cod_settled_at', _o.cod_settled_at,
    'decision_note', _o.decision_note,
    'created_at', _o.created_at,
    'role', _role,
    'is_admin', _admin,
    'can_review', _manager and _o.status = 'pending',
    'can_advance', (_manager or (_uid = _o.delivery_person_id and _o.fulfillment_status = 'out_for_delivery'))
                   and _o.status = 'approved'
                   and _o.fulfillment_status not in ('completed','closed'),
    'can_confirm_receipt', _o.customer_id = _eff and _o.status = 'approved'
                           and _o.fulfillment_status = 'delivered',
    'can_customer_cancel', _o.customer_id = _eff and _o.status = 'pending',
    'can_seller_cancel', _manager and _o.status in ('pending','approved')
                         and _o.fulfillment_status <> 'closed',
    'can_collector_confirm', _uid = _o.collector_id and _o.payment_method = 'cod'
                             and _o.collector_status = 'approved'
                             and _o.cod_cash_received_at is null and _o.status = 'approved',
    'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id,
                                                           'name', i.product_name,
                                                           'quantity', i.quantity,
                                                           'line_total', i.line_total)
                                order by i.product_name)
                         from public.retail_order_items i where i.order_id = _o.id), '[]'::jsonb));
end $function$;

revoke all on function public.retail_order_workspace(uuid) from public, anon;
grant execute on function public.retail_order_workspace(uuid) to authenticated, service_role;
create or replace function public.my_retail_orders(_ecosystem_id uuid)
returns table(id uuid, order_no text, status text, fulfillment text, fulfillment_status text, delivered_at timestamptz,
              completed_at timestamptz, shop_name text, seller_name text, delivery_address text, delivery_notes text,
              payment_method text, total numeric, seller_total numeric, platform_fee_percent numeric, platform_fee_amount numeric,
              decision_note text, created_at timestamptz, items jsonb,
              delivery_fee numeric, self_delivery boolean, delivery_person_name text, collector_name text, collector_status text,
              hold_held boolean, cod_settled_at timestamptz, chat_thread_id uuid)
language sql stable security definer set search_path = public as $$
  -- Customer-facing: the internal seller-cut / platform-fee split is never part of this payload.
  select o.id, o.order_no, o.status, o.fulfillment, o.fulfillment_status, o.delivered_at, o.completed_at,
         (select e.name from public.ecosystems e where e.id = o.ecosystem_id),
         (select p.full_name from public.profiles p where p.id = o.seller_id),
         o.delivery_address, o.delivery_notes, o.payment_method, o.total,
         o.total, 0::numeric, 0::numeric,
         o.decision_note, o.created_at,
         coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity,
                    'unit_price', i.unit_price, 'line_total', i.line_total, 'product_id', i.product_id,
                    'regular_unit_price', coalesce(i.regular_unit_price, i.unit_price),
                    'wholesale_applied', i.wholesale_applied,
                    'seller_line_total', i.line_total,
                    'fee_amount', 0) order by i.product_name)
                    from public.retail_order_items i where i.order_id = o.id), '[]'::jsonb),
         o.delivery_fee, o.self_delivery,
         (select p.full_name from public.profiles p where p.id = o.delivery_person_id),
         case when o.collector_status = 'approved' then (select p.full_name from public.profiles p where p.id = o.collector_id) end,
         o.collector_status,
         o.cod_hold_ledger_id is not null and o.cod_settled_at is null and o.refund_ledger_id is null,
         o.cod_settled_at, o.chat_thread_id
    from public.retail_orders o
   where o.ecosystem_id = _ecosystem_id and o.customer_id = public.effective_uid()
   order by o.created_at desc
   limit 100;
$$;
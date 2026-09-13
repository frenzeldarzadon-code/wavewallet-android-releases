/**
 * Order workspace behind a Messenger order thread.
 *
 * Presentation layer only: the snapshot and every permission flag come from
 * `public.retail_order_workspace`, and every action calls the same
 * authoritative RPC the Retail order screens use. Nothing here decides money,
 * stock or status on its own.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Fulfillment, FulfillmentStatus, OrderStatus, PaymentMethod } from "@/lib/retail";

export type OrderRole = "seller" | "customer" | "delivery" | "collector" | "member";

export interface OrderWorkspaceItem {
  product_id: string;
  name: string;
  quantity: number;
  line_total: number;
}

export interface OrderWorkspace {
  order_id: string;
  thread_id: string;
  order_no: string;
  shop_name: string | null;
  shop_slug: string | null;
  ecosystem_id: string;
  status: OrderStatus;
  fulfillment: Fulfillment;
  fulfillment_status: FulfillmentStatus;
  payment_method: PaymentMethod;
  total: number;
  delivery_fee: number;
  buyer_charge: number;
  delivery_address: string | null;
  collector_status: string;
  cod_cash_received_at: string | null;
  cod_settled_at: string | null;
  decision_note: string | null;
  created_at: string;
  role: OrderRole;
  is_admin: boolean;
  can_review: boolean;
  can_advance: boolean;
  can_confirm_receipt: boolean;
  can_customer_cancel: boolean;
  can_seller_cancel: boolean;
  can_collector_confirm: boolean;
  items: OrderWorkspaceItem[];
}

/** Live order snapshot for one order thread, or null when the thread has none. */
export async function fetchOrderWorkspace(threadId: string): Promise<OrderWorkspace | null> {
  const { data, error } = await supabase.rpc("retail_order_workspace", { _thread_id: threadId });
  if (error) throw new Error(error.message);
  return (data as unknown as OrderWorkspace | null) ?? null;
}

/** Seller / shop admin cancellation at any live stage — the backend validates. */
export async function sellerCancelOrder(orderId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc("retail_seller_cancel_order", {
    _order_id: orderId,
    ...(note?.trim() ? { _note: note.trim() } : {}),
  });
  if (error) throw new Error(error.message);
}

export const roleTitle: Record<OrderRole, string> = {
  seller: "You sell this order",
  customer: "Your order",
  delivery: "You deliver this order",
  collector: "You collect the cash for this order",
  member: "Order",
};

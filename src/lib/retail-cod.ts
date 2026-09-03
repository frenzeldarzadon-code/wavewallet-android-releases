/**
 * Retail R6 — cash on delivery floated by a collector's Universe coins.
 *
 * Locked money model (the database is authoritative; this file only mirrors it
 * for display and calls the RPCs):
 *   - Retail price already contains the 1 % platform fee (Seller's Cut ₱100 →
 *     Retail Price ₱101). The fee applies to PRODUCT pricing only.
 *   - The seller-set delivery fee is added on top with NO platform fee.
 *   - Customer cash = retail total + delivery fee (₱101 + ₱20 = ₱121).
 *   - Collector must hold that same ₱121 AVAILABLE before approving; approval
 *     is the only moment coins move (one hold). Assignment alone moves nothing.
 *   - Seller eligibility: the shop's settlement recipient must hold the
 *     embedded platform fee (₱1) available, or COD is simply unavailable.
 *   - Settlement happens exactly once (collector CASH RECEIVED, seller release
 *     3 days after buyer receipt, or admin discrepancy resolution) through one
 *     idempotent path: seller credit after cashback, cashback once, fee record,
 *     delivery share + collector share = 100 % of the delivery fee.
 */
import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import { round2, type CodQuote, type RetailOrder } from "@/lib/retail";

export const COD_FALLBACK_DAYS = 3;

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** Delivery-fee pool split — 100 % of the fee, rounded the same way as the ledger. */
export function splitDeliveryFee(fee: number, deliveryPct: number) {
  const delivery = round2((fee * deliveryPct) / 100);
  return { delivery, collector: round2(fee - delivery) };
}

/** Split configuration is valid only when both parts are whole, non-negative and total exactly 100. */
export const splitProblem = (deliveryPct: number, collectorPct: number): string | null =>
  !Number.isInteger(deliveryPct) || !Number.isInteger(collectorPct)
    ? "Use whole percentages"
    : deliveryPct < 0 || collectorPct < 0
      ? "Percentages cannot be negative"
      : deliveryPct + collectorPct !== 100
        ? `Delivery person + collector must total exactly 100 % (now ${deliveryPct + collectorPct} %)`
        : null;

/** When the seller may release the held float themselves (buyer receipt + 3 days). */
export function fallbackReleaseAt(completedAt: string | null | undefined): Date | null {
  if (!completedAt) return null;
  return new Date(new Date(completedAt).getTime() + COD_FALLBACK_DAYS * 86_400_000);
}

/** Human countdown to the fallback release; `null` when the window has already passed. */
export function fallbackCountdown(
  completedAt: string | null | undefined,
  now = new Date(),
): string | null {
  const at = fallbackReleaseAt(completedAt);
  if (!at) return null;
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return null;
  const h = Math.ceil(ms / 3_600_000);
  if (h >= 48) return `${Math.ceil(h / 24)} days`;
  if (h >= 1) return `${h} h`;
  return `${Math.max(1, Math.ceil(ms / 60_000))} min`;
}

export type CodOrder = Pick<
  RetailOrder,
  | "status"
  | "payment_method"
  | "fulfillment_status"
  | "collector_status"
  | "hold_held"
  | "cod_settled_at"
  | "cod_discrepancy"
  | "cod_cash_received_at"
  | "completed_at"
>;

/** Seller may release the float only after buyer receipt + 3 days, with no discrepancy, before settlement. */
export function canSellerRelease(o: CodOrder, now = new Date()): boolean {
  if (o.payment_method !== "cod" || o.status !== "approved" || !o.hold_held) return false;
  if (o.cod_settled_at || o.cod_discrepancy || o.cod_cash_received_at) return false;
  const at = fallbackReleaseAt(o.completed_at);
  return !!at && now.getTime() >= at.getTime();
}

/** Seller voluntary cancellation is allowed on any approved COD order before settlement. */
export const canSellerCancel = (o: CodOrder) =>
  o.payment_method === "cod" && o.status === "approved" && !o.cod_settled_at && !o.cod_discrepancy;

/** Collector may confirm cash once the order is out for delivery and the float is held. */
export const canCollectorConfirmCash = (o: CodOrder) =>
  o.payment_method === "cod" &&
  o.status === "approved" &&
  !!o.hold_held &&
  !o.cod_settled_at &&
  !o.cod_cash_received_at &&
  ["out_for_delivery", "delivered", "completed"].includes(o.fulfillment_status);

/** Plain-language money state of a COD order for the seller / customer card. */
export function codStageLabel(o: CodOrder): string {
  if (o.payment_method !== "cod") return "";
  if (o.status === "pending") return "Awaiting shop approval";
  if (o.status === "cancelled") return "Cancelled — float released";
  if (o.status === "rejected") return "Rejected";
  if (o.cod_settled_at) return "Settled";
  if (o.cod_discrepancy) return "Cash discrepancy — admin review";
  if (!o.hold_held) {
    if (o.collector_status === "proposed") return "Waiting for collector approval";
    if (o.collector_status === "declined") return "Collector declined — assign another";
    return "No collector yet";
  }
  if (o.completed_at) return "Buyer received — waiting for cash confirmation";
  return "Float held — out with the collector";
}

/* ------------------------------------------------------------------ */
/* Duty workspace helpers (delivery person / collector) — display only */
/* ------------------------------------------------------------------ */

export type DutyRow = Pick<
  CodAssignment,
  | "my_role"
  | "status"
  | "fulfillment_status"
  | "collector_status"
  | "hold_held"
  | "cash_received_at"
  | "discrepancy"
  | "settled_at"
  | "completed_at"
  | "expected_cash"
>;

export interface DutyStep {
  label: string;
  done: boolean;
  current: boolean;
}

/**
 * Compact operational timeline derived only from fields the assignments RPC
 * already returns (no extra table). Steps never show money that has not moved.
 */
export function dutySteps(a: DutyRow): DutyStep[] {
  const fs = a.fulfillment_status;
  const outOrLater = ["out_for_delivery", "delivered", "completed"].includes(fs);
  const deliveredOrLater = ["delivered", "completed"].includes(fs);
  const held = a.hold_held || !!a.settled_at || !!a.cash_received_at;
  const cash = !!a.cash_received_at || !!a.settled_at;
  const settled = !!a.settled_at;
  if (a.collector_status === "none") {
    // No cash float on this order (e.g. plain cash): only the delivery legs apply.
    const raw = [
      { label: "Assigned", done: true },
      { label: "Out for delivery", done: outOrLater },
      { label: "Delivered", done: deliveredOrLater },
    ];
    const firstOpen = raw.findIndex((s) => !s.done);
    return raw.map((s, i) => ({ ...s, current: i === firstOpen }));
  }
  const raw = [
    { label: "Assigned", done: true },
    { label: "Float held", done: held },
    { label: "Out for delivery", done: outOrLater },
    { label: "Delivered", done: deliveredOrLater },
    { label: "Cash received", done: cash },
    { label: "Settled", done: settled },
  ];
  const firstOpen = raw.findIndex((s) => !s.done);
  return raw.map((s, i) => ({ ...s, current: i === firstOpen }));
}

/**
 * The one sentence a duty holder needs: what happens next and whether it is
 * their move. Mirrors the backend transition rules; never authorizes anything.
 */
export function dutyNextStep(a: DutyRow): { text: string; mine: boolean } {
  if (a.status !== "approved") {
    return {
      text: a.status === "pending" ? "Waiting for shop approval" : `Order ${a.status}`,
      mine: false,
    };
  }
  if (a.settled_at) return { text: "Settled — nothing left to do", mine: false };
  if (a.discrepancy) return { text: "Cash discrepancy — the shop admin is reviewing", mine: false };
  if (a.cash_received_at) return { text: "Cash confirmed — settling", mine: false };
  const collector = a.my_role === "collector";
  if (a.collector_status === "none") {
    if (a.fulfillment_status === "out_for_delivery")
      return { text: "Deliver the parcel, then mark it delivered", mine: true };
    if (["delivered", "completed"].includes(a.fulfillment_status))
      return { text: "Delivered — nothing left to do", mine: false };
    return { text: "Waiting for the shop to hand the parcel over", mine: false };
  }
  if (!a.hold_held) {
    if (a.collector_status === "proposed") {
      return collector
        ? { text: "Approve to hold the float, or decline", mine: true }
        : { text: "Waiting for the collector to approve the float", mine: false };
    }
    if (a.collector_status === "declined") {
      return { text: "Collector declined — the shop must assign another", mine: false };
    }
    return { text: "Waiting for a collector", mine: false };
  }
  switch (a.fulfillment_status) {
    case "accepted":
    case "preparing":
    case "ready":
      return { text: "Waiting for the shop to hand the parcel over", mine: false };
    case "out_for_delivery":
      return collector
        ? { text: "Confirm the cash once the customer pays", mine: true }
        : { text: "Deliver the parcel, then mark it delivered", mine: true };
    case "delivered":
    case "completed":
      return collector
        ? { text: "Confirm the cash you received to settle the float", mine: true }
        : { text: "Delivered — waiting for the collector to confirm cash", mine: false };
    default:
      return { text: "Waiting for the shop", mine: false };
  }
}

/* ------------------------------------------------------------------ */
/* RPC wrappers                                                        */
/* ------------------------------------------------------------------ */

export async function fetchCodQuote(ecosystemId: string, sellerTotal: number): Promise<CodQuote> {
  const { data, error } = await supabase.rpc("retail_cod_quote", {
    _ecosystem_id: ecosystemId,
    _seller_total: sellerTotal,
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  return {
    available: !!row?.["available"],
    reason: (row?.["reason"] as string | null) ?? null,
    deliveryFee: Number(row?.["delivery_fee"] ?? 0),
    platformFee: Number(row?.["platform_fee"] ?? 0),
    customerTotal: Number(row?.["customer_total"] ?? 0),
  };
}

export interface CodAssignee {
  user_id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  /** Has the full customer cash total AVAILABLE (held coins never count). */
  collector_eligible: boolean;
}

export async function fetchCodAssignees(orderId: string): Promise<CodAssignee[]> {
  const { data, error } = await supabase.rpc("retail_cod_assignees", { _order_id: orderId });
  if (error) throw new Error(error.message);
  return (data ?? []) as CodAssignee[];
}

/** Assignment never moves coins; the collector's approval does. */
export async function assignCodOrder(
  orderId: string,
  input: { selfDelivery: boolean; deliveryPersonId: string | null; collectorId: string | null },
): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("retail_cod_assign", {
    _order_id: orderId,
    _self_delivery: input.selfDelivery,
    _delivery_person_id: input.deliveryPersonId as string,
    _collector_id: input.collectorId as string,
  });
  if (error) throw new Error(error.message);
}

export async function respondToCollectorRequest(orderId: string, accept: boolean): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("retail_cod_collector_respond", {
    _order_id: orderId,
    _accept: accept,
  });
  if (error) throw new Error(error.message);
}

export async function confirmCashReceived(orderId: string, actualCash: number): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("retail_cod_cash_received", {
    _order_id: orderId,
    _actual_cash: actualCash,
  });
  if (error) throw new Error(error.message);
}

export async function sellerReleaseCod(orderId: string): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("retail_cod_seller_release", { _order_id: orderId });
  if (error) throw new Error(error.message);
}

export async function sellerCancelCod(orderId: string, note?: string): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("retail_cod_seller_cancel", {
    _order_id: orderId,
    ...(note?.trim() ? { _note: note.trim() } : {}),
  });
  if (error) throw new Error(error.message);
}

export async function resolveCodDiscrepancy(
  orderId: string,
  action: "settle" | "cancel",
  note?: string,
): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("retail_cod_resolve_discrepancy", {
    _order_id: orderId,
    _action: action,
    ...(note?.trim() ? { _note: note.trim() } : {}),
  });
  if (error) throw new Error(error.message);
}

export interface CodAssignment {
  id: string;
  order_no: string;
  shop_name: string;
  customer_name: string;
  delivery_address: string | null;
  delivery_notes: string | null;
  status: string;
  fulfillment_status: string;
  my_role: "collector" | "delivery";
  collector_status: string;
  self_delivery: boolean;
  total: number;
  delivery_fee: number;
  expected_cash: number;
  actual_cash: number | null;
  hold_held: boolean;
  cash_received_at: string | null;
  discrepancy: boolean;
  settled_at: string | null;
  completed_at: string | null;
  my_share: number;
  chat_thread_id: string | null;
  created_at: string;
}

export async function fetchMyCodAssignments(): Promise<CodAssignment[]> {
  const { data, error } = await supabase.rpc("retail_my_cod_assignments");
  if (error) throw new Error(error.message);
  return ((data ?? []) as CodAssignment[]).map((a) => ({
    ...a,
    total: Number(a.total),
    delivery_fee: Number(a.delivery_fee),
    expected_cash: Number(a.expected_cash),
    actual_cash: a.actual_cash === null ? null : Number(a.actual_cash),
    my_share: Number(a.my_share ?? 0),
  }));
}

/** Coins currently locked in this member's active COD floats. */
export async function fetchCodHeldTotal(): Promise<number> {
  const { data, error } = await supabase.rpc("retail_cod_held_total");
  if (error) return 0;
  return Number(data ?? 0);
}

/** Opens (or syncs) the order-linked Universe chat and returns its thread id. */
export async function openOrderChat(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc("retail_order_chat", { _order_id: orderId });
  if (error) throw new Error(error.message);
  return String(data);
}

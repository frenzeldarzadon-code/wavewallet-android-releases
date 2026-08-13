/**
 * Platform-owner credit management.
 *
 * Two capabilities live here, both platform-owner only and both authorized in
 * the database (never in this file):
 *
 *  1. Verification of admin credit purchase requests — approve / reject /
 *     freeze. The RPCs lock the order row and refuse a second review, so a
 *     double click or two concurrent operators can only ever release the
 *     credits once.
 *  2. Manual credit — a direct grant from the platform owner to any account.
 *     It goes through `admin_adjust_credits`, which only the platform owner may
 *     call with a positive amount. It writes one immutable `credit_issue`
 *     ledger row plus an audit entry, and never touches voucher inventory.
 */
import { supabase } from "@/integrations/supabase/client";
import { adminAdjustCredits } from "@/lib/wallet";
import type { CreditPurchaseOrder, OrderStatus } from "@/lib/credit-purchases";

/** Marker that separates a manual grant from a purchased or earned credit. */
export const MANUAL_CREDIT_ACTION = "Superadmin Manual Credit";

/** Largest single manual grant the UI will submit without a second thought. */
export const MANUAL_CREDIT_MAX = 10_000_000;

export type QueueFilter = "pending" | OrderStatus | "all";

export const QUEUE_FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "frozen", label: "Frozen" },
  { value: "all", label: "All" },
];

/** How many requests are still waiting for the platform owner. */
export function pendingCount(orders: Pick<CreditPurchaseOrder, "status">[]): number {
  return orders.filter((o) => o.status === "pending").length;
}

export function filterOrders(
  orders: CreditPurchaseOrder[],
  filter: QueueFilter,
): CreditPurchaseOrder[] {
  if (filter === "all") return orders;
  return orders.filter((o) => o.status === filter);
}

/** Balance the target account will hold once the grant is written. */
export function previewBalance(current: number, amount: number): number {
  return Math.round((Number(current || 0) + Number(amount || 0)) * 100) / 100;
}

/** Optional bucket the operator can tag a grant with, for later reporting. */
export const MANUAL_CREDIT_CATEGORIES = [
  "Goodwill",
  "Correction",
  "Promotion",
  "Verified payment",
  "Migration",
] as const;
export type ManualCreditCategory = (typeof MANUAL_CREDIT_CATEGORIES)[number];

/** The reason stored on the ledger row — always identifies the action type. */
export function manualCreditReason(note?: string | null, category?: string | null): string {
  const tag = (category ?? "").trim();
  const extra = (note ?? "").trim();
  const tail = [tag ? `[${tag}]` : "", extra].filter(Boolean).join(" ");
  return tail ? `${MANUAL_CREDIT_ACTION} — ${tail}` : MANUAL_CREDIT_ACTION;
}

/** True when a ledger reason/entry came from a manual platform-owner grant. */
export function isManualCredit(reason: string | null | undefined): boolean {
  return (reason ?? "").startsWith(MANUAL_CREDIT_ACTION);
}

/** Friendly blocker for the manual credit form, or null when it may be sent. */
export function manualCreditIssue(input: {
  userId?: string | null;
  amount: number;
  reason?: string | null;
}): string | null {
  if (!input.userId) return "Choose the account to credit";
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return "Enter how many credits to grant";
  }
  if (!Number.isInteger(input.amount)) {
    return "Credits must be a whole number";
  }
  if (input.amount > MANUAL_CREDIT_MAX) {
    return `A single manual grant is limited to ${MANUAL_CREDIT_MAX.toLocaleString()} credits`;
  }
  if (arguments.length && input.reason !== undefined && (input.reason ?? "").trim().length < 5) {
    return "Give a reason of at least 5 characters";
  }
  return null;
}

/* ------------------------------------------------------------------ data */

/**
 * Grants credits directly. Authorization, atomicity and the audit entry are
 * all the database's job — this only shapes the reason so the entry is
 * recognisable as a manual grant forever after.
 */
export async function grantManualCredit(input: {
  userId: string;
  amount: number;
  reason: string;
  category?: string;
  reference?: string;
}): Promise<string> {
  const issue = manualCreditIssue(input);
  if (issue) throw new Error(issue);
  return adminAdjustCredits({
    userId: input.userId,
    amount: input.amount,
    reason: manualCreditReason(input.reason, input.category ?? null),
    ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
  });
}


/** Shop names for the verification queue (RLS decides what is readable). */
export async function fetchEcosystemNames(): Promise<Map<string, string>> {
  const { data } = await supabase.from("ecosystems").select("id, name");
  return new Map((data ?? []).map((e) => [e.id as string, e.name as string]));
}

/** Count of purchase requests still awaiting verification. */
export async function fetchPendingOrderCount(): Promise<number> {
  const { count, error } = await supabase
    .from("credit_purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) return 0;
  return count ?? 0;
}

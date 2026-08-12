import type { Database } from "@/integrations/supabase/types";

export type EcosystemOverviewRow =
  Database["public"]["Functions"]["platform_overview"]["Returns"][number];

export interface EcosystemCounts {
  admins: number;
  resellers: number;
  subresellers: number;
  customers: number;
  suspendedCustomers: number;
  activeCustomers: number;
  members: number;
}

/**
 * Counters shown on the Super Admin ecosystem cards.
 *
 * Every figure comes straight from `platform_overview`, which resolves each
 * member's single highest role for that ecosystem and already excludes deleted,
 * archived-away and demo profiles. Nothing is derived from demo fixtures, and a
 * subreseller is never folded into the reseller count.
 */
export function ecosystemCounts(row: Pick<
  EcosystemOverviewRow,
  | "admin_count"
  | "reseller_count"
  | "subreseller_count"
  | "customer_count"
  | "suspended_customer_count"
  | "member_count"
>): EcosystemCounts {
  const n = (v: unknown) => Math.max(0, Number(v ?? 0));
  const customers = n(row.customer_count);
  const suspended = Math.min(customers, n(row.suspended_customer_count));
  return {
    admins: n(row.admin_count),
    resellers: n(row.reseller_count),
    subresellers: n(row.subreseller_count),
    customers,
    suspendedCustomers: suspended,
    activeCustomers: customers - suspended,
    members: n(row.member_count),
  };
}

/** Total accounts across all tenants, without double counting any role. */
export function totalAccounts(rows: Array<Pick<EcosystemOverviewRow, "member_count">>) {
  return rows.reduce((sum, r) => sum + Math.max(0, Number(r.member_count ?? 0)), 0);
}

/** Monthly recurring revenue from ecosystems with an active subscription. */
export function platformMrr(
  rows: Array<Pick<EcosystemOverviewRow, "subscription_state" | "plan_price" | "archived_at">>,
) {
  return rows
    .filter((r) => r.subscription_state === "active" && !r.archived_at)
    .reduce((sum, r) => sum + Number(r.plan_price ?? 0), 0);
}

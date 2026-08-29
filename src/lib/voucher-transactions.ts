/**
 * Voucher purchase transactions — presentation grouping only.
 *
 * One voucher_sales row IS one transaction, whatever its quantity. The codes
 * issued by that sale are joined through `voucher_codes.sale_id`, so a
 * transaction can never borrow a code from another purchase or another shop
 * (the code query is already scoped by shop + buyer through RLS).
 *
 * Nothing here writes, prices or re-issues anything.
 */
import type { VoucherState } from "@/lib/omada-voucher-view";

/** Omada's own labels — never renamed, never extended. */
export const OMADA_STATUS_LABEL: Record<VoucherState, string> = {
  unused: "Unused",
  in_use: "In-use",
  expired: "Expired",
};

/** Status order used in the compact summary line. */
const SUMMARY_ORDER: VoucherState[] = ["in_use", "unused", "expired"];

export interface SaleCodeRow {
  code: string;
  sale_id: string | null;
}

/** Maps sale id → every code that sale issued, in a stable order. */
export function groupSaleCodes(rows: SaleCodeRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.sale_id || !row.code) continue;
    const list = map.get(row.sale_id);
    if (list) {
      if (!list.includes(row.code)) list.push(row.code);
    } else map.set(row.sale_id, [row.code]);
  }
  for (const list of map.values()) list.sort((a, b) => a.localeCompare(b));
  return map;
}

/** Per-code status as Omada reported it; `null` when Omada could not say. */
export type CodeStatusMap = Record<string, VoucherState | null>;

/**
 * Compact summary of the individual Omada statuses of one transaction,
 * e.g. "2 In-use · 2 Unused · 1 Expired". Codes without an Omada answer are
 * reported separately instead of being folded into a state.
 */
export function statusSummary(codes: string[], statuses: CodeStatusMap): string | null {
  if (codes.length === 0) return null;
  const counts = new Map<VoucherState, number>();
  let unknown = 0;
  for (const code of codes) {
    const state = statuses[code.toUpperCase()] ?? statuses[code] ?? null;
    if (state) counts.set(state, (counts.get(state) ?? 0) + 1);
    else unknown += 1;
  }
  const parts = SUMMARY_ORDER.filter((s) => counts.get(s))
    .map((s) => `${counts.get(s)} ${OMADA_STATUS_LABEL[s]}`);
  if (unknown > 0) parts.push(`${unknown} status unavailable`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Label for one code, or a neutral note when Omada has no answer for it. */
export function codeStatusLabel(code: string, statuses: CodeStatusMap): string | null {
  const state = statuses[code.toUpperCase()] ?? statuses[code] ?? null;
  return state ? OMADA_STATUS_LABEL[state] : null;
}

/**
 * Super Admin data export / backup.
 *
 * Read-only by construction: every dataset below is a plain SELECT of an
 * explicit, hand-picked column list. Nothing here writes, updates or deletes.
 *
 * Safety rules encoded in this module:
 *  - Column allow-lists only. No `select("*")`, so a future column cannot leak
 *    by accident.
 *  - No authentication material is exportable: password hashes, tokens,
 *    sessions and provider secrets live in the auth schema, which is not
 *    reachable from the client at all. Ecosystem signup tokens and payment
 *    references are deliberately excluded from the profile/ecosystem datasets.
 *  - Tenant scope is explicit: an export is either a single ecosystem or the
 *    whole platform, and the chosen scope is stamped into every file name and
 *    into the manifest.
 *  - RLS still decides what actually comes back; this module never uses a
 *    service-role client.
 */
import { supabase } from "@/integrations/supabase/client";
import { toCsv, downloadCsv } from "@/lib/reports";

export type DatasetGroup = "Vouchers" | "Financial" | "Points" | "Accounts" | "Audit";

export interface ExportDataset {
  id: string;
  label: string;
  description: string;
  group: DatasetGroup;
  /** Source table. */
  table: string;
  /** Explicit safe column allow-list — never `*`. */
  columns: string[];
  /** Column used to scope rows to one ecosystem, when the table has one. */
  ecosystemColumn?: string;
  /** Column used to order rows (usually the creation timestamp). */
  orderBy?: string;
}

export const EXPORT_DATASETS: ExportDataset[] = [
  {
    id: "voucher_products",
    label: "Voucher products",
    description: "Catalogue with prices, stock flags and archive state.",
    group: "Vouchers",
    table: "voucher_products",
    columns: [
      "id",
      "ecosystem_id",
      "name",
      "description",
      "credit_price",
      "points_price",
      "promo_price",
      "promo_note",
      "active",
      "archived",
      "created_at",
      "updated_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "voucher_imports",
    label: "Voucher batches",
    description: "Import batches with row counts and the importing actor.",
    group: "Vouchers",
    table: "voucher_imports",
    columns: [
      "id",
      "ecosystem_id",
      "product_id",
      "actor_name",
      "source",
      "total_rows",
      "imported_count",
      "duplicate_count",
      "invalid_count",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "voucher_codes",
    label: "Voucher codes",
    description: "Full code inventory with status, batch and sale linkage.",
    group: "Vouchers",
    table: "voucher_codes",
    columns: [
      "id",
      "ecosystem_id",
      "product_id",
      "code",
      "status",
      "import_id",
      "sold_to",
      "sale_id",
      "sold_at",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "voucher_sales",
    label: "Voucher sales",
    description: "Every sale with the discount, commission and points snapshot.",
    group: "Financial",
    table: "voucher_sales",
    columns: [
      "id",
      "ecosystem_id",
      "product_id",
      "product_name",
      "buyer_id",
      "buyer_role",
      "reseller_id",
      "quantity",
      "list_price",
      "unit_price",
      "discount_percent",
      "discount_amount",
      "sale_price",
      "payment_method",
      "tx_id",
      "points_spent",
      "points_earned",
      "credits_per_point_used",
      "points_rule_version",
      "commission_recipient_id",
      "commission_percent",
      "commission_amount",
      "upline_recipient_id",
      "upline_commission_percent",
      "upline_commission_amount",
      "refunded_at",
      "refund_reason",
      "refund_tx",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "credit_ledger",
    label: "Credit ledger",
    description: "Immutable credit movements with balances after each entry.",
    group: "Financial",
    table: "credit_ledger",
    columns: [
      "id",
      "ecosystem_id",
      "account_id",
      "user_id",
      "direction",
      "amount",
      "balance_after",
      "reason",
      "reference",
      "tx_id",
      "entry_kind",
      "base_amount",
      "commission_percent",
      "commission_amount",
      "sale_id",
      "reverses_ledger_id",
      "actor_id",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "credit_accounts",
    label: "Credit balances",
    description: "Current credit wallet balance per member.",
    group: "Financial",
    table: "credit_accounts",
    columns: ["id", "ecosystem_id", "user_id", "balance", "created_at", "updated_at"],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "sale_commissions",
    label: "Earnings (sale commissions)",
    description: "Cashback and upline earnings, including reversed rows.",
    group: "Financial",
    table: "sale_commissions",
    columns: [
      "id",
      "ecosystem_id",
      "sale_id",
      "recipient_id",
      "kind",
      "source_lot_id",
      "source_ledger_id",
      "credits_consumed",
      "commission_percent",
      "commission_amount",
      "ledger_id",
      "reversed_at",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "credit_lots",
    label: "Credit lots (provenance)",
    description: "FIFO funding lots that decide who earns commission.",
    group: "Financial",
    table: "credit_lots",
    columns: [
      "id",
      "ecosystem_id",
      "user_id",
      "ledger_id",
      "source_user_id",
      "source_kind",
      "amount",
      "remaining",
      "seq",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "credit_transfer_reversals",
    label: "Credit reversals",
    description: "Dispute reversals with reason, actor and linked entries.",
    group: "Financial",
    table: "credit_transfer_reversals",
    columns: [
      "id",
      "ecosystem_id",
      "original_tx_id",
      "sender_id",
      "recipient_id",
      "original_amount",
      "reversed_amount",
      "kind",
      "reason",
      "note",
      "actor_name",
      "reversal_tx_id",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "points_ledger",
    label: "Points ledger",
    description: "Points earned, spent and adjusted, with the rule snapshot.",
    group: "Points",
    table: "points_ledger",
    columns: [
      "id",
      "ecosystem_id",
      "account_id",
      "user_id",
      "direction",
      "amount",
      "balance_after",
      "entry_type",
      "reason",
      "reference",
      "tx_id",
      "sale_id",
      "redemption_id",
      "credits_basis",
      "credits_per_point_used",
      "points_rule_version",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "points_accounts",
    label: "Points balances",
    description: "Current points balance and held points per member.",
    group: "Points",
    table: "points_accounts",
    columns: [
      "id",
      "ecosystem_id",
      "user_id",
      "balance",
      "held",
      "created_at",
      "updated_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "reward_redemptions",
    label: "Reward redemptions",
    description: "Redemption requests, codes and their handling status.",
    group: "Points",
    table: "reward_redemptions",
    columns: [
      "id",
      "ecosystem_id",
      "reward_id",
      "reward_name",
      "points_price",
      "user_id",
      "user_name",
      "code",
      "status",
      "tx_id",
      "note",
      "handled_by_name",
      "handled_at",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "reward_products",
    label: "Reward products",
    description: "Physical reward catalogue with stock and reservations.",
    group: "Points",
    table: "reward_products",
    columns: [
      "id",
      "ecosystem_id",
      "name",
      "description",
      "points_price",
      "stock",
      "reserved",
      "active",
      "archived",
      "created_at",
      "updated_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "profiles",
    label: "Member accounts",
    description: "Contact details and reseller settings. No credentials.",
    group: "Accounts",
    table: "profiles",
    columns: [
      "id",
      "ecosystem_id",
      "full_name",
      "email",
      "phone",
      "status",
      "reseller_id",
      "reseller_discount_percent",
      "reseller_commission_percent",
      "sale_commission_percent",
      "is_demo",
      "joined_at",
      "deleted_at",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "user_roles",
    label: "Role assignments",
    description: "Which role each account holds in which ecosystem.",
    group: "Accounts",
    table: "user_roles",
    columns: ["id", "user_id", "role", "ecosystem_id", "created_at"],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "ecosystems",
    label: "Ecosystems",
    description: "Shop configuration and rates. Signup tokens are excluded.",
    group: "Accounts",
    table: "ecosystems",
    columns: [
      "id",
      "name",
      "slug",
      "description",
      "contact_email",
      "contact_phone",
      "signup_enabled",
      "plan_name",
      "plan_price",
      "subscription_state",
      "grace_period_days",
      "current_period_end",
      "credits_per_point",
      "points_rule_version",
      "default_commission_percent",
      "default_sale_commission_percent",
      "default_subreseller_sale_commission_percent",
      "default_upline_commission_percent",
      "default_reseller_discount_percent",
      "default_subreseller_discount_percent",
      "operations_frozen",
      "archived_at",
      "last_activity_at",
      "created_at",
    ],
    ecosystemColumn: "id",
    orderBy: "created_at",
  },
  {
    id: "subscription_requests",
    label: "Subscription requests",
    description: "Manual payment submissions and review decisions.",
    group: "Audit",
    table: "subscription_requests",
    columns: [
      "id",
      "ecosystem_id",
      "requested_by_name",
      "plan_name",
      "plan_price",
      "billing_period",
      "amount_due",
      "amount_paid",
      "currency",
      "months_purchased",
      "monthly_rate",
      "remainder_amount",
      "status",
      "decision_reason",
      "reviewed_by_name",
      "reviewed_at",
      "period_start",
      "period_end",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
  {
    id: "audit_logs",
    label: "Audit log",
    description: "Administrative actions with actor, target and metadata.",
    group: "Audit",
    table: "audit_logs",
    columns: [
      "id",
      "ecosystem_id",
      "actor_id",
      "actor_name",
      "action",
      "target",
      "metadata",
      "created_at",
    ],
    ecosystemColumn: "ecosystem_id",
    orderBy: "created_at",
  },
];

/** Datasets grouped for display, preserving declaration order. */
export function datasetGroups(): { group: DatasetGroup; datasets: ExportDataset[] }[] {
  const out: { group: DatasetGroup; datasets: ExportDataset[] }[] = [];
  for (const d of EXPORT_DATASETS) {
    const bucket = out.find((g) => g.group === d.group);
    if (bucket) bucket.datasets.push(d);
    else out.push({ group: d.group, datasets: [d] });
  }
  return out;
}

/** Columns that must never appear in an export, whatever a dataset declares. */
export const FORBIDDEN_COLUMNS = [
  "password",
  "password_hash",
  "encrypted_password",
  "signup_token",
  "token",
  "secret",
  "api_key",
  "access_token",
  "refresh_token",
  "session",
  "proof_path",
];

/** True when every declared column of every dataset is safe to export. */
export function datasetColumnsAreSafe(dataset: ExportDataset): boolean {
  return dataset.columns.every(
    (c) => !FORBIDDEN_COLUMNS.some((bad) => c.toLowerCase().includes(bad)),
  );
}

/* ------------------------------------------------------------------ */
/* Scope + file naming                                                 */
/* ------------------------------------------------------------------ */

export interface ExportScope {
  /** null = whole platform. */
  ecosystemId: string | null;
  /** Human label used in file names and the manifest. */
  ecosystemLabel: string;
}

export const PLATFORM_SCOPE: ExportScope = {
  ecosystemId: null,
  ecosystemLabel: "all-ecosystems",
};

/** Filesystem-safe slug for a scope label. */
export function slugifyScope(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scope"
  );
}

/** UTC stamp used in file names: 2026-08-12_2018Z. */
export function fileStamp(at: Date = new Date()): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)}_${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}

/** wavewallet_credit-ledger_sagada-wave_2026-08-12_2018Z.csv */
export function exportFileName(
  datasetId: string,
  scope: ExportScope,
  at: Date = new Date(),
): string {
  return `wavewallet_${datasetId.replace(/_/g, "-")}_${slugifyScope(
    scope.ecosystemLabel,
  )}_${fileStamp(at)}.csv`;
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

export interface ExportResult {
  datasetId: string;
  label: string;
  rowCount: number;
  fileName: string;
}

const MAX_ROWS = 50000;

const cell = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
};

/** Reads one dataset (read-only) and renders it as CSV text. */
export async function fetchDatasetCsv(
  dataset: ExportDataset,
  scope: ExportScope,
): Promise<{ csv: string; rowCount: number }> {
  if (!datasetColumnsAreSafe(dataset)) {
    throw new Error(`Dataset "${dataset.id}" declares a restricted column.`);
  }
  let query = supabase
    .from(dataset.table as never)
    .select(dataset.columns.join(", "))
    .limit(MAX_ROWS);
  if (scope.ecosystemId && dataset.ecosystemColumn) {
    query = query.eq(dataset.ecosystemColumn, scope.ecosystemId);
  }
  if (dataset.orderBy) query = query.order(dataset.orderBy, { ascending: true });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const csv = toCsv(
    dataset.columns,
    rows.map((r) => dataset.columns.map((c) => cell(r[c]))),
  );
  return { csv, rowCount: rows.length };
}

/** Downloads one dataset as a timestamped, scope-labelled CSV. */
export async function exportDataset(
  dataset: ExportDataset,
  scope: ExportScope,
  at: Date = new Date(),
): Promise<ExportResult> {
  const { csv, rowCount } = await fetchDatasetCsv(dataset, scope);
  const fileName = exportFileName(dataset.id, scope, at);
  downloadCsv(fileName, csv);
  return { datasetId: dataset.id, label: dataset.label, rowCount, fileName };
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

/**
 * Plain-text receipt describing exactly what was exported, when, by whom and
 * under which scope — so an archived backup can be identified later.
 */
export function buildManifest(opts: {
  results: ExportResult[];
  scope: ExportScope;
  actorName: string;
  at?: Date;
}): string {
  const at = opts.at ?? new Date();
  const lines = [
    "WaveWallet data export manifest",
    "===============================",
    `Generated at (UTC): ${at.toISOString()}`,
    `Scope: ${opts.scope.ecosystemId ? opts.scope.ecosystemLabel : "Entire platform (all ecosystems)"}`,
    `Ecosystem id: ${opts.scope.ecosystemId ?? "—"}`,
    `Exported by: ${opts.actorName}`,
    "Purpose: recovery / audit copy. Read-only export; no production data was altered.",
    "Excluded: passwords, auth tokens, sessions, signup tokens and payment proof files.",
    "",
    "Files",
    "-----",
  ];
  for (const r of opts.results) {
    lines.push(`${r.fileName}  —  ${r.label}: ${r.rowCount} rows`);
  }
  lines.push("", `Total datasets: ${opts.results.length}`);
  lines.push(`Total rows: ${opts.results.reduce((s, r) => s + r.rowCount, 0)}`);
  return lines.join("\n");
}

export function manifestFileName(scope: ExportScope, at: Date = new Date()): string {
  return `wavewallet_MANIFEST_${slugifyScope(scope.ecosystemLabel)}_${fileStamp(at)}.txt`;
}

export function downloadManifest(text: string, fileName: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

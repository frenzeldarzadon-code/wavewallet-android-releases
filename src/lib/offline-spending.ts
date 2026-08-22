/**
 * Offline queue for MANUAL Spending Tracker entries only.
 *
 * WaveWallet's financial safety rule is unchanged: anything that moves real
 * value (Coins, vouchers, cash in / cash out, transfers, reversals) is still
 * refused while offline by `requireOnline` and is never queued. Manual income
 * and expense records are a bookkeeping note about money that already moved
 * outside the app — they touch no wallet and no ledger — so they may be
 * written down offline and sent later.
 *
 * How duplicates are avoided: every queued entry carries a client-generated
 * `client_ref` UUID. The `spending_record_income` / `spending_record_expense`
 * functions store it under a unique index and return the existing row when the
 * same reference arrives again, so a retry, a double tap or a second device
 * replaying the queue can never create a second entry. A queued item is
 * removed from the queue only after the server confirms the write.
 */
import { isOffline } from "@/lib/offline-guard";
import { saveManualEntry, type EntryKind, type SpendingEntry } from "@/lib/spending-tracker";

const KEY = "wavewallet.spending.queue.v1";
export const QUEUE_EVENT = "wavewallet:spending-queue";

export interface QueuedEntry {
  /** Client-generated idempotency key, also the local row id. */
  clientRef: string;
  ecosystemId: string;
  kind: EntryKind;
  amount: number;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  occurredAt: string;
  notes: string | null;
  queuedAt: string;
  attempts: number;
  lastError: string | null;
}

/* ------------------------------------------------------------------ */
/* Storage (localStorage — survives app restarts and reloads)          */
/* ------------------------------------------------------------------ */

export function readQueue(): QueuedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const rows = raw ? (JSON.parse(raw) as QueuedEntry[]) : [];
    return Array.isArray(rows) ? rows.filter((r) => r && r.clientRef && r.ecosystemId) : [];
  } catch {
    return [];
  }
}

function writeQueue(rows: QueuedEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(rows));
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

export const queueFor = (ecosystemId: string | null) =>
  ecosystemId ? readQueue().filter((r) => r.ecosystemId === ecosystemId) : [];

export function enqueueEntry(
  entry: Omit<QueuedEntry, "queuedAt" | "attempts" | "lastError">,
): QueuedEntry {
  const row: QueuedEntry = {
    ...entry,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  const rows = readQueue().filter((r) => r.clientRef !== row.clientRef);
  writeQueue([...rows, row]);
  return row;
}

/** Edits an entry that has not been sent yet. Keeps the same idempotency key. */
export function updateQueuedEntry(clientRef: string, patch: Partial<QueuedEntry>): void {
  writeQueue(
    readQueue().map((r) =>
      r.clientRef === clientRef ? { ...r, ...patch, clientRef: r.clientRef } : r,
    ),
  );
}

export function removeQueuedEntry(clientRef: string): void {
  writeQueue(readQueue().filter((r) => r.clientRef !== clientRef));
}

export const newClientRef = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/* ------------------------------------------------------------------ */
/* Local view rows                                                     */
/* ------------------------------------------------------------------ */

/**
 * Queued entries rendered as ordinary report rows so the admin sees them in the
 * totals, charts and list immediately — always flagged as not yet synced, never
 * presented as confirmed server data.
 */
export function queuedAsEntries(rows: QueuedEntry[]): SpendingEntry[] {
  return rows.map((r) => ({
    id: r.clientRef,
    kind: r.kind,
    occurredAt: r.occurredAt,
    description: r.description,
    amount: r.amount,
    source: "manual" as const,
    categoryKey: r.categoryId ? `cat:${r.categoryId}` : "uncategorized",
    categoryName: r.categoryName ?? "Uncategorized",
    memberId: null,
    memberName: null,
    notes: r.notes,
    editable: true,
    sync: r.lastError ? ("failed" as const) : ("pending" as const),
  }));
}

/** Only the queued rows that fall inside the selected reporting period. */
export const queuedInPeriod = (rows: QueuedEntry[], from: Date, to: Date) =>
  rows.filter((r) => {
    const t = new Date(r.occurredAt).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });

/* ------------------------------------------------------------------ */
/* Failure classification                                              */
/* ------------------------------------------------------------------ */

/**
 * Transport failures — the request never produced a definitive answer, so the
 * entry may or may not have reached the server. These are safe to queue and
 * retry: the same `client_ref` makes the retry return the existing row when the
 * first attempt actually succeeded but its response was lost.
 */
const TRANSPORT_PATTERNS = [
  /failed to fetch/i,
  /fetch failed/i,
  /network\s*(request)?\s*(error|failed)/i,
  /networkerror/i,
  /load failed/i,
  /timed? ?out/i,
  /aborted/i,
  /abort ?error/i,
  /connection (closed|reset|refused|lost)/i,
  /socket hang ?up/i,
  /err_(network|internet_disconnected|connection|timed_out)/i,
  /net::/i,
  /(^|\D)(408|502|503|504)(\D|$)/,
  /service unavailable/i,
  /bad gateway/i,
  /gateway time-?out/i,
  /offline/i,
  /internet connection required/i,
];

/**
 * Definitive application answers — validation, permission, not-found and other
 * server verdicts. These must be shown to the admin, never queued: retrying
 * them would fail again forever and hide a real problem.
 */
const DEFINITIVE_PATTERNS = [
  /amount must be/i,
  /description is required/i,
  /unknown .*category/i,
  /not allowed/i,
  /not signed in/i,
  /only record income for your own shop/i,
  /permission/i,
  /violates row-level security/i,
  /duplicate key/i,
  /not found/i,
  /jwt|token/i,
];

/** True when the failure is a transport problem worth queueing and retrying. */
export function isTransportFailure(error: unknown): boolean {
  if (isOffline()) return true;
  const err = error as { message?: string; name?: string; code?: string } | null;
  const text = `${err?.name ?? ""} ${err?.code ?? ""} ${err?.message ?? ""}`.trim();
  if (!text) return true; // No message at all: treat as an inconclusive transport error.
  if (DEFINITIVE_PATTERNS.some((p) => p.test(text))) return false;
  return TRANSPORT_PATTERNS.some((p) => p.test(text));
}

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

export interface FlushResult {
  synced: number;
  failed: number;
  skipped: boolean;
}


/**
 * Sends every queued entry. An item is deleted from the queue only after the
 * server confirms it; a failure keeps the item, records the reason and bumps
 * the attempt count so the next reconnection retries it.
 */
export async function flushQueue(
  ecosystemId?: string | null,
  send: typeof saveManualEntry = saveManualEntry,
): Promise<FlushResult> {
  if (isOffline()) return { synced: 0, failed: 0, skipped: true };
  const rows = readQueue().filter((r) => !ecosystemId || r.ecosystemId === ecosystemId);
  let synced = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await send({
        ecosystemId: r.ecosystemId,
        kind: r.kind,
        amount: r.amount,
        description: r.description,
        categoryId: r.categoryId,
        occurredAt: new Date(r.occurredAt),
        notes: r.notes,
        clientRef: r.clientRef,
      });
      removeQueuedEntry(r.clientRef);
      synced += 1;
    } catch (e) {
      failed += 1;
      updateQueuedEntry(r.clientRef, {
        attempts: r.attempts + 1,
        lastError: (e as Error).message,
      });
      if (isOffline()) break;
    }
  }
  return { synced, failed, skipped: false };
}

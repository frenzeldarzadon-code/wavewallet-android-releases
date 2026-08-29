/**
 * Very short-lived, per-shop memo for Omada voucher states.
 *
 * Reading a voucher's status means walking every voucher group page on the
 * controller. Two people opening their history within the same minute used to
 * pay for that walk twice. This keeps the last snapshot for a few seconds so a
 * repeated read is answered without touching the controller again.
 *
 * Deliberately NOT used for money: voucher state is display information, and a
 * stale entry can never change a balance, a sale or a ledger row. The window is
 * short enough that a voucher that has just been used shows as used on the next
 * refresh. The cache is best-effort — workers are stateless, so a cold worker
 * simply falls back to a live read.
 */
import type { VoucherState } from "./omada-voucher-view";

/** How long a snapshot may answer a repeat request. */
const TTL_MS = 45_000;

interface Snapshot {
  at: number;
  /** Upper-case code → state the controller reported. */
  states: Map<string, VoucherState>;
}

const byShop = new Map<string, Snapshot>();

/**
 * Returns the cached states for `codes` when every requested code is present in
 * a fresh snapshot; otherwise `null`, meaning the controller must be read.
 */
export function cachedStatuses(
  ecosystemId: string,
  codes: string[],
): Record<string, VoucherState> | null {
  const snap = byShop.get(ecosystemId);
  if (!snap || Date.now() - snap.at > TTL_MS) return null;
  const out: Record<string, VoucherState> = {};
  for (const code of codes) {
    const state = snap.states.get(code);
    if (!state) return null;
    out[code] = state;
  }
  return out;
}

/** Stores what the controller just reported for this shop. */
export function rememberStatuses(
  ecosystemId: string,
  states: Record<string, VoucherState>,
): void {
  const entries = Object.entries(states) as [string, VoucherState][];
  if (entries.length === 0) return;
  byShop.set(ecosystemId, { at: Date.now(), states: new Map(entries) });
}

/** Drops a shop's snapshot after generation/import so new codes are read live. */
export function forgetStatuses(ecosystemId: string): void {
  byShop.delete(ecosystemId);
}

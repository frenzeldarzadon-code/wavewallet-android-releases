/**
 * Financial safety boundary for offline use.
 *
 * WaveWallet stays browsable without a connection (app shell, branding, public
 * guide, previously loaded read-only screens), but anything that moves real
 * value — Coins, vouchers, Cashback, Points, cash in / cash out, subscriptions,
 * reversals — must be authorized live by the backend.
 *
 * Nothing is ever queued for later: an offline attempt is refused immediately
 * and the member has to retry on purpose once the connection is back.
 */

export const OFFLINE_TRANSACTION_MESSAGE =
  "Internet connection required for this transaction.";

/**
 * True only when the browser is confident it has no network. Server rendering
 * and environments without the Network Information API are treated as online so
 * the backend stays the single source of truth.
 */
export function isOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

/**
 * Pre-flight check for any authoritative write. Throws before the request is
 * built so no mutation is half-sent, retried or stored for replay.
 */
export function requireOnline(message: string = OFFLINE_TRANSACTION_MESSAGE): void {
  if (isOffline()) throw new Error(message);
}

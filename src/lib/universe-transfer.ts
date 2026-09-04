/**
 * Universe member-to-member coin transfers.
 *
 * One global Universe Wallet per member — this moves coins from the sender's
 * global wallet straight to another member's global wallet. No shop, no
 * upline, no membership, no shop/community wallet. It is a wallet-to-wallet
 * move only: the database books it as a zero-commission `general` ledger pair
 * (`<tx>` / `<tx>-R`) with no sale, so it can never be read as a purchase and
 * never triggers cashback, seller commission, R6/upline commission or shop
 * rewards. New Generation shop wallets are never touched.
 *
 * Nothing here is an authorization layer: `transfer_universe_coins` re-derives
 * the caller, re-checks the recipient, locks the sender and refuses negative
 * balances. The helpers below only keep the button state honest.
 */
import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import { friendlyWalletError } from "@/lib/wallet";

export interface UniverseRecipient {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
}

/** Shortest query the server will answer. */
export const MIN_UNIVERSE_RECIPIENT_QUERY = 2;

/** Note length the ledger comfortably stores as a reference. */
export const MAX_TRANSFER_NOTE = 80;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Balance left after sending. Never negative. */
export const balanceAfterTransfer = (balance: number, amount: number): number =>
  round2(Math.max(0, (Number(balance) || 0) - (Number(amount) || 0)));

/** Turns the keypad string into a number (empty / junk → 0). */
export function parseCoinAmount(raw: string): number {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * The single reason a transfer cannot be submitted, or null when it is valid.
 * Mirrors every guard the database enforces, so the button state matches.
 */
export function validateUniverseTransfer(input: {
  senderId: string | null;
  recipientId: string | null;
  amount: number;
  balance: number;
  note?: string;
}): string | null {
  const { senderId, recipientId, amount, balance, note } = input;
  if (!senderId) return "Sign in to send coins.";
  if (!recipientId) return "Choose who to send coins to.";
  if (recipientId === senderId) return "You cannot send coins to yourself.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter a positive amount.";
  if (round2(amount) !== amount) return "Amounts use at most two decimals.";
  if (amount > balance) return "That is more than your Universe wallet holds.";
  if ((note ?? "").length > MAX_TRANSFER_NOTE) return `Keep the note under ${MAX_TRANSFER_NOTE} characters.`;
  return null;
}

/** "@handle" when claimed, otherwise the display name. */
export const recipientLabel = (r: Pick<UniverseRecipient, "full_name" | "handle">): string =>
  r.handle ? `@${r.handle}` : r.full_name;

/** One key per attempt; a retry of the same attempt can never double-send. */
export function newTransferKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

/** Universe-wide member search by name or @handle. Identity only. */
export async function searchUniverseRecipients(
  query: string,
  limit = 10,
): Promise<UniverseRecipient[]> {
  const term = query.trim();
  if (term.length < MIN_UNIVERSE_RECIPIENT_QUERY) return [];
  const { data, error } = await supabase.rpc("lookup_universe_recipient", {
    _query: term,
    _limit: limit,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return ((data ?? []) as UniverseRecipient[]).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    handle: r.handle ?? null,
    avatar_path: r.avatar_path ?? null,
  }));
}

/** Global wallet → global wallet. Returns the transaction id. */
export async function sendUniverseCoins(input: {
  recipientId: string;
  amount: number;
  note?: string;
  clientKey: string;
}): Promise<string> {
  requireOnline();
  const { data, error } = await supabase.rpc("transfer_universe_coins", {
    _recipient_id: input.recipientId,
    _amount: input.amount,
    ...(input.note?.trim() ? { _note: input.note.trim() } : {}),
    _client_key: input.clientKey,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return (data ?? "") as string;
}

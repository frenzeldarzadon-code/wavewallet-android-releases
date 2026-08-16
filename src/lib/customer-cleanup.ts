/**
 * Customer account cleanup.
 *
 * A customer login can be removed once the account carries no remaining value.
 * Deletion is an ANONYMISATION: the profile identity is scrubbed and access is
 * revoked, while every immutable financial record (voucher sales, credit and
 * points ledgers, commissions, discounts, redemptions) is preserved and stays
 * under the normal one-year retention policy.
 *
 * Eligibility is evaluated here for the UI, and re-evaluated authoritatively by
 * the database in `public.customer_deletion_check` before any deletion runs.
 */
import type { Role } from "@/lib/wavewallet";

export const DELETION_MIN_AGE_MONTHS = 3;

export interface DeletionCandidate {
  role: Role;
  joinedAt: string;
  credits: number;
  points: number;
  pointsHeld: number;
  pendingRedemptions: number;
  deletedAt?: string | null;
}

export interface DeletionVerdict {
  eligible: boolean;
  /** Plain-language reasons the account cannot be deleted. */
  blockers: string[];
  /** Plain-language reasons the account IS safe to delete. */
  reasons: string[];
}

function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Pure eligibility rule — mirrored by `public.customer_deletion_check`. */
export function evaluateCustomerDeletion(
  candidate: DeletionCandidate,
  now: Date = new Date(),
): DeletionVerdict {
  const blockers: string[] = [];
  const reasons: string[] = [];

  if (candidate.deletedAt) blockers.push("This account has already been deleted.");

  if (candidate.role !== "customer") {
    blockers.push("Only plain customer accounts can be deleted here.");
  } else {
    reasons.push("The account is a plain customer with no operator role.");
  }

  const cutoff = monthsBefore(now, DELETION_MIN_AGE_MONTHS);
  if (new Date(candidate.joinedAt).getTime() > cutoff.getTime()) {
    blockers.push(`The account is less than ${DELETION_MIN_AGE_MONTHS} months old.`);
  } else {
    reasons.push(`The account is at least ${DELETION_MIN_AGE_MONTHS} months old.`);
  }

  if (candidate.credits !== 0) {
    blockers.push(`Coin balance is not zero (${candidate.coins}).`);
  } else {
    reasons.push("Coin balance is exactly 0.");
  }

  if (candidate.points !== 0) blockers.push(`Points balance is not zero (${candidate.points}).`);
  if (candidate.pointsHeld !== 0)
    blockers.push(`There are points on hold (${candidate.pointsHeld}).`);
  if (candidate.points === 0 && candidate.pointsHeld === 0)
    reasons.push("Points balance is 0 with nothing on hold.");


  if (candidate.pendingRedemptions > 0) {
    blockers.push(
      candidate.pendingRedemptions === 1
        ? "There is 1 reward order still waiting."
        : `There are ${candidate.pendingRedemptions} reward orders still waiting.`,
    );
  } else {
    reasons.push("No reward order is waiting.");
  }

  return { eligible: blockers.length === 0, blockers, reasons };
}

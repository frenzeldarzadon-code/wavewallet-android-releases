import { describe, expect, it } from "vitest";
import {
  isReversibleTransferEntry,
  remainingReversible,
  reversalStatusLabel,
  REVERSAL_REASONS,
  SPENT_MESSAGE,
  validateReversalAmount,
} from "@/lib/transfer-reversal";

const entry = (over: Partial<Parameters<typeof isReversibleTransferEntry>[0]> = {}) => ({
  direction: "debit" as const,
  reason: "Credit transfer sent",
  sale_id: null,
  entry_kind: "general",
  tx_id: "TX-1",
  ...over,
});

describe("transfer eligibility", () => {
  it("accepts a plain credit transfer debit", () => {
    expect(isReversibleTransferEntry(entry())).toBe(true);
  });

  it("rejects voucher sale entries so the refund workflow is used instead", () => {
    expect(isReversibleTransferEntry(entry({ sale_id: "s1", reason: "Voucher purchase" }))).toBe(false);
    expect(isReversibleTransferEntry(entry({ entry_kind: "purchase", reason: "Voucher purchase" }))).toBe(
      false,
    );
  });

  it("rejects commission, cashback and admin adjustment entries", () => {
    expect(isReversibleTransferEntry(entry({ entry_kind: "sale_commission", reason: "Credit-back" }))).toBe(
      false,
    );
    expect(isReversibleTransferEntry(entry({ reason: "Admin adjustment" }))).toBe(false);
  });

  it("rejects the recipient side (only the original transfer debit is actionable)", () => {
    expect(isReversibleTransferEntry(entry({ direction: "credit", reason: "Credit transfer received" }))).toBe(
      false,
    );
  });
});

describe("reversal amount validation", () => {
  it("allows a full reversal when the whole amount is unspent", () => {
    expect(validateReversalAmount({ amount: 100, original: 100, available: 100 })).toEqual({
      ok: true,
      kind: "full",
      error: null,
    });
  });

  it("allows a smaller partial reversal", () => {
    expect(validateReversalAmount({ amount: 40, original: 100, available: 60 })).toEqual({
      ok: true,
      kind: "partial",
      error: null,
    });
  });

  it("blocks a full reversal when credits were already spent or transferred onward", () => {
    const res = validateReversalAmount({ amount: 100, original: 100, available: 60 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(SPENT_MESSAGE);
  });

  it("blocks any reversal when nothing of the transfer remains", () => {
    expect(validateReversalAmount({ amount: 10, original: 100, available: 0 }).error).toBe(SPENT_MESSAGE);
  });

  it("never lets the reversal exceed the original transfer", () => {
    expect(validateReversalAmount({ amount: 150, original: 100, available: 200 }).ok).toBe(false);
  });

  it("rejects zero and negative amounts so a wallet can never go negative", () => {
    expect(validateReversalAmount({ amount: 0, original: 100, available: 100 }).ok).toBe(false);
    expect(validateReversalAmount({ amount: -25, original: 100, available: 100 }).ok).toBe(false);
  });
});

describe("reversal status + remaining reversible", () => {
  it("labels an untouched transfer as original", () => {
    expect(reversalStatusLabel({ amount: 100, reversed_amount: 0 })).toBe("Original transfer");
  });

  it("distinguishes full from partial reversal", () => {
    expect(reversalStatusLabel({ amount: 100, reversed_amount: 100, reversal_kind: "full" })).toBe(
      "Reversed",
    );
    expect(reversalStatusLabel({ amount: 100, reversed_amount: 40, reversal_kind: "partial" })).toBe(
      "Partially reversed",
    );
  });

  it("reports zero remaining once a transfer has been reversed (idempotent, one reversal only)", () => {
    expect(remainingReversible({ amount: 100, available: 100, reversed_amount: 40 })).toBe(0);
  });

  it("caps remaining at the unspent amount attributable to the transfer", () => {
    expect(remainingReversible({ amount: 100, available: 55, reversed_amount: 0 })).toBe(55);
  });
});

describe("dispute reasons", () => {
  it("offers the agreed dispute reasons", () => {
    expect(REVERSAL_REASONS).toContain("Duplicate transfer");
    expect(REVERSAL_REASONS).toContain("Fraud / unauthorized transfer");
    expect(REVERSAL_REASONS).toContain("Other");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_RULE,
  evaluateMatch,
  matchingStatusLabel,
  MATCH_REASON,
  normalizePaymentReference,
  normalizePhMobile,
  samePhMobile,
  type AutoApprovalRule,
  type CashInAutoStatus,
  type MatchableRequest,
} from "./cash-in-auto";

const on: AutoApprovalRule = { ...DEFAULT_AUTO_RULE, enabled: true, require_listener_match: true };
const RECEIVING = "09541230072";
const SENDER = "09171234567";

/** A real GCash notification seen by the paired phone on the receiving account. */
const seen = { sender_number: "+639171234567", amount_php: 500, outcome: "accepted", device_online: true };

const req: MatchableRequest = {
  amount_php: 500,
  payer_reference: "GC-1234",
  sender_number: SENDER,
  proof_path: "user/abc.jpg",
  receipt_check: "matched",
  status: "pending",
  listener_event: seen,
};

describe("payment reference normalisation", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(normalizePaymentReference("GC-1234")).toBe(normalizePaymentReference("gc 1234"));
    expect(normalizePaymentReference("  gc/1234 ")).toBe("gc1234");
  });
  it("treats blank references as absent", () => {
    expect(normalizePaymentReference("")).toBeNull();
    expect(normalizePaymentReference("---")).toBeNull();
    expect(normalizePaymentReference(null)).toBeNull();
  });
});

describe("Philippine mobile normalisation", () => {
  it("treats equivalent formats as the same number", () => {
    expect(normalizePhMobile("09171234567")).toBe("639171234567");
    expect(normalizePhMobile("+63 917 123 4567")).toBe("639171234567");
    expect(normalizePhMobile("639171234567")).toBe("639171234567");
    expect(normalizePhMobile("9171234567")).toBe("639171234567");
    expect(samePhMobile("09171234567", "+639171234567")).toBe(true);
  });
  it("keeps different numbers apart", () => {
    expect(samePhMobile("09171234567", "09181234567")).toBe(false);
    expect(samePhMobile(null, "09171234567")).toBe(false);
    expect(normalizePhMobile("")).toBeNull();
  });
});

describe("automatic approval matching", () => {
  it("approves when a real payment matches the sender and the exact amount", () => {
    expect(evaluateMatch(req, on, RECEIVING)).toBe("matched");
  });

  it("approves a payment that arrived before the request was submitted", () => {
    // Order is irrelevant here: the request simply carries the linked event.
    expect(evaluateMatch({ ...req, listener_event: { ...seen } }, on, RECEIVING)).toBe("matched");
  });

  it("compares equivalent phone formats", () => {
    expect(
      evaluateMatch({ ...req, sender_number: "+639171234567" }, on, "+63 954 123 0072"),
    ).toBe("matched");
  });

  it("never approves while the feature is off", () => {
    expect(evaluateMatch(req, DEFAULT_AUTO_RULE, RECEIVING)).toBe("disabled");
  });

  it("never approves a duplicate reference", () => {
    expect(evaluateMatch({ ...req, duplicate_reference: true }, on, RECEIVING)).toBe("duplicate_reference");
  });

  it("requires a payment reference", () => {
    expect(evaluateMatch({ ...req, payer_reference: "" }, on, RECEIVING)).toBe("no_reference");
  });

  it("requires the payment screenshot as supporting evidence", () => {
    expect(evaluateMatch({ ...req, proof_path: null }, on, RECEIVING)).toBe("no_proof");
  });

  it("never approves on the screenshot alone, without a real notification", () => {
    expect(evaluateMatch({ ...req, listener_event: null }, on, RECEIVING)).toBe("awaiting_listener");
  });

  it("rejects a payment sent from a different GCash number", () => {
    expect(
      evaluateMatch({ ...req, listener_event: { ...seen, sender_number: "09181234567" } }, on, RECEIVING),
    ).toBe("number_mismatch");
  });

  it("rejects a payment whose amount differs from the request", () => {
    expect(
      evaluateMatch({ ...req, listener_event: { ...seen, amount_php: 499 } }, on, RECEIVING),
    ).toBe("amount_mismatch");
  });

  it("requires the sending number on the request", () => {
    expect(evaluateMatch({ ...req, sender_number: null }, on, RECEIVING)).toBe("no_sender_number");
  });

  it("cannot approve when no receiving number is configured", () => {
    expect(evaluateMatch(req, on, null)).toBe("no_receiving_number");
  });

  it("waits while the paired phone is offline", () => {
    expect(
      evaluateMatch({ ...req, listener_event: { ...seen, device_online: false } }, on, RECEIVING),
    ).toBe("listener_offline");
  });

  it("rejects a wrong amount against the configured expected amount", () => {
    const exact = { ...on, expected_amount_php: 500 };
    expect(evaluateMatch(req, exact, RECEIVING)).toBe("matched");
    expect(
      evaluateMatch({ ...req, amount_php: 499, listener_event: { ...seen, amount_php: 499 } }, exact, RECEIVING),
    ).toBe("amount_mismatch");
  });

  it("accepts a small difference only within the configured tolerance", () => {
    const lenient = { ...on, expected_amount_php: 500, amount_tolerance_php: 1 };
    expect(
      evaluateMatch({ ...req, amount_php: 499, listener_event: { ...seen, amount_php: 499 } }, lenient, RECEIVING),
    ).toBe("matched");
    expect(
      evaluateMatch({ ...req, amount_php: 497, listener_event: { ...seen, amount_php: 497 } }, lenient, RECEIVING),
    ).toBe("amount_mismatch");
  });

  it("leaves amounts above the automatic limit for manual review", () => {
    expect(evaluateMatch(req, { ...on, max_auto_amount_php: 400 }, RECEIVING)).toBe("above_auto_limit");
  });

  it("never re-decides a settled request", () => {
    expect(evaluateMatch({ ...req, status: "approved" }, on, RECEIVING)).toBe("not_pending");
  });

  it("has member-readable wording for every outcome", () => {
    for (const reason of Object.values(MATCH_REASON)) expect(reason.length).toBeGreaterThan(10);
    expect(MATCH_REASON.matched).not.toMatch(/GCash verified/i);
  });
});

describe("settings banner", () => {
  const base: CashInAutoStatus = {
    platform_rule: null,
    shop_rules: [],
    shops_with_number: 0,
    duplicates_blocked_30d: 0,
    auto_approved_30d: 0,
  };

  it("warns while automatic matching is off", () => {
    expect(matchingStatusLabel(base).tone).toBe("warning");
    expect(matchingStatusLabel(null).tone).toBe("warning");
  });

  it("confirms once matching is enabled, without claiming GCash verified anything", () => {
    const label = matchingStatusLabel({
      ...base,
      platform_rule: { ...DEFAULT_AUTO_RULE, enabled: true, ecosystem_id: null },
    });
    expect(label.tone).toBe("success");
    expect(label.detail).toMatch(/never contacted/i);
  });
});

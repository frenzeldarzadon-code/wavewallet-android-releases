import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_RULE,
  evaluateMatch,
  feedStatusLabel,
  MATCH_REASON,
  normalizePaymentReference,
  type AutoApprovalRule,
  type CashInAutoStatus,
} from "./cash-in-auto";

const on: AutoApprovalRule = { ...DEFAULT_AUTO_RULE, enabled: true };
const req = { amount_php: 500, payer_reference: "GC-1234", method_id: "m1" };
const paid = { amount_php: 500, payer_reference: "gc 1234", payment_method_id: "m1", status: "unmatched" };

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

describe("automatic approval matching", () => {
  it("approves an exact verified match", () => {
    expect(evaluateMatch(req, paid, on, true)).toBe("matched");
  });

  it("never approves without an authorised feed, however good the match", () => {
    expect(evaluateMatch(req, paid, on, false)).toBe("no_feed");
  });

  it("never approves while the feature is off", () => {
    expect(evaluateMatch(req, paid, DEFAULT_AUTO_RULE, true)).toBe("disabled");
  });

  it("never approves without a verified payment (a screenshot is not one)", () => {
    expect(evaluateMatch(req, null, on, true)).toBe("amount_mismatch");
  });

  it("rejects a mismatched amount outside tolerance", () => {
    expect(evaluateMatch(req, { ...paid, amount_php: 499 }, on, true)).toBe("amount_mismatch");
  });

  it("accepts a small difference only within the configured tolerance", () => {
    const lenient = { ...on, amount_tolerance_php: 1 };
    expect(evaluateMatch(req, { ...paid, amount_php: 499 }, lenient, true)).toBe("matched");
    expect(evaluateMatch(req, { ...paid, amount_php: 497 }, lenient, true)).toBe("amount_mismatch");
  });

  it("rejects a mismatched reference when reference matching is required", () => {
    expect(evaluateMatch(req, { ...paid, payer_reference: "OTHER" }, on, true)).toBe("reference_mismatch");
  });

  it("requires the member to supply a reference when reference matching is on", () => {
    expect(evaluateMatch({ ...req, payer_reference: null }, paid, on, true)).toBe("no_reference");
  });

  it("matches on amount alone when reference matching is switched off", () => {
    const loose = { ...on, require_reference_match: false };
    expect(evaluateMatch({ ...req, payer_reference: null }, { ...paid, payer_reference: null }, loose, true)).toBe(
      "matched",
    );
  });

  it("never reuses a payment that already settled another request", () => {
    expect(evaluateMatch(req, { ...paid, status: "consumed" }, on, true)).toBe("already_consumed");
    expect(evaluateMatch(req, { ...paid, consumed_cash_in_id: "x" }, on, true)).toBe("already_consumed");
  });

  it("sends payments above the automatic limit to manual review", () => {
    expect(evaluateMatch(req, paid, { ...on, max_auto_amount_php: 499 }, true)).toBe("above_auto_limit");
    expect(evaluateMatch(req, paid, { ...on, max_auto_amount_php: 500 }, true)).toBe("matched");
  });

  it("rejects a payment received on a different payment account", () => {
    expect(evaluateMatch(req, { ...paid, payment_method_id: "m2" }, on, true)).toBe("method_mismatch");
  });

  it("has plain wording for every outcome", () => {
    for (const key of Object.keys(MATCH_REASON) as (keyof typeof MATCH_REASON)[]) {
      expect(MATCH_REASON[key].length).toBeGreaterThan(10);
    }
  });
});

describe("feed status banner", () => {
  const base: CashInAutoStatus = {
    sources: [],
    connected: false,
    platform_rule: null,
    shop_rules: [],
    unmatched_payments: 0,
    auto_approved_30d: 0,
  };
  it("warns and explains manual fallback when nothing is connected", () => {
    const b = feedStatusLabel(base);
    expect(b.tone).toBe("warning");
    expect(b.detail).toMatch(/manual review/i);
    expect(b.detail).toMatch(/screenshots are never/i);
  });
  it("confirms when a feed is connected", () => {
    expect(feedStatusLabel({ ...base, connected: true }).tone).toBe("success");
  });
});

import { describe, expect, it } from "vitest";
import {
  type AutoApprovedPayment,
  REVIEW_LABEL,
  matchSignals,
  matchesSearch,
  planSummary,
  planTotal,
  reviewTone,
} from "./auto-payments";

const row = (o: Partial<AutoApprovedPayment> = {}): AutoApprovedPayment => ({
  id: "r1",
  ecosystem_id: "e1",
  shop_name: "Sagada Wave",
  operator_name: "Ana Reyes",
  plan_name: "Starter",
  monthly_rate: 299,
  months_purchased: 3,
  amount_due: 897,
  amount_paid: 897,
  payment_reference: "ABC123",
  payer_number: "09171234567",
  payment_method_name: "Platform GCash",
  purpose: "go_live",
  submitted_at: "2026-08-23T01:00:00Z",
  auto_approved_at: "2026-08-23T01:05:00Z",
  auto_reason: "verified",
  review_state: "pending",
  reviewed_by_name: null,
  reviewed_at: null,
  review_reason: null,
  entitlement_hold: false,
  operations_frozen: false,
  frozen_reason: null,
  listener_provider: "GCash",
  listener_sender: "09171234567",
  listener_reference: "ABC123",
  listener_amount: 897,
  listener_posted_at: "2026-08-23T01:04:00Z",
  ...o,
});

describe("auto-approved payment review", () => {
  it("never shows a zero total when a plan was selected", () => {
    expect(planTotal(row())).toBe(897);
    expect(planTotal(row({ monthly_rate: 0, amount_paid: 500 }))).toBe(500);
    expect(planSummary(row())).toContain("299");
    expect(planSummary(row())).toContain("3 months");
  });

  it("labels and tones each review state", () => {
    expect(REVIEW_LABEL.pending).toBe("Pending Super Admin Review");
    expect(reviewTone("verified")).toBe("success");
    expect(reviewTone("invalid")).toBe("danger");
    expect(reviewTone("pending")).toBe("warning");
  });

  it("lists the independent signals behind the automatic match", () => {
    expect(matchSignals(row())).toEqual(["Reference", "Sending account", "Amount", "Receiving account"]);
    expect(matchSignals(row({ listener_reference: null, listener_sender: null, payment_method_name: null })))
      .toEqual(["Amount"]);
  });

  it("searches shop, operator, reference and payer", () => {
    expect(matchesSearch(row(), "")).toBe(true);
    expect(matchesSearch(row(), "abc123")).toBe(true);
    expect(matchesSearch(row(), "ana")).toBe(true);
    expect(matchesSearch(row(), "0917")).toBe(true);
    expect(matchesSearch(row(), "nothing")).toBe(false);
  });
});

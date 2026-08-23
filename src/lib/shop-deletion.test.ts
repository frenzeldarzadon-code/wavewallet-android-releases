import { describe, expect, it } from "vitest";
import {
  canSubmitShopDeletion,
  deleteConfirmationMatches,
  deletionBlockedReason,
  type ShopDeletionCheck,
} from "./shop-deletion";
import { latestPerShop, paymentNote, type PendingPaymentShop } from "./payment-override";

const clear: ShopDeletionCheck = {
  ecosystem_id: "e1",
  outstanding_total: 0,
  holders: [],
  can_delete: true,
};
const held: ShopDeletionCheck = {
  ecosystem_id: "e1",
  outstanding_total: 250,
  holders: [{ user_id: "u1", name: "Ana", handle: "ana", balance: 250 }],
  can_delete: false,
};

describe("shop deletion rule", () => {
  it("blocks while a member still holds Coins and explains why", () => {
    const why = deletionBlockedReason(held);
    expect(why).toContain("250 Coins");
    expect(why).toContain("return");
  });

  it("allows deletion when every member balance is zero", () => {
    expect(deletionBlockedReason(clear)).toBeNull();
  });

  it("requires an exact shop-name confirmation", () => {
    expect(deleteConfirmationMatches("Sagada Wave", " Sagada Wave ")).toBe(true);
    expect(deleteConfirmationMatches("Sagada Wave", "sagada wave")).toBe(false);
    expect(deleteConfirmationMatches("", "")).toBe(false);
  });

  it("only submits with a clear check, matching name and a reason", () => {
    const base = { shopName: "Shop A", typed: "Shop A", reason: "closing", busy: false };
    expect(canSubmitShopDeletion({ ...base, check: clear })).toBe(true);
    expect(canSubmitShopDeletion({ ...base, check: held })).toBe(false);
    expect(canSubmitShopDeletion({ ...base, check: clear, reason: " " })).toBe(false);
    expect(canSubmitShopDeletion({ ...base, check: clear, busy: true })).toBe(false);
    expect(canSubmitShopDeletion({ ...base, check: null })).toBe(false);
  });
});

const req = (over: Partial<PendingPaymentShop>): PendingPaymentShop => ({
  request_id: "r1",
  ecosystem_id: "e1",
  plan_name: "Starter",
  payment_reference: "104116",
  created_at: "2026-01-01T00:00:00Z",
  status: "pending",
  payment_override: false,
  payment_override_reason: null,
  payment_override_at: null,
  ...over,
});

describe("payment override notes", () => {
  it("keeps only the newest request per shop", () => {
    const map = latestPerShop([
      req({ request_id: "old", created_at: "2026-01-01T00:00:00Z" }),
      req({ request_id: "new", created_at: "2026-02-01T00:00:00Z" }),
    ]);
    expect(map["e1"]?.request_id).toBe("new");
  });

  it("notes pending payments and completed overrides", () => {
    expect(paymentNote(req({}))).toContain("override available");
    expect(
      paymentNote(req({ payment_override: true, payment_override_reason: "bank transfer" })),
    ).toContain("bank transfer");
    expect(paymentNote(req({ status: "approved" }))).toBeNull();
  });
});

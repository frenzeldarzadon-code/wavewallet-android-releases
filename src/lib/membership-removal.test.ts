import { describe, expect, it } from "vitest";
import { canRemoveKeptMember, reviewState } from "@/lib/membership-applications";

describe("removing a kept member from one shop", () => {
  it("allows removal only on an exactly zero shop balance", () => {
    expect(canRemoveKeptMember(0)).toBe(true);
    expect(canRemoveKeptMember(0.01)).toBe(false);
    expect(canRemoveKeptMember(125)).toBe(false);
  });

  it("blocks removal while the balance is still unknown", () => {
    expect(canRemoveKeptMember(undefined)).toBe(false);
  });

  it("offers the action only for kept members", () => {
    expect(reviewState({ status: "approved", decision_reason: null })).toBe("kept");
    expect(reviewState({ status: "rejected", decision_reason: null })).toBe("removed");
    expect(reviewState({ status: "pending", decision_reason: null })).toBe("active");
  });
});

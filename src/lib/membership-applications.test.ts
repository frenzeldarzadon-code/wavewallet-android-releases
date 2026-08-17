import { describe, expect, it } from "vitest";
import {
  applicationTone,
  heldForManualReview,
  reviewState,
  reviewTone,
  canReviewApplication,
  validateSignupDraft,
  type SignupDraft,
} from "@/lib/membership-applications";

const ECO_A = "11111111-1111-1111-1111-111111111111";
const ECO_B = "22222222-2222-2222-2222-222222222222";

const draft = (over: Partial<SignupDraft> = {}): SignupDraft => ({
  slug: "shop-a",
  name: "Juan Dela Cruz",
  email: "juan@example.com",
  phone: "09170000000",
  password: "supersecret",
  confirm: "supersecret",
  ...over,
});

describe("signup validation", () => {
  it("accepts a complete draft for a listed ecosystem", () => {
    expect(validateSignupDraft(draft(), ["shop-a", "shop-b"])).toBeNull();
  });

  it("rejects an ecosystem that is not publicly listed", () => {
    expect(validateSignupDraft(draft({ slug: "secret-shop" }), ["shop-a"])).toMatch(/ecosystem/i);
    expect(validateSignupDraft(draft({ slug: "" }), ["shop-a"])).toMatch(/ecosystem/i);
  });

  it("requires name, email, phone and a confirmed 8+ character password", () => {
    expect(validateSignupDraft(draft({ name: "  " }), ["shop-a"])).toMatch(/name/i);
    expect(validateSignupDraft(draft({ email: "nope" }), ["shop-a"])).toMatch(/email/i);
    expect(validateSignupDraft(draft({ phone: "12" }), ["shop-a"])).toMatch(/mobile/i);
    expect(validateSignupDraft(draft({ password: "short", confirm: "short" }), ["shop-a"])).toMatch(
      /8 characters/i,
    );
    expect(validateSignupDraft(draft({ confirm: "different1" }), ["shop-a"])).toMatch(/match/i);
  });
});

describe("approval authorization", () => {
  it("lets a super admin approve any ecosystem", () => {
    expect(canReviewApplication({ role: "super_admin", ecosystemId: null }, ECO_B)).toBe(true);
  });

  it("lets admin, reseller and subreseller approve their own ecosystem only", () => {
    for (const role of ["admin", "reseller", "subreseller"]) {
      expect(canReviewApplication({ role, ecosystemId: ECO_A }, ECO_A)).toBe(true);
      expect(canReviewApplication({ role, ecosystemId: ECO_A }, ECO_B)).toBe(false);
    }
  });

  it("never lets a customer approve", () => {
    expect(canReviewApplication({ role: "customer", ecosystemId: ECO_A }, ECO_A)).toBe(false);
  });

  it("denies approvers with no ecosystem", () => {
    expect(canReviewApplication({ role: "admin", ecosystemId: null }, ECO_A)).toBe(false);
  });
});

describe("status tone", () => {
  it("maps decision states to the blue/green/red theme", () => {
    expect(applicationTone("pending")).toBe("warning");
    expect(applicationTone("approved")).toBe("success");
    expect(applicationTone("rejected")).toBe("danger");
  });
});

describe("post-join member review", () => {
  it("treats an undecided automatic join as an active member", () => {
    expect(reviewState({ status: "pending", decision_reason: "Auto-approved — awaiting admin member review" })).toBe("active");
    expect(reviewTone("active")).toBe("success");
  });

  it("flags a join the database held back because of existing coins", () => {
    const reason = "Manual review required because this member already has coins in this shop";
    expect(heldForManualReview(reason)).toBe(true);
    expect(reviewState({ status: "pending", decision_reason: reason })).toBe("manual_review");
    expect(reviewTone("manual_review")).toBe("warning");
  });

  it("maps decided rows to kept and removed", () => {
    expect(reviewState({ status: "approved", decision_reason: null })).toBe("kept");
    expect(reviewState({ status: "rejected", decision_reason: null })).toBe("removed");
    expect(reviewTone("removed")).toBe("danger");
  });
});

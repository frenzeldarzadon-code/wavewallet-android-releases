import { describe, expect, it } from "vitest";
import {
  candidateIdentityLine,
  daysLeft,
  inviteBlockedReason,
  invitationTone,
  isExpired,
  type UniverseCandidate,
} from "@/lib/shop-invitations";

const base: UniverseCandidate = {
  user_id: "u1",
  full_name: "Ana Cruz",
  handle: "ana",
  avatar_path: null,
  masked_email: "an***@mail.com",
  phone: "0917 000 0000",
  already_member: false,
  pending_invitation: false,
  pending_application: false,
};

describe("inviteBlockedReason", () => {
  it("allows a plain Universe member", () => {
    expect(inviteBlockedReason(base, "operator")).toBeNull();
  });

  it("blocks an existing member of this shop", () => {
    expect(inviteBlockedReason({ ...base, already_member: true })).toMatch(/already a member/i);
  });

  it("blocks a duplicate while an invitation is pending", () => {
    expect(inviteBlockedReason({ ...base, pending_invitation: true })).toMatch(/pending/i);
  });

  it("blocks when the member already applied", () => {
    expect(inviteBlockedReason({ ...base, pending_application: true })).toMatch(/applied/i);
  });

  it("blocks inviting yourself", () => {
    expect(inviteBlockedReason(base, "u1")).toMatch(/own account/i);
  });

  it("is shop-specific: membership elsewhere does not block", () => {
    // The candidate row is computed per shop, so a member of another shop
    // arrives with already_member false and stays invitable.
    expect(inviteBlockedReason({ ...base, already_member: false })).toBeNull();
  });
});

describe("candidateIdentityLine", () => {
  it("joins the visible identifiers", () => {
    expect(candidateIdentityLine(base)).toBe("@ana · an***@mail.com · 0917 000 0000");
  });

  it("omits missing identifiers", () => {
    expect(candidateIdentityLine({ ...base, handle: null, phone: null })).toBe("an***@mail.com");
  });
});

describe("expiry helpers", () => {
  const now = new Date("2026-01-10T00:00:00Z");

  it("flags an overdue pending invitation", () => {
    expect(isExpired({ status: "pending", expires_at: "2026-01-09T00:00:00Z" }, now)).toBe(true);
  });

  it("leaves a live invitation alone", () => {
    expect(isExpired({ status: "pending", expires_at: "2026-01-20T00:00:00Z" }, now)).toBe(false);
  });

  it("never expires an answered invitation", () => {
    expect(isExpired({ status: "accepted", expires_at: "2020-01-01T00:00:00Z" }, now)).toBe(false);
  });

  it("counts whole days remaining", () => {
    expect(daysLeft("2026-01-13T00:00:00Z", now)).toBe(3);
    expect(daysLeft("2026-01-01T00:00:00Z", now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });
});

describe("invitationTone", () => {
  it("maps each status to a distinct tone", () => {
    expect(invitationTone("accepted")).toBe("success");
    expect(invitationTone("pending")).toBe("warning");
    expect(invitationTone("declined")).toBe("danger");
    expect(invitationTone("cancelled")).toBe("danger");
    expect(invitationTone("expired")).toBe("muted");
  });
});

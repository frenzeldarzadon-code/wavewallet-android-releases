import { describe, expect, it } from "vitest";
import {
  actionableInvitations,
  dedupeByShop,
  inboxPendingCount,
  isAlreadyMember,
  applicationsAwaitingMember,
  pendingApplications,
  redundantInvitations,
  sortByNewest,
} from "@/lib/member-inbox";
import type { Membership, MyApplicationRow } from "@/lib/memberships";
import type { MyInvitation } from "@/lib/shop-invitations";

const now = new Date("2026-08-14T00:00:00Z");

const inv = (over: Partial<MyInvitation> = {}): MyInvitation => ({
  id: "i1",
  ecosystem_id: "shop-a",
  ecosystem_name: "Shop A",
  inviter_name: "Ana Cruz",
  inviter_role: "admin",
  message: null,
  status: "pending",
  expires_at: "2026-08-20T00:00:00Z",
  created_at: "2026-08-10T00:00:00Z",
  ...over,
});

const membership = (over: Partial<Membership> = {}): Membership => ({
  ecosystemId: "shop-a",
  ecosystemName: "Shop A",
  ecosystemSlug: "shop-a",
  role: "customer",
  membershipState: "active",
  status: "active",
  isActive: true,
  ...over,
});

const app = (over: Partial<MyApplicationRow> = {}): MyApplicationRow => ({
  ecosystemId: "shop-b",
  ecosystemName: "Shop B",
  status: "pending",
  decisionReason: null,
  createdAt: "2026-08-09T00:00:00Z",
  ...over,
});

describe("invite delivery and actionability", () => {
  it("keeps a fresh pending invitation actionable", () => {
    expect(actionableInvitations([inv()], [], now)).toHaveLength(1);
  });

  it("drops expired invitations", () => {
    expect(
      actionableInvitations([inv({ expires_at: "2026-08-01T00:00:00Z" })], [], now),
    ).toHaveLength(0);
  });

  it("drops answered invitations", () => {
    expect(actionableInvitations([inv({ status: "accepted" })], [], now)).toHaveLength(0);
    expect(actionableInvitations([inv({ status: "declined" })], [], now)).toHaveLength(0);
  });

  it("treats an invitation to a shop already joined as redundant", () => {
    const mems = [membership()];
    expect(actionableInvitations([inv()], mems, now)).toHaveLength(0);
    expect(redundantInvitations([inv()], mems)).toHaveLength(1);
    expect(isAlreadyMember(mems, "shop-a")).toBe(true);
    expect(isAlreadyMember(mems, "shop-z")).toBe(false);
  });

  it("keeps invitations from other shops isolated", () => {
    const rows = actionableInvitations(
      [inv(), inv({ id: "i2", ecosystem_id: "shop-b", ecosystem_name: "Shop B" })],
      [membership()],
      now,
    );
    expect(rows.map((r) => r.ecosystem_id)).toEqual(["shop-b"]);
  });

  it("shows only one invitation per shop", () => {
    const rows = dedupeByShop([
      inv({ id: "old", created_at: "2026-08-01T00:00:00Z" }),
      inv({ id: "new", created_at: "2026-08-12T00:00:00Z" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("new");
  });

  it("sorts newest first", () => {
    const rows = sortByNewest([
      inv({ id: "a", created_at: "2026-08-01T00:00:00Z" }),
      inv({ id: "b", created_at: "2026-08-13T00:00:00Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("applications section", () => {
  it("counts only undecided applications as pending", () => {
    const rows = [app(), app({ ecosystemId: "shop-c", status: "approved" }), app({ ecosystemId: "shop-d", status: "rejected" })];
    expect(pendingApplications(rows)).toHaveLength(1);
  });

  it("separates joins held for manual review from automatic joins", () => {
    const rows = [
      app(),
      app({ ecosystemId: "shop-c", decisionReason: "Manual review required — existing coins" }),
    ];
    expect(applicationsAwaitingMember(rows).map((r) => r.ecosystemId)).toEqual(["shop-c"]);
  });
});

describe("badge count", () => {
  it("counts manual-review joins and actionable invitations, never automatic joins", () => {
    const held = app({ decisionReason: "Manual review required because of existing coins" });
    expect(
      inboxPendingCount({ applications: [held], invitations: [inv()], memberships: [] }, now),
    ).toBe(2);
    // An ordinary automatic join is already active — no badge.
    expect(
      inboxPendingCount({ applications: [app()], invitations: [inv()], memberships: [] }, now),
    ).toBe(1);
  });

  it("is zero when nothing needs attention", () => {
    expect(
      inboxPendingCount(
        {
          applications: [app({ status: "approved" })],
          invitations: [inv()],
          memberships: [membership()],
        },
        now,
      ),
    ).toBe(0);
  });
});

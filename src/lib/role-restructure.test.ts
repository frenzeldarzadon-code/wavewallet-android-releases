import { describe, expect, it } from "vitest";
import {
  evaluateRestructure,
  isRestructurable,
  oppositeRole,
  type RestructureCheck,
} from "@/lib/role-restructure";

const base = (over: Partial<RestructureCheck> = {}) =>
  ({
    user_id: "u1",
    current_role: "reseller",
    children: [],
    parent_reseller_name: null,
    ...over,
  }) as Pick<
    RestructureCheck,
    "user_id" | "current_role" | "children" | "parent_reseller_name"
  >;

const reason = "Territory realignment";

describe("role restructuring rules", () => {
  it("demotes a reseller with no children when a parent is chosen", () => {
    const v = evaluateRestructure(base(), {
      newRole: "subreseller",
      parentResellerId: "r2",
      reason,
    });
    expect(v.ok).toBe(true);
    expect(v.blockers).toEqual([]);
  });

  it("blocks demotion until every child subreseller is reassigned", () => {
    const check = base({
      children: [
        { id: "c1", name: "Child One", email: "c1@x.io" },
        { id: "c2", name: "Child Two", email: "c2@x.io" },
      ],
    });
    const blocked = evaluateRestructure(check, {
      newRole: "subreseller",
      parentResellerId: "r2",
      childReassignments: { c1: "r2" },
      reason,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blockers.join(" ")).toContain("Child Two");

    const okPlan = evaluateRestructure(check, {
      newRole: "subreseller",
      parentResellerId: "r2",
      childReassignments: { c1: "r2", c2: "r3" },
      reason,
    });
    expect(okPlan.ok).toBe(true);
    expect(okPlan.notes.join(" ")).toContain("2 subresellers will be moved");
  });

  it("never lets a member become their own parent or a child's parent", () => {
    const v = evaluateRestructure(base({ children: [{ id: "c1", name: "C", email: "c@x.io" }] }), {
      newRole: "subreseller",
      parentResellerId: "u1",
      childReassignments: { c1: "c1" },
      reason,
    });
    expect(v.ok).toBe(false);
    expect(v.blockers).toContain("A member cannot be their own parent reseller.");
    expect(v.blockers.join(" ")).toContain("Choose a different reseller for C");
  });

  it("promotes a subreseller and drops the parent link going forward", () => {
    const v = evaluateRestructure(
      base({ current_role: "subreseller", parent_reseller_name: "Ana Reseller" }),
      { newRole: "reseller", reason },
    );
    expect(v.ok).toBe(true);
    expect(v.notes.join(" ")).toContain("Past commissions stay attributed to them");
    expect(v.notes.join(" ")).toContain("no upline");
  });

  it("always states that the financial impact is zero", () => {
    const v = evaluateRestructure(base({ current_role: "subreseller" }), {
      newRole: "reseller",
      reason,
    });
    expect(v.notes.join(" ")).toContain("financial impact: zero");
  });

  it("requires a written reason", () => {
    const v = evaluateRestructure(base({ current_role: "subreseller" }), {
      newRole: "reseller",
      reason: "  ",
    });
    expect(v.ok).toBe(false);
    expect(v.blockers.join(" ")).toContain("reason");
  });

  it("rejects a no-op role change", () => {
    const v = evaluateRestructure(base(), { newRole: "reseller", reason });
    expect(v.ok).toBe(false);
    expect(v.blockers).toContain("This member already has that role.");
  });

  it("refuses customers, admins and super admins", () => {
    for (const role of ["customer", "admin", "super_admin"] as const) {
      const v = evaluateRestructure(base({ current_role: role }), {
        newRole: "reseller",
        reason,
      });
      expect(v.ok).toBe(false);
      expect(v.blockers[0]).toContain("Only resellers and subresellers");
    }
    expect(isRestructurable("customer")).toBe(false);
    expect(isRestructurable("reseller")).toBe(true);
    expect(oppositeRole("reseller")).toBe("subreseller");
    expect(oppositeRole("subreseller")).toBe("reseller");
  });
});

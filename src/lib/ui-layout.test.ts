import { describe, expect, it } from "vitest";
import { navForRole } from "@/lib/navigation";
import {
  DEV_MODE_ROLES,
  applyBottomNavLayout,
  applyNavLayout,
  hiddenSlots,
  isTabHidden,
  moveSlotToTab,
  normalizeLayout,
  nudgeSlot,
  nudgeTab,
  originPresentation,
  resetLayout,
  resolveSlots,
  setSlotHidden,
  setTabHidden,
  slotsForRole,
  slotsMovedInto,
  slotsOnTab,
  tabsForRole,
  type LayoutPayload,
} from "@/lib/ui-layout";
import type { Role } from "@/lib/wavewallet";

const paths = (role: Role, layout: LayoutPayload) =>
  applyNavLayout(navForRole(role), layout)
    .flatMap((g) => g.items)
    .map((i) => String(i.to));

describe("developer mode — role scope", () => {
  it("covers every dashboard level", () => {
    expect(DEV_MODE_ROLES).toEqual([
      "customer",
      "reseller",
      "subreseller",
      "admin",
      "super_admin",
    ]);
  });

  it("keeps a configuration per role, never per account", () => {
    // Hiding a customer tab must not touch any other role's navigation.
    const layout = setTabHidden({}, "/app/rewards", true);
    expect(paths("customer", layout)).not.toContain("/app/rewards");
    expect(paths("reseller", {})).toContain("/reseller/rewards");
    // The payload holds no account identifier at all.
    expect(JSON.stringify(layout)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("gives reseller and subreseller independent slot sets", () => {
    expect(slotsForRole("reseller").map((s) => s.id)).toContain("reseller.dashboard.summary");
    expect(slotsForRole("subreseller").map((s) => s.id)).toContain("subreseller.dashboard.summary");
  });
});

describe("tabs", () => {
  it("hides and restores a tab without touching the route list", () => {
    const shipped = tabsForRole("admin").map((t) => String(t.to));
    let layout = setTabHidden({}, "/admin/reports", true);
    expect(isTabHidden(layout, "/admin/reports")).toBe(true);
    expect(paths("admin", layout)).not.toContain("/admin/reports");
    // The route itself is still part of the application.
    expect(shipped).toContain("/admin/reports");
    layout = setTabHidden(layout, "/admin/reports", false);
    expect(paths("admin", layout)).toContain("/admin/reports");
  });

  it("reorders tabs and applies the same order to the bottom bar", () => {
    const before = paths("customer", {});
    const target = before[2]!;
    const layout = nudgeTab({}, "customer", target, -1);
    const after = paths("customer", layout);
    expect(after.indexOf(target)).toBe(before.indexOf(target) - 1);
    expect(after).toHaveLength(before.length);

    const bottom = applyBottomNavLayout(
      [
        { to: "/app", label: "Wallet", icon: () => null },
        { to: "/app/shop", label: "Shop", icon: () => null },
      ],
      setTabHidden({}, "/app/shop", true),
    );
    expect(bottom.map((i) => String(i.to))).toEqual(["/app"]);
  });
});

describe("content blocks", () => {
  it("hides and restores a component, listing it while hidden", () => {
    let layout = setSlotHidden({}, "admin.dashboard.stats", true);
    expect(hiddenSlots("admin", layout).map((s) => s.definition.id)).toEqual([
      "admin.dashboard.stats",
    ]);
    expect(slotsOnTab("admin", "/admin", layout).map((s) => s.definition.id)).not.toContain(
      "admin.dashboard.stats",
    );
    layout = setSlotHidden(layout, "admin.dashboard.stats", false);
    expect(hiddenSlots("admin", layout)).toHaveLength(0);
  });

  it("conceals rather than unmounts a hidden block, so it keeps working", () => {
    const layout = setSlotHidden({}, "admin.dashboard.stats", true);
    // "concealed" means: still rendered/mounted, simply not shown.
    expect(originPresentation("admin.dashboard.stats", layout)).toBe("concealed");
    expect(originPresentation("admin.dashboard.activity", layout)).toBe("visible");
  });

  it("reorders blocks inside a tab", () => {
    const ids = resolveSlots("admin", {}).map((s) => s.definition.id);
    const second = ids[1]!;
    const layout = nudgeSlot({}, "admin", second, -1);
    expect(resolveSlots("admin", layout).map((s) => s.definition.id)[0]).toBe(second);
  });

  it("moves a movable block to another tab and back", () => {
    let layout = moveSlotToTab({}, "customer.wallet.center", "/app/money");
    expect(slotsMovedInto("customer", "/app/money", layout).map((s) => s.definition.id)).toEqual([
      "customer.wallet.center",
    ]);
    // At its origin the block is concealed but still mounted.
    expect(originPresentation("customer.wallet.center", layout)).toBe("concealed");
    layout = moveSlotToTab(layout, "customer.wallet.center", "/app");
    expect(slotsMovedInto("customer", "/app/money", layout)).toHaveLength(0);
    expect(originPresentation("customer.wallet.center", layout)).toBe("visible");
  });

  it("refuses to move a block that is not movable", () => {
    const layout = moveSlotToTab({}, "admin.dashboard.activity", "/admin/reports");
    expect(layout).toEqual({});
  });

  it("resets a role back to the shipped layout", () => {
    const layout = setSlotHidden(setTabHidden({}, "/admin/reports", true), "admin.dashboard.stats", true);
    expect(paths("admin", resetLayout())).toEqual(paths("admin", {}));
    expect(hiddenSlots("admin", resetLayout())).toHaveLength(0);
    expect(hiddenSlots("admin", layout)).toHaveLength(1);
  });
});

describe("persistence shape", () => {
  it("survives a database round-trip", () => {
    const layout = moveSlotToTab(
      setSlotHidden(setTabHidden({}, "/admin/reports", true), "admin.dashboard.stats", true),
      "admin.dashboard.earnings",
      "/admin/reports",
    );
    const roundTripped = normalizeLayout(JSON.parse(JSON.stringify(layout)));
    expect(roundTripped).toEqual(layout);
    expect(paths("admin", roundTripped)).not.toContain("/admin/reports");
  });

  it("ignores malformed stored values instead of breaking the interface", () => {
    expect(normalizeLayout(null)).toEqual({});
    expect(normalizeLayout("nonsense")).toEqual({});
    expect(normalizeLayout({ tabs: { hidden: ["/app"] } })).toEqual({
      tabs: { hidden: ["/app"] },
    });
    expect(paths("customer", normalizeLayout({ tabs: "broken" }))).toEqual(paths("customer", {}));
  });
});

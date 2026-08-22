import { describe, expect, it } from "vitest";
import { navForRole } from "@/lib/navigation";
import {
  DEV_MODE_ROLES,
  SLOT_REGISTRY,
  applyBottomNavLayout,
  applyNavLayout,
  bottomNavForRole,
  hiddenSlots,
  isSlotHidden,
  isTabHidden,
  normalizeLayout,
  nudgeBottomTab,
  nudgeTab,
  originPresentation,
  resetLayout,
  resolveSlots,
  setSlotHidden,
  setTabHidden,
  slotGroupsForRole,
  slotIdFor,
  slotsForRole,
  tabsForRole,
  type LayoutPayload,
} from "@/lib/ui-layout";
import type { Role } from "@/lib/wavewallet";

const paths = (role: Role, layout: LayoutPayload) =>
  applyNavLayout(navForRole(role), layout)
    .flatMap((g) => g.items)
    .map((i) => String(i.to));

const bottomPaths = (role: Role, layout: LayoutPayload) =>
  applyBottomNavLayout(bottomNavForRole(role), layout).map((i) => String(i.to));

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
    const layout = setTabHidden({}, "/app/rewards", true);
    expect(paths("customer", layout)).not.toContain("/app/rewards");
    expect(paths("reseller", {})).toContain("/reseller/rewards");
    expect(JSON.stringify(layout)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("gives every role its own registry entries", () => {
    for (const role of DEV_MODE_ROLES) {
      const slots = slotsForRole(role);
      expect(slots.length).toBeGreaterThan(10);
      expect(slots.every((s) => s.id.startsWith(`${slotIdFor(role, "")}`.slice(0, -1)))).toBe(true);
    }
    expect(slotsForRole("reseller").map((s) => s.id)).toContain("reseller.dashboard.summary");
    expect(slotsForRole("subreseller").map((s) => s.id)).toContain("subreseller.dashboard.summary");
  });

  it("registers a substantial, unique set of configurable content", () => {
    expect(SLOT_REGISTRY.length).toBeGreaterThan(200);
    expect(new Set(SLOT_REGISTRY.map((s) => s.id)).size).toBe(SLOT_REGISTRY.length);
  });

  it("groups content by screen for the manager list", () => {
    const groups = slotGroupsForRole("admin");
    expect(groups.length).toBeGreaterThan(3);
    expect(groups.flatMap((g) => g.slots)).toHaveLength(slotsForRole("admin").length);
  });
});

describe("navigation", () => {
  it("hides and restores a navigation entry without touching the route list", () => {
    const shipped = tabsForRole("admin").map((t) => String(t.to));
    let layout = setTabHidden({}, "/admin/reports", true);
    expect(isTabHidden(layout, "/admin/reports")).toBe(true);
    expect(paths("admin", layout)).not.toContain("/admin/reports");
    expect(shipped).toContain("/admin/reports");
    layout = setTabHidden(layout, "/admin/reports", false);
    expect(paths("admin", layout)).toContain("/admin/reports");
  });

  it("reorders side navigation without moving the bottom bar", () => {
    const before = paths("customer", {});
    const target = before[2]!;
    const layout = nudgeTab({}, "customer", target, -1);
    expect(paths("customer", layout).indexOf(target)).toBe(before.indexOf(target) - 1);
    expect(paths("customer", layout)).toHaveLength(before.length);
    expect(bottomPaths("customer", layout)).toEqual(bottomPaths("customer", {}));
  });

  it("reorders bottom navigation without moving the side navigation", () => {
    const before = bottomPaths("customer", {});
    const target = before[1]!;
    const layout = nudgeBottomTab({}, "customer", target, -1);
    expect(bottomPaths("customer", layout).indexOf(target)).toBe(before.indexOf(target) - 1);
    expect(paths("customer", layout)).toEqual(paths("customer", {}));
  });

  it("keeps each navigation group closed: an order only affects its own group", () => {
    const layout = nudgeBottomTab({}, "admin", bottomPaths("admin", {})[1]!, -1);
    expect(new Set(bottomPaths("admin", layout))).toEqual(new Set(bottomPaths("admin", {})));
  });

  it("hides an entry from both navigations at once", () => {
    const layout = setTabHidden({}, "/app/shop", true);
    expect(paths("customer", layout)).not.toContain("/app/shop");
    expect(bottomPaths("customer", layout)).not.toContain("/app/shop");
  });
});

describe("content blocks", () => {
  it("hides and restores a section, listing it while hidden", () => {
    let layout = setSlotHidden({}, "admin.dashboard.stats", true);
    expect(isSlotHidden(layout, "admin.dashboard.stats")).toBe(true);
    expect(hiddenSlots("admin", layout).map((s) => s.definition.id)).toEqual([
      "admin.dashboard.stats",
    ]);
    layout = setSlotHidden(layout, "admin.dashboard.stats", false);
    expect(hiddenSlots("admin", layout)).toHaveLength(0);
  });

  it("conceals rather than unmounts a hidden block, so it keeps working", () => {
    const layout = setSlotHidden({}, "admin.dashboard.stats", true);
    expect(originPresentation("admin.dashboard.stats", layout)).toBe("concealed");
    expect(originPresentation("admin.dashboard.activity", layout)).toBe("visible");
  });

  it("hides content for one role only", () => {
    const layout = setSlotHidden({}, "admin.dashboard.stats", true);
    expect(hiddenSlots("customer", layout)).toHaveLength(0);
    expect(resolveSlots("admin", layout).filter((s) => s.hidden)).toHaveLength(1);
  });

  it("resets a role back to the shipped layout", () => {
    const layout = setSlotHidden(
      setTabHidden({}, "/admin/reports", true),
      "admin.dashboard.stats",
      true,
    );
    expect(paths("admin", resetLayout())).toEqual(paths("admin", {}));
    expect(hiddenSlots("admin", resetLayout())).toHaveLength(0);
    expect(hiddenSlots("admin", layout)).toHaveLength(1);
  });
});

describe("persistence shape", () => {
  it("survives a database round-trip", () => {
    const layout = nudgeBottomTab(
      setSlotHidden(setTabHidden({}, "/admin/reports", true), "admin.dashboard.stats", true),
      "admin",
      bottomPaths("admin", {})[1]!,
      -1,
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

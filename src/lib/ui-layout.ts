/**
 * Developer Mode — role-level UI layout configuration.
 *
 * Pure data + pure functions. A layout says, for one ROLE (never one account),
 * which navigation tabs and which in-page content blocks are hidden, in what
 * order they appear, and (for movable blocks) which tab they live on.
 *
 * Everything here is presentation only. Hiding a tab or a block never removes a
 * route, a query, a calculation or a permission — the database still authorizes
 * every read and write, and hidden blocks stay mounted so their background work
 * keeps running.
 */
import { navForRole, type Nav, type NavItem } from "@/lib/navigation";
import type { Role } from "@/lib/wavewallet";

export const DEV_MODE_ROLES: Role[] = [
  "customer",
  "reseller",
  "subreseller",
  "admin",
  "super_admin",
];

export const roleTitle = (role: Role): string =>
  role === "super_admin"
    ? "Super Admin"
    : role === "admin"
      ? "Admin"
      : role === "reseller"
        ? "Reseller"
        : role === "subreseller"
          ? "Subreseller"
          : "Customer";

/** Stored per-slot overrides. All fields optional; absent means "default". */
export interface SlotOverride {
  hidden?: boolean;
  /** Destination tab path when the block was moved. */
  tab?: string;
  /** Sort key inside its tab; lower comes first. */
  order?: number;
}

export interface LayoutPayload {
  tabs?: {
    /** Explicit tab order (paths). Unlisted tabs keep their natural order after listed ones. */
    order?: string[];
    /** Tab paths hidden from navigation (route + data keep working). */
    hidden?: string[];
  };
  slots?: Record<string, SlotOverride>;
}

export type LayoutMap = Partial<Record<Role, LayoutPayload>>;

export const EMPTY_LAYOUT: LayoutPayload = {};

/** A configurable in-page content block. Identified by a stable id, never by label. */
export interface SlotDefinition {
  id: string;
  role: Role;
  label: string;
  /** Tab (route path) the block belongs to in the shipped product. */
  defaultTab: string;
  /** Movable blocks can be rendered on another tab; others are hide/reorder only. */
  movable?: boolean;
  description?: string;
}

/**
 * Registry of configurable content. Ids are stable strings written into the
 * database — never rename one without a migration.
 */
export const SLOT_REGISTRY: SlotDefinition[] = [
  // Customer
  {
    id: "customer.wallet.center",
    role: "customer",
    label: "Wallet Center",
    defaultTab: "/app",
    movable: true,
    description: "Balances, transfers and history panel.",
  },
  // Reseller / Subreseller share one workspace, configured per role.
  {
    id: "reseller.dashboard.summary",
    role: "reseller",
    label: "Shop summary",
    defaultTab: "/reseller",
  },
  {
    id: "reseller.dashboard.wallet-activity",
    role: "reseller",
    label: "Wallet activity",
    defaultTab: "/reseller",
  },
  {
    id: "reseller.dashboard.downlines",
    role: "reseller",
    label: "Downlines snapshot",
    defaultTab: "/reseller",
  },
  {
    id: "subreseller.dashboard.summary",
    role: "subreseller",
    label: "Shop summary",
    defaultTab: "/reseller",
  },
  {
    id: "subreseller.dashboard.wallet-activity",
    role: "subreseller",
    label: "Wallet activity",
    defaultTab: "/reseller",
  },
  {
    id: "subreseller.dashboard.downlines",
    role: "subreseller",
    label: "Downlines snapshot",
    defaultTab: "/reseller",
  },
  // Admin
  { id: "admin.dashboard.demo", role: "admin", label: "Demo shop banner", defaultTab: "/admin" },
  { id: "admin.dashboard.stats", role: "admin", label: "Shop figures", defaultTab: "/admin" },
  {
    id: "admin.dashboard.earnings",
    role: "admin",
    label: "Shop earnings panel",
    defaultTab: "/admin",
    movable: true,
  },
  { id: "admin.dashboard.sales", role: "admin", label: "Voucher sales", defaultTab: "/admin" },
  { id: "admin.dashboard.activity", role: "admin", label: "Recent activity", defaultTab: "/admin" },
  {
    id: "admin.dashboard.signup-link",
    role: "admin",
    label: "Customer signup link card",
    defaultTab: "/admin",
  },
  // Super Admin
  { id: "super.overview.stats", role: "super_admin", label: "Platform figures", defaultTab: "/super" },
  { id: "super.overview.shops", role: "super_admin", label: "Shops list", defaultTab: "/super" },
];

export const slotsForRole = (role: Role): SlotDefinition[] =>
  SLOT_REGISTRY.filter((s) => s.role === role);

export const findSlot = (id: string): SlotDefinition | undefined =>
  SLOT_REGISTRY.find((s) => s.id === id);

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

/** Every tab (destination) a role has, in shipped order. */
export function tabsForRole(role: Role): NavItem[] {
  return navForRole(role).flatMap((g) => g.items);
}

export const tabLabel = (role: Role, path: string): string =>
  tabsForRole(role).find((t) => String(t.to) === path)?.label ?? path;

const orderIndex = (order: string[] | undefined, path: string) => {
  const i = order?.indexOf(path) ?? -1;
  return i === -1 ? Number.POSITIVE_INFINITY : i;
};

/**
 * Applies a role layout to a sidebar: hidden tabs are dropped from navigation
 * (the route itself is untouched) and the remaining ones follow the saved order.
 */
export function applyNavLayout(nav: Nav, layout: LayoutPayload | undefined): Nav {
  const hidden = new Set(layout?.tabs?.hidden ?? []);
  const order = layout?.tabs?.order;
  return nav
    .map((group) => ({
      ...group,
      items: group.items
        .filter((i) => !hidden.has(String(i.to)))
        .map((item, index) => ({ item, index }))
        .sort(
          (a, b) =>
            orderIndex(order, String(a.item.to)) - orderIndex(order, String(b.item.to)) ||
            a.index - b.index,
        )
        .map(({ item }) => item),
    }))
    .filter((g) => g.items.length > 0);
}

/** Applies the same rules to the mobile bottom bar. */
export function applyBottomNavLayout(
  items: NavItem[],
  layout: LayoutPayload | undefined,
): NavItem[] {
  const hidden = new Set(layout?.tabs?.hidden ?? []);
  const order = layout?.tabs?.order;
  return items
    .filter((i) => !hidden.has(String(i.to)))
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        orderIndex(order, String(a.item.to)) - orderIndex(order, String(b.item.to)) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

export const isTabHidden = (layout: LayoutPayload | undefined, path: string): boolean =>
  (layout?.tabs?.hidden ?? []).includes(path);

/* ------------------------------------------------------------------ */
/* Slot resolution                                                     */
/* ------------------------------------------------------------------ */

export interface ResolvedSlot {
  definition: SlotDefinition;
  hidden: boolean;
  /** Tab the block is presented on right now. */
  tab: string;
  /** Whether it was moved away from its shipped tab. */
  moved: boolean;
  order: number;
}

export function resolveSlot(
  definition: SlotDefinition,
  layout: LayoutPayload | undefined,
  fallbackOrder = 0,
): ResolvedSlot {
  const o = layout?.slots?.[definition.id] ?? {};
  const tab = (definition.movable && o.tab) || definition.defaultTab;
  return {
    definition,
    hidden: o.hidden === true,
    tab,
    moved: tab !== definition.defaultTab,
    order: typeof o.order === "number" ? o.order : fallbackOrder,
  };
}

/** Every slot of a role, resolved and ordered as configured. */
export function resolveSlots(role: Role, layout: LayoutPayload | undefined): ResolvedSlot[] {
  return slotsForRole(role)
    .map((d, i) => resolveSlot(d, layout, i))
    .sort((a, b) => a.order - b.order);
}

/** Visible, ordered slots presented on one tab. */
export function slotsOnTab(
  role: Role,
  tab: string,
  layout: LayoutPayload | undefined,
): ResolvedSlot[] {
  return resolveSlots(role, layout).filter((s) => s.tab === tab && !s.hidden);
}

/** Slots moved INTO a tab from elsewhere (rendered by that tab's host). */
export function slotsMovedInto(
  role: Role,
  tab: string,
  layout: LayoutPayload | undefined,
): ResolvedSlot[] {
  return slotsOnTab(role, tab, layout).filter((s) => s.moved);
}

export function hiddenSlots(role: Role, layout: LayoutPayload | undefined): ResolvedSlot[] {
  return resolveSlots(role, layout).filter((s) => s.hidden);
}

/**
 * How one slot should render at its ORIGIN location (the page that owns the
 * markup). "visible" renders normally; "concealed" keeps the block mounted but
 * out of view — hidden or moved blocks keep processing data in the background.
 */
export function originPresentation(
  slotId: string,
  layout: LayoutPayload | undefined,
): "visible" | "concealed" {
  const def = findSlot(slotId);
  if (!def) return "visible";
  const r = resolveSlot(def, layout);
  return r.hidden || r.moved ? "concealed" : "visible";
}

/* ------------------------------------------------------------------ */
/* Mutations — pure; every one returns a NEW payload                   */
/* ------------------------------------------------------------------ */

const withSlot = (layout: LayoutPayload, id: string, patch: SlotOverride): LayoutPayload => ({
  ...layout,
  slots: { ...(layout.slots ?? {}), [id]: { ...(layout.slots?.[id] ?? {}), ...patch } },
});

export const setSlotHidden = (layout: LayoutPayload, id: string, hidden: boolean): LayoutPayload =>
  withSlot(layout, id, { hidden });

/** Moves a movable block to another tab. Passing its default tab clears the move. */
export function moveSlotToTab(layout: LayoutPayload, id: string, tab: string): LayoutPayload {
  const def = findSlot(id);
  if (!def?.movable) return layout;
  return withSlot(layout, id, { tab });
}

/** Writes an explicit order for a list of slot ids (used after drag/reorder). */
export function reorderSlots(layout: LayoutPayload, orderedIds: string[]): LayoutPayload {
  let next = layout;
  orderedIds.forEach((id, i) => {
    next = withSlot(next, id, { order: i });
  });
  return next;
}

/** Moves a slot one step up or down among its siblings on the same tab. */
export function nudgeSlot(
  layout: LayoutPayload,
  role: Role,
  id: string,
  direction: -1 | 1,
): LayoutPayload {
  const def = findSlot(id);
  if (!def) return layout;
  const tab = resolveSlot(def, layout).tab;
  const siblings = resolveSlots(role, layout)
    .filter((s) => s.tab === tab)
    .map((s) => s.definition.id);
  const from = siblings.indexOf(id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= siblings.length) return layout;
  const next = [...siblings];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return reorderSlots(layout, next);
}

export function setTabHidden(layout: LayoutPayload, path: string, hidden: boolean): LayoutPayload {
  const current = new Set(layout.tabs?.hidden ?? []);
  if (hidden) current.add(path);
  else current.delete(path);
  return { ...layout, tabs: { ...(layout.tabs ?? {}), hidden: [...current] } };
}

export function setTabOrder(layout: LayoutPayload, order: string[]): LayoutPayload {
  return { ...layout, tabs: { ...(layout.tabs ?? {}), order } };
}

/** Moves a tab one step within its own group (visual order only). */
export function nudgeTab(
  layout: LayoutPayload,
  role: Role,
  path: string,
  direction: -1 | 1,
): LayoutPayload {
  const current = applyNavLayout(navForRole(role), { ...layout, tabs: { ...layout.tabs, hidden: [] } })
    .flatMap((g) => g.items)
    .map((i) => String(i.to));
  const from = current.indexOf(path);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= current.length) return layout;
  const next = [...current];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return setTabOrder(layout, next);
}

/** Clears every customisation for a role. */
export const resetLayout = (): LayoutPayload => ({});

/** Guards against malformed rows coming back from the database. */
export function normalizeLayout(value: unknown): LayoutPayload {
  if (!value || typeof value !== "object") return {};
  const v = value as LayoutPayload;
  const tabs = v.tabs && typeof v.tabs === "object" ? v.tabs : undefined;
  const slots = v.slots && typeof v.slots === "object" ? v.slots : undefined;
  return {
    ...(tabs
      ? {
          tabs: {
            ...(Array.isArray(tabs.order) ? { order: tabs.order.map(String) } : {}),
            ...(Array.isArray(tabs.hidden) ? { hidden: tabs.hidden.map(String) } : {}),
          },
        }
      : {}),
    ...(slots ? { slots } : {}),
  };
}

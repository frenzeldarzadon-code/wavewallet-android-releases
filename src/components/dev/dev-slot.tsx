/**
 * Developer Mode presentation wrappers.
 *
 * `DevSlot` wraps an EXISTING content block. When a Super Admin hides that
 * block, or moves it to another tab, the block stays mounted and keeps doing
 * its work (queries, subscriptions, calculations) — only its presentation
 * changes. Nothing here touches data, permissions or routing.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useRoleLayout } from "@/lib/dev-mode";
import {
  EMPTY_LAYOUT,
  findSlot,
  originPresentation,
  resolveSlot,
  slotsMovedInto,
  type LayoutPayload,
} from "@/lib/ui-layout";
import type { Role } from "@/lib/wavewallet";

const PREFIX: Record<Role, string> = {
  customer: "customer",
  reseller: "reseller",
  subreseller: "subreseller",
  admin: "admin",
  super_admin: "super",
};

export const slotPrefix = (role: Role) => PREFIX[role] ?? "customer";
export const slotIdFor = (role: Role, name: string) => `${slotPrefix(role)}.${name}`;

interface Ctx {
  role: Role | null;
  layout: LayoutPayload;
}

const LayoutCtx = createContext<Ctx>({ role: null, layout: EMPTY_LAYOUT });

/** Provided once per console layout so pages don't need to know the role. */
export function RoleLayoutProvider({ role, children }: { role: Role | null; children: ReactNode }) {
  const layout = useRoleLayout(role);
  return <LayoutCtx.Provider value={{ role, layout }}>{children}</LayoutCtx.Provider>;
}

export const useRoleLayoutContext = () => useContext(LayoutCtx);

/**
 * Concealed blocks are rendered inside an inert, visually hidden container:
 * still mounted, still fetching, still calculating — simply not shown.
 */
function Concealed({ children }: { children: ReactNode }) {
  return (
    <div hidden aria-hidden data-dev-concealed="true" className="hidden">
      {children}
    </div>
  );
}

export function DevSlot({ name, children }: { name: string; children: ReactNode }) {
  const { role, layout } = useRoleLayoutContext();
  if (!role) return <>{children}</>;
  const id = slotIdFor(role, name);
  const def = findSlot(id);
  if (!def) return <>{children}</>;
  const resolved = resolveSlot(def, layout);
  if (originPresentation(id, layout) === "concealed") return <Concealed>{children}</Concealed>;
  return <div style={{ order: resolved.order }}>{children}</div>;
}

/** Container that honours the configured order of its `DevSlot` children. */
export function DevSlotGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

/**
 * Renders blocks that a Super Admin MOVED into this tab. The moved block keeps
 * its own data source and business rules — only its location changed.
 */
export function DevSlotHost({ tab }: { tab: string }) {
  const { role, layout } = useRoleLayoutContext();
  if (!role) return null;
  const moved = slotsMovedInto(role, tab, layout);
  if (moved.length === 0) return null;
  return (
    <>
      {moved.map((s) => {
        const Component = MOVABLE_COMPONENTS[s.definition.id];
        return Component ? <Component key={s.definition.id} /> : null;
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Movable blocks                                                      */
/* ------------------------------------------------------------------ */

import { lazy, Suspense, type ComponentType } from "react";

const MovedWalletCenter = lazy(() =>
  import("@/components/dev/movable").then((m) => ({ default: m.MovableWalletCenter })),
);
const MovedAdminEarnings = lazy(() =>
  import("@/components/dev/movable").then((m) => ({ default: m.MovableAdminEarnings })),
);

const wrap = (C: ComponentType) => () => (
  <Suspense fallback={null}>
    <C />
  </Suspense>
);

const MOVABLE_COMPONENTS: Record<string, ComponentType> = {
  "customer.wallet.center": wrap(MovedWalletCenter),
  "admin.dashboard.earnings": wrap(MovedAdminEarnings),
};

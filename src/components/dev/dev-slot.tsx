/**
 * Developer Mode presentation wrappers.
 *
 * `DevSlot` wraps an EXISTING content block. When a Super Admin hides that
 * block, the block stays mounted and keeps doing its work (queries,
 * subscriptions, calculations) — only its presentation changes. Nothing here
 * touches data, permissions or routing, and blocks are never relocated.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useRoleLayout } from "@/lib/dev-mode";
import {
  EMPTY_LAYOUT,
  originPresentation,
  slotIdFor,
  slotPrefix,
  type LayoutPayload,
} from "@/lib/ui-layout";
import type { Role } from "@/lib/wavewallet";

export { slotIdFor, slotPrefix };

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
  if (originPresentation(slotIdFor(role, name), layout) === "concealed") {
    return <Concealed>{children}</Concealed>;
  }
  return <>{children}</>;
}

/** Container kept for call sites that group configurable blocks. */
export function DevSlotGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

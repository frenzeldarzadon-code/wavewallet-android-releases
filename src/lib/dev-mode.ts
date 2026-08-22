/**
 * Developer Mode runtime: loads the stored role layouts, keeps them fresh for
 * every signed-in session and exposes the Super Admin-only write paths.
 *
 * Reading a layout is harmless (it only decides what is shown), so every
 * session may read it. Writing goes through `set_ui_layout`, which refuses
 * anyone who is not a super admin and records the change in the audit trail.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizeLayout,
  type LayoutMap,
  type LayoutPayload,
  EMPTY_LAYOUT,
} from "@/lib/ui-layout";
import type { Role } from "@/lib/wavewallet";

/* ------------------------------------------------------------------ */
/* Developer Mode switch (Super Admin, per device)                     */
/* ------------------------------------------------------------------ */

const DEV_KEY = "wavewallet.devmode";
const DEV_EVENT = "wavewallet:devmode";

export function readDevMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEV_KEY) === "1";
}

export function writeDevMode(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(DEV_KEY, "1");
  else window.localStorage.removeItem(DEV_KEY);
  window.dispatchEvent(new Event(DEV_EVENT));
}

/** True only for a super admin who switched Developer Mode on. */
export function useDeveloperMode(role: Role | null | undefined): {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  allowed: boolean;
} {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(readDevMode());
    sync();
    window.addEventListener(DEV_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DEV_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const allowed = role === "super_admin";
  return {
    allowed,
    enabled: allowed && on,
    setEnabled: (next: boolean) => writeDevMode(next),
  };
}

/* ------------------------------------------------------------------ */
/* Layout store                                                        */
/* ------------------------------------------------------------------ */

let cache: LayoutMap = {};
let loaded = false;
let inflight: Promise<LayoutMap> | null = null;
const listeners = new Set<(m: LayoutMap) => void>();
let channelOpen = false;

const publish = () => listeners.forEach((l) => l(cache));

export async function fetchLayouts(force = false): Promise<LayoutMap> {
  if (!force && loaded) return cache;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase
      .from("ui_layout_configs")
      .select("role, payload, ecosystem_id")
      .is("ecosystem_id", null);
    if (!error) {
      const next: LayoutMap = {};
      for (const row of data ?? []) {
        next[row.role as Role] = normalizeLayout(row.payload);
      }
      cache = next;
      loaded = true;
      publish();
    }
    inflight = null;
    return cache;
  })();
  return inflight;
}

/** Applies a freshly saved payload without waiting for a round-trip. */
export function primeLayout(role: Role, payload: LayoutPayload) {
  cache = { ...cache, [role]: normalizeLayout(payload) };
  loaded = true;
  publish();
}

function openRealtime() {
  if (channelOpen || typeof window === "undefined") return;
  channelOpen = true;
  supabase
    .channel("ui-layout-configs")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "ui_layout_configs" },
      () => void fetchLayouts(true),
    )
    .subscribe();
}

/** Live layout for one role. Updates as soon as a Super Admin saves a change. */
export function useRoleLayout(role: Role | null | undefined): LayoutPayload {
  const [map, setMap] = useState<LayoutMap>(cache);
  useEffect(() => {
    listeners.add(setMap);
    void fetchLayouts();
    openRealtime();
    return () => {
      listeners.delete(setMap);
    };
  }, []);
  if (!role) return EMPTY_LAYOUT;
  return map[role] ?? EMPTY_LAYOUT;
}

/* ------------------------------------------------------------------ */
/* Writes (Super Admin only — enforced by the database)                */
/* ------------------------------------------------------------------ */

export interface SaveLayoutMeta {
  action: "hide" | "unhide" | "reorder" | "move" | "reset" | "update";
  targetKind?: "tab" | "component" | "layout";
  targetId?: string;
  targetLabel?: string;
}

export async function saveLayout(role: Role, payload: LayoutPayload, meta: SaveLayoutMeta) {
  const { error } = await supabase.rpc("set_ui_layout", {
    _role: role,
    _payload: payload as unknown as Record<string, unknown>,
    _action: meta.action,
    _target_kind: meta.targetKind ?? "layout",
    _target_id: meta.targetId ?? null,
    _target_label: meta.targetLabel ?? null,
    _ecosystem_id: null,
  });
  if (error) throw new Error(error.message);
  primeLayout(role, payload);
}

export interface LayoutHistoryRow {
  id: string;
  role: Role;
  action: string;
  targetKind: string;
  targetId: string | null;
  targetLabel: string | null;
  previous: LayoutPayload | null;
  next: LayoutPayload | null;
  actorName: string | null;
  createdAt: string;
}

export async function fetchLayoutHistory(role?: Role | "all"): Promise<LayoutHistoryRow[]> {
  let q = supabase
    .from("ui_layout_audit")
    .select(
      "id, role, action, target_kind, target_id, target_label, previous_payload, next_payload, actor_name, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (role && role !== "all") q = q.eq("role", role);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    role: r.role as Role,
    action: r.action,
    targetKind: r.target_kind,
    targetId: r.target_id,
    targetLabel: r.target_label,
    previous: r.previous_payload ? normalizeLayout(r.previous_payload) : null,
    next: r.next_payload ? normalizeLayout(r.next_payload) : null,
    actorName: r.actor_name,
    createdAt: r.created_at,
  }));
}

/** Restores the layout as it was before the given history entry. */
export async function restoreLayoutFromHistory(auditId: string) {
  const { error } = await supabase.rpc("restore_ui_layout", { _audit_id: auditId });
  if (error) throw new Error(error.message);
  await fetchLayouts(true);
}

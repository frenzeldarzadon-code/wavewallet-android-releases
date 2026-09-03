/**
 * Developer Mode — UI Layout & Visibility Manager (Super Admin only).
 *
 * Everything configured here is presentation. Hiding a tab or a content block
 * never removes a route, a query, a calculation, a background job or a
 * permission: hidden blocks stay mounted and keep working, and the database
 * still authorizes every read and write exactly as before.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { shortDateTime, type Role } from "@/lib/wavewallet";
import {
  fetchLayoutHistory,
  restoreLayoutFromHistory,
  saveLayout,
  useDeveloperMode,
  useRoleLayout,
  type LayoutHistoryRow,
  type SaveLayoutMeta,
} from "@/lib/dev-mode";
import {
  DEV_MODE_ROLES,
  bottomNavForRole,
  hiddenSlots,
  isSlotHidden,
  isTabHidden,
  nudgeBottomTab,
  nudgeTab,
  resetLayout,
  roleTitle,
  setSlotHidden,
  setTabHidden,
  slotGroupsForRole,
  slotsForRole,
  tabLabel,
  applyBottomNavLayout,
  applyNavLayout,
  type LayoutPayload,
  type SlotDefinition,
} from "@/lib/ui-layout";
import { navForRole, type NavItem } from "@/lib/navigation";
import { isImpersonatable, startImpersonation } from "@/lib/impersonation";
import { homeFor } from "@/lib/session";


export const Route = createFileRoute("/super/developer")({
  head: () => ({
    meta: [
      { title: "Developer Mode — ONE WAVE Super Admin" },
      {
        name: "description",
        content:
          "Configure tabs and content visibility, order and placement for every role. Hiding is visual only — functionality keeps running.",
      },
      { property: "og:title", content: "Developer Mode — ONE WAVE Super Admin" },
      {
        property: "og:description",
        content: "Role-level interface layout manager for the WaveWallet platform owner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeveloperModePage,
});

interface AccountRow {
  id: string;
  full_name: string | null;
  email: string;
  role: Role;
}

function DeveloperModePage() {
  const { account } = useSession("super_admin");
  const dev = useDeveloperMode(account?.role ?? null);
  const [role, setRole] = useState<Role>("customer");
  const [search, setSearch] = useState("");
  const layout = useRoleLayout(role);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<LayoutHistoryRow[]>([]);

  const sideTabs = useMemo(
    () =>
      applyNavLayout(navForRole(role), { ...layout, tabs: { ...layout.tabs, hidden: [] } }).flatMap(
        (g) => g.items,
      ),
    [role, layout],
  );
  const bottomTabs = useMemo(
    () =>
      applyBottomNavLayout(bottomNavForRole(role), {
        ...layout,
        tabs: { ...layout.tabs, hidden: [] },
      }),
    [role, layout],
  );

  const reloadHistory = useCallback(() => {
    void fetchLayoutHistory("all").then(setHistory);
  }, []);
  useEffect(reloadHistory, [reloadHistory]);

  const apply = async (next: LayoutPayload, meta: SaveLayoutMeta) => {
    setBusy(true);
    try {
      await saveLayout(role, next, meta);
      toast.success("Layout updated", {
        description: `Applied to every ${roleTitle(role)} account. Functionality is unchanged.`,
      });
      reloadHistory();
    } catch (e) {
      toast.error("Could not save layout", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const toggleSlot = (def: SlotDefinition, hide: boolean) =>
    void apply(setSlotHidden(layout, def.id, hide), {
      action: hide ? "hide" : "unhide",
      targetKind: "component",
      targetId: def.id,
      targetLabel: def.label,
    });

  if (!dev.allowed) return null;

  const needle = search.trim().toLowerCase();
  const groups = slotGroupsForRole(role)
    .map((g) => ({
      ...g,
      slots: needle
        ? g.slots.filter((s) =>
            `${g.group} ${s.label} ${s.id}`.toLowerCase().includes(needle),
          )
        : g.slots,
    }))
    .filter((g) => g.slots.length > 0);
  const hidden = hiddenSlots(role, layout);


  return (
    <>
      <PageSection
        title="Developer Mode"
        description="Configure how the interface looks for a whole role. Hiding is visual only — routes, data, calculations, background jobs and permissions keep running."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Switch
                  id="devmode"
                  checked={dev.enabled}
                  onCheckedChange={(v) => dev.setEnabled(v)}
                />
                <Label htmlFor="devmode" className="text-sm font-semibold">
                  {dev.enabled ? "Developer Mode Active" : "Developer Mode off"}
                </Label>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Only Super Admins can see or change this. Saved changes apply to every account of
                the selected role immediately — no new build or deployment.
              </p>
            </div>
            {dev.enabled ? <StatusBadge tone="warning">Active</StatusBadge> : null}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Scope" description="Pick the role/level you are configuring.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Role / level</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEV_MODE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleTitle(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dev-search">Find content</Label>
              <Input
                id="dev-search"
                placeholder="Search sections, cards and panels"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Configuration is stored as <strong>{roleTitle(role)} → content</strong>, never against
              an individual account. Content is only shown or hidden — never moved to another page.
            </p>

          </CardContent>
        </Card>
      </PageSection>

      <InspectAccounts role={role} enabled={dev.enabled} />

      <PageSection
        title="Left navigation"
        description="Reorder or hide side navigation entries. A hidden entry keeps its route, data and permissions."
      >
        <NavEditor
          items={sideTabs}
          layout={layout}
          busy={busy}
          emptyLabel={`${roleTitle(role)} has no side navigation.`}
          onNudge={(path, dir, label) =>
            void apply(nudgeTab(layout, role, path, dir), {
              action: "reorder",
              targetKind: "tab",
              targetId: path,
              targetLabel: label,
            })
          }
          onToggle={(path, hide, label) =>
            void apply(setTabHidden(layout, path, hide), {
              action: hide ? "hide" : "unhide",
              targetKind: "tab",
              targetId: path,
              targetLabel: label,
            })
          }
        />
      </PageSection>

      <PageSection
        title="Bottom navigation"
        description="The mobile bar for this role. Ordering here is independent from the side navigation; entries never move between the two."
      >
        <NavEditor
          items={bottomTabs}
          layout={layout}
          busy={busy}
          emptyLabel={`${roleTitle(role)} has no bottom navigation.`}
          onNudge={(path, dir, label) =>
            void apply(nudgeBottomTab(layout, role, path, dir), {
              action: "reorder",
              targetKind: "tab",
              targetId: path,
              targetLabel: label,
            })
          }
          onToggle={(path, hide, label) =>
            void apply(setTabHidden(layout, path, hide), {
              action: hide ? "hide" : "unhide",
              targetKind: "tab",
              targetId: path,
              targetLabel: label,
            })
          }
        />
      </PageSection>

      <PageSection
        title={`Content visible to ${roleTitle(role)}`}
        description="Every configurable section, card and panel this role can see, grouped by screen. Hidden content stays mounted and keeps working in the background."
      >
        {groups.length === 0 ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent>
              <EmptyState
                title="No matching content"
                description="Try a different search term, or clear the search to see everything for this role."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <Card key={g.group} className="shadow-[var(--shadow-card)]">
                <CardHeader>
                  <CardTitle className="text-sm">{g.group}</CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-border px-0 py-0">
                  {g.slots.map((def) => {
                    const isHidden = isSlotHidden(layout, def.id);
                    return (
                      <div
                        key={def.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{def.label}</p>
                          <p className="truncate text-xs text-muted-foreground">{def.id}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {isHidden ? <Badge variant="secondary">Hidden</Badge> : null}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={`${isHidden ? "Show" : "Hide"} ${def.label}`}
                            onClick={() => toggleSlot(def, !isHidden)}
                          >
                            {isHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>


      <PageSection
        title="Hidden items"
        description="Everything currently hidden for this role, with a one-click restore."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {(layout.tabs?.hidden ?? []).length === 0 && hidden.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing is hidden for {roleTitle(role)}.
              </p>
            ) : null}
            {(layout.tabs?.hidden ?? []).map((path) => (
              <div key={path} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{tabLabel(role, path)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {roleTitle(role)} · tab · {path}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void apply(setTabHidden(layout, path, false), {
                      action: "unhide",
                      targetKind: "tab",
                      targetId: path,
                      targetLabel: tabLabel(role, path),
                    })
                  }
                >
                  <Eye className="size-3.5" /> Unhide
                </Button>
              </div>
            ))}
            {hidden.map((s) => (
              <div
                key={s.definition.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.definition.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {roleTitle(role)} · {s.definition.group} · content
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void apply(setSlotHidden(layout, s.definition.id, false), {
                      action: "unhide",
                      targetKind: "component",
                      targetId: s.definition.id,
                      targetLabel: s.definition.label,
                    })
                  }
                >
                  <Eye className="size-3.5" /> Restore
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Button
          className="mt-3"
          variant="outline"
          disabled={busy}
          onClick={() => void apply(resetLayout(), { action: "reset" })}
        >
          <RotateCcw className="size-4" /> Reset {roleTitle(role)} layout to default
        </Button>
      </PageSection>

      <PageSection
        title="Configuration history"
        description="Every layout change, with the state it replaced."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {history.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No layout changes recorded yet.
              </p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      <History className="mr-1 inline size-3.5" />
                      {h.action} · {h.targetLabel ?? h.targetKind}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {roleTitle(h.role)} · {h.actorName ?? "Super Admin"} ·{" "}
                      {shortDateTime(h.createdAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void restoreLayoutFromHistory(h.id)
                        .then(() => {
                          toast.success("Previous layout restored");
                          reloadHistory();
                        })
                        .catch((e: Error) =>
                          toast.error("Could not restore", { description: e.message }),
                        )
                    }
                  >
                    <RotateCcw className="size-3.5" /> Restore state before
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>
    </>
  );
}

/**
 * One navigation group (side or bottom). Reordering stays inside the group —
 * an entry can never jump from the bottom bar into the side navigation.
 */
function NavEditor({
  items,
  layout,
  busy,
  emptyLabel,
  onNudge,
  onToggle,
}: {
  items: NavItem[];
  layout: LayoutPayload;
  busy: boolean;
  emptyLabel: string;
  onNudge: (path: string, direction: -1 | 1, label: string) => void;
  onToggle: (path: string, hide: boolean, label: string) => void;
}) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="divide-y divide-border px-0 py-0">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          items.map((t, i) => {
            const path = String(t.to);
            const isHidden = isTabHidden(layout, path);
            return (
              <div key={path} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{path}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isHidden ? <Badge variant="secondary">Hidden</Badge> : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy || i === 0}
                    aria-label={`Move ${t.label} up`}
                    onClick={() => onNudge(path, -1, t.label)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy || i === items.length - 1}
                    aria-label={`Move ${t.label} down`}
                    onClick={() => onNudge(path, 1, t.label)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={isHidden ? `Unhide ${t.label}` : `Hide ${t.label}`}
                    onClick={() => onToggle(path, !isHidden, t.label)}
                  >
                    {isHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Inspect a live account: opens the existing, fully audited Access Account
 * flow so the Super Admin sees the real interface. Nothing about the account
 * is modified, and any layout change made while inspecting is saved against
 * the ROLE, never the account.
 */
function InspectAccounts({ role, enabled }: { role: Role; enabled: boolean }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    void (async () => {
      // Roles live in user_roles — never on the profile row.
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", role)
        .limit(50);
      const ids = (roleRows ?? []).map((r) => r.user_id);
      const { data } = ids.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", ids).limit(25)
        : { data: [] };
      if (!active) return;
      setRows(
        ((data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => ({
          ...p,
          role,
        })),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [role, enabled]);

  if (!enabled) return null;

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((r) => `${r.full_name ?? ""} ${r.email}`.toLowerCase().includes(needle))
    : rows;

  const inspect = async (row: AccountRow) => {
    try {
      await startImpersonation(row.id, "Developer Mode layout inspection");
      window.location.assign(homeFor(row.role));
    } catch (e) {
      toast.error("Could not open account", { description: (e as Error).message });
    }
  };

  return (
    <PageSection
      title="Inspect a live account"
      description="Open a real account to see its actual interface. Inspection never changes that account's data, wallet, permissions or transactions."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-sm">{roleTitle(role)} accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading accounts…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No {roleTitle(role)} accounts found.</p>
          ) : (
            <div className="divide-y divide-border">
              {visible.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.full_name || r.email}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                  </div>
                  {isImpersonatable(role) ? (
                    <Button size="sm" variant="outline" onClick={() => void inspect(r)}>
                      Inspect
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Sign in as this level to preview
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Any hide, reorder or move made while inspecting is saved as the global{" "}
            {roleTitle(role)} configuration and applies to every {roleTitle(role)} account.
          </p>
        </CardContent>
      </Card>
    </PageSection>
  );
}

/** Kept for readability of the registry in tests. */
export const developerModeSlots = slotsForRole;

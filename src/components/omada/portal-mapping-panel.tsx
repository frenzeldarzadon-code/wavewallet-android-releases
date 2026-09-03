/**
 * Admin setup for the WaveWallet customer captive portal of ONE shop.
 *
 * Everything shown here is read live from that shop's own controller. A portal
 * is never selected implicitly: the admin picks a site, WaveWallet fetches the
 * real portals of that site, and only an explicit portal choice can be saved.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, StatusBadge } from "@/components/ui-kit";
import {
  deletePortalMapping,
  getPortalSetup,
  listPortalMappings,
  listSitePortalOptions,
  savePortalMapping,
  setPortalMappingEnabled,
  type PortalMappingView,
  type PortalOption,
  type PortalSetup,
} from "@/lib/omada-portals.functions";
import { DEFAULT_PORTAL_FLAGS, type PortalFeatureFlags } from "@/lib/portal-mapping";

const FLAG_LABELS: Array<{ key: keyof PortalFeatureFlags; label: string; hint: string }> = [
  {
    key: "allowPurchase",
    label: "Buy a voucher in the portal",
    hint: "Uses your existing Voucher Shop, prices and stock.",
  },
  { key: "showCoins", label: "Show coin balance", hint: "The customer's real wallet balance." },
  { key: "showPoints", label: "Show points", hint: "The customer's real points balance." },
  {
    key: "showVoucherStatus",
    label: "Show voucher status link",
    hint: "Lets the customer check a code they already hold.",
  },
  { key: "showHistory", label: "Show recent purchases", hint: "Their last vouchers from this shop." },
  {
    key: "rememberCustomer",
    label: "Remember the customer on this device",
    hint: "Skips signing in again on the next hotspot session.",
  },
];

export function PortalMappingPanel({
  ecosystemId,
  shopName = null,
}: {
  ecosystemId: string | null;
  /** Real name of the active shop, shown on each setup card. */
  shopName?: string | null;
}) {
  const [setup, setSetup] = useState<PortalSetup | null>(null);
  const [mappings, setMappings] = useState<PortalMappingView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const [siteId, setSiteId] = useState("");
  const [portals, setPortals] = useState<PortalOption[]>([]);
  const [portalsLoading, setPortalsLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const [portalId, setPortalId] = useState("");
  const [flags, setFlags] = useState<PortalFeatureFlags>(DEFAULT_PORTAL_FLAGS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const reload = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      const [s, m] = await Promise.all([
        getPortalSetup({ data: { ecosystemId } }),
        listPortalMappings({ data: { ecosystemId } }),
      ]);
      setSetup(s);
      setMappings(m);
      if (!siteId && s.activeSiteId) setSiteId(s.activeSiteId);
    } catch (e) {
      toast.error("Could not load the portal setup", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
    // siteId intentionally excluded: it is only seeded once.
  }, [ecosystemId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!ecosystemId || !siteId) {
      setPortals([]);
      setPortalsLoading(false);
      return;
    }
    let active = true;
    setPortalError(null);
    setPortals([]);
    setPortalsLoading(true);
    void listSitePortalOptions({ data: { ecosystemId, siteId } })
      .then((r) => {
        if (!active) return;
        setPortals(r.portals);
        setPortalError(r.error);
      })
      .catch((e: Error) => active && setPortalError(e.message))
      .finally(() => {
        if (active) setPortalsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ecosystemId, siteId]);


  if (!ecosystemId) return null;

  const selectedPortal = portals.find((p) => p.id === portalId) ?? null;

  const startNew = () => {
    setEditingId(null);
    setPortalId("");
    setFlags(DEFAULT_PORTAL_FLAGS);
    setShowForm(true);
  };

  const startEdit = (m: PortalMappingView) => {
    setEditingId(m.id);
    setSiteId(m.siteId);
    setPortalId(m.portalId);
    setFlags(m.flags);
    setShowForm(true);
  };

  const save = async () => {
    if (!portalId) {
      toast.error("Choose the exact Omada portal this shop should serve.");
      return;
    }
    setBusy("save");
    try {
      await savePortalMapping({
        data: {
          ecosystemId,
          id: editingId,
          siteId,
          siteName: setup?.sites.find((s) => s.id === siteId)?.name ?? null,
          portalId,
          portalName: selectedPortal?.name ?? null,
          ssidInfo: selectedPortal?.ssids[0] ?? null,
          flags,
        },
      });
      toast.success("Portal connected to this shop.");
      setShowForm(false);
      await reload();
    } catch (e) {
      toast.error("Could not save", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const toggle = async (m: PortalMappingView) => {
    setBusy(`toggle-${m.id}`);
    try {
      await setPortalMappingEnabled({ data: { ecosystemId, id: m.id, enabled: !m.enabled } });
      await reload();
    } catch (e) {
      toast.error("Could not update", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };


  const remove = async (m: PortalMappingView) => {
    setBusy(`del-${m.id}`);
    try {
      await deletePortalMapping({ data: { ecosystemId, id: m.id } });
      toast.success("Portal disconnected.");
      await reload();
    } catch (e) {
      toast.error("Could not disconnect", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 text-sm">
            <span>Customer portal</span>
            <StatusBadge
              tone={
                !setup?.configured
                  ? "muted"
                  : setup.error
                    ? "danger"
                    : "success"
              }
            >
              {!setup?.configured
                ? "No controller"
                : setup.error
                  ? "Controller error"
                  : "Controller connected"}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            Select the exact Omada site and portal that the customized page belongs to. The portal
            generator below uses this mapping and never selects one automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading your controller…
            </p>
          ) : !setup?.configured ? (
            <EmptyState
              title="Connect your Omada controller first"
              description="Use the Connection tab to add this shop's controller, then come back here."
            />
          ) : (
            <>
              {setup.error ? (
                <p className="rounded-md border border-destructive/30 p-3 text-xs text-destructive">
                  The controller could not be reached. Check the Connection tab before changing a
                  portal mapping.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={startNew} disabled={setup.sites.length === 0}>
                  <Plus className="mr-1 h-4 w-4" /> Connect a portal
                </Button>
                <Button size="sm" variant="outline" onClick={() => void reload()}>
                  <RefreshCw className="mr-1 h-4 w-4" /> Refresh
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {showForm && setup?.configured ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">
              {editingId ? "Edit this portal" : "Connect an Omada portal"}
            </CardTitle>
            <CardDescription>
              One Omada site can have several portals. Choose the exact portal ONE WAVE should
              serve — nothing is selected for you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Omada site</Label>
                <Select
                  value={siteId}
                  onValueChange={(v) => {
                    setSiteId(v);
                    setPortalId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a site" />
                  </SelectTrigger>
                  <SelectContent>
                    {setup.sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Omada portal</Label>
                <Select
                  value={portalId}
                  onValueChange={setPortalId}
                  disabled={portalsLoading || portals.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !siteId
                          ? "Choose a site first"
                          : portalsLoading
                            ? "Reading portals from your controller…"
                            : portals.length === 0
                              ? "No portal available"
                              : "Choose the portal"
                      }
                    />
                  </SelectTrigger>

                  <SelectContent>
                    {portals.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.ssids.length > 0 ? ` — ${p.ssids.join(", ")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {portalError ? (
                  <p className="text-xs text-destructive">{portalError}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              {FLAG_LABELS.map((f) => (
                <label
                  key={f.key}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <span>
                    <span className="block text-sm font-medium">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">{f.hint}</span>
                  </span>
                  <Switch
                    checked={flags[f.key]}
                    onCheckedChange={(v) => setFlags((prev) => ({ ...prev, [f.key]: v }))}
                  />
                </label>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== "" || !portalId} onClick={() => void save()}>
                {busy === "save" ? "Saving…" : "Save portal"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {mappings.length === 0 && !loading ? null : (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Connected portals</CardTitle>
            <CardDescription>
              These mappings bind each generated customized page to one exact shop, site and portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mappings.map((m) => (
                <div key={m.id} className="space-y-3 rounded-md border p-3 sm:p-4">
                  {/* Identity: shop, real site, real portal — all live values. */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="break-words text-sm font-semibold">
                        {m.portalName ?? m.portalId}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        Shop: {shopName ?? "This shop"}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        Omada site: {m.siteName ?? m.siteId}
                        {m.ssidInfo ? ` · ${m.ssidInfo}` : ""}
                      </p>
                    </div>
                    <StatusBadge tone={m.enabled ? "success" : "muted"}>
                      {m.enabled ? "Mapping active" : "Switched off"}
                    </StatusBadge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEdit(m)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== ""}
                      onClick={() => void toggle(m)}
                    >
                      {m.enabled ? "Switch off" : "Switch on"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== ""}
                      onClick={() => void remove(m)}
                    >
                      <Trash2 className="mr-1 h-4 w-4" /> Disconnect
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

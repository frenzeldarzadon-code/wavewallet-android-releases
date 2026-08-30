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
  Copy,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  testPortalMapping,
  type PortalMappingView,
  type PortalOption,
  type PortalSetup,
  type PortalTestStep,
} from "@/lib/omada-portals.functions";
import {
  DEFAULT_PORTAL_FLAGS,
  portalUrlFor,
  type PortalFeatureFlags,
} from "@/lib/portal-mapping";
import {
  externalPortalExplanation,
  externalPortalLabel,
  portalSetupInstructions,
  portalSetupState,
  preAuthValueFor,
} from "@/lib/portal-setup-status";

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
  const [steps, setSteps] = useState<Record<string, PortalTestStep[]>>({});
  const [instructionsFor, setInstructionsFor] = useState<string | null>(null);

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

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const selectedPortal = portals.find((p) => p.id === portalId) ?? null;
  const caps = setup?.capabilities ?? null;

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

  const runTest = async (id: string) => {
    setBusy(`test-${id}`);
    try {
      const r = await testPortalMapping({ data: { ecosystemId, id } });
      setSteps((s) => ({ ...s, [id]: r.steps }));
      if (r.ok) toast.success("This portal is ready.");
      else toast.error("This portal needs attention.");
      await reload();
    } catch (e) {
      toast.error("Test failed", { description: (e as Error).message });
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

  const setUpInOmada = async (m: PortalMappingView, url: string) => {
    setBusy(`auto-${m.id}`);
    try {
      const r = await autoConfigurePortal({ data: { ecosystemId, id: m.id, portalUrl: url } });
      setAutoConfig((s) => ({ ...s, [m.id]: r }));
      if (r.status === "configured" || r.status === "already_configured") toast.success(r.summary);
      else toast.warning(r.summary);
      await reload();
    } catch (e) {
      toast.error("Automatic setup failed", { description: (e as Error).message });
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
                    : caps?.listSupported
                      ? "success"
                      : "warning"
              }
            >
              {!setup?.configured
                ? "No controller"
                : setup.error
                  ? "Controller error"
                  : caps?.listSupported
                    ? "Ready"
                    : "Limited"}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            Let customers of this shop sign in on your hotspot page, buy a voucher from your own
            Voucher Shop with their coins and get online. Manual voucher entry always stays
            available for everyone else.
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
              <div className="rounded-md border p-3 text-xs text-muted-foreground">
                {caps ? (
                  <ul className="space-y-1">
                    {caps.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                    <li>
                      Automatic sign-on:{" "}
                      {caps.authorizeSupported
                        ? `available (${caps.authorizePath})`
                        : "not published by this controller"}
                    </li>
                  </ul>
                ) : (
                  <p>{setup.error}</p>
                )}
                {caps?.limitation ? (
                  <p className="mt-2 text-warning-foreground">{caps.limitation}</p>
                ) : null}
              </div>
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
              One Omada site can have several portals. Choose the exact portal WaveWallet should
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
              Each portal works on its own. Paste its address into that portal's External Portal
              setting in Omada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {mappings.map((m) => {
              const url = portalUrlFor(origin, m.id);
              return (
                <div key={m.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium">{m.portalName ?? m.portalId}</p>
                      <p className="break-words text-xs text-muted-foreground">
                        {m.siteName ?? m.siteId}
                        {m.ssidInfo ? ` · ${m.ssidInfo}` : ""}
                      </p>
                    </div>

                    <StatusBadge
                      tone={
                        !m.enabled ? "muted" : m.lastTestStatus === "passed" ? "success" : m.lastTestStatus === "failed" ? "danger" : "muted"
                      }
                    >
                      {!m.enabled
                        ? "Switched off"
                        : m.lastTestStatus === "passed"
                          ? "Tested"
                          : m.lastTestStatus === "failed"
                            ? "Needs attention"
                            : "Not tested"}
                    </StatusBadge>
                  </div>

                  <div className="flex items-center gap-2">
                    <Input readOnly value={url} className="min-w-0 flex-1 text-xs" />

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(url);
                        toast.success("Portal address copied.");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy !== ""}
                      onClick={() => void setUpInOmada(m, url)}
                    >
                      {busy === `auto-${m.id}` ? "Setting up…" : "Set up in Omada"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== ""}
                      onClick={() => void runTest(m.id)}
                    >
                      {busy === `test-${m.id}` ? "Testing…" : "Test"}
                    </Button>
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

                  {autoConfig[m.id] ? (
                    <div className="space-y-1 rounded-md border p-3">
                      <p className="text-xs font-medium">{autoConfig[m.id]!.summary}</p>
                      <ul className="space-y-1">
                        {autoConfig[m.id]!.steps.map((s) => (
                          <li key={s.step} className="text-xs">
                            <span className={s.ok ? "text-success" : "text-destructive"}>
                              {s.ok ? "✓" : "✕"}
                            </span>{" "}
                            <span className="font-medium">{s.step}</span> — {s.detail}
                          </li>
                        ))}
                      </ul>
                      {autoConfig[m.id]!.manualSteps.length > 0 ? (
                        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                          {autoConfig[m.id]!.manualSteps.map((s) => (
                            <li key={s} className="break-words">
                              {s}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </div>
                  ) : null}

                  {steps[m.id] ? (
                    <ul className="space-y-1">
                      {steps[m.id]!.map((s) => (
                        <li key={s.step} className="text-xs">
                          <span className={s.ok ? "text-success" : "text-destructive"}>
                            {s.ok ? "✓" : "✕"}
                          </span>{" "}
                          <span className="font-medium">{s.step}</span> — {s.detail}
                        </li>
                      ))}
                    </ul>
                  ) : m.lastTestDetail ? (
                    <p className="text-[11px] text-muted-foreground">{m.lastTestDetail}</p>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

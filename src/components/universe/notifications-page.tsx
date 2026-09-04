/**
 * Universe notifications: what happened to you, and which alerts you want.
 *
 * Every row here belongs to the signed-in person only. Nothing shows balances
 * or message contents — just who did what, with a link to the place it
 * happened.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, BellOff, BellRing, Check, Loader2, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { usePushSetup } from "@/hooks/use-push-setup";
import {
  NOTIFICATION_CATEGORIES,
  fetchNotifications,
  fetchPreferences,
  markRead,
  notificationLink,
  savePreferences,
  toggleCategory,
  type Notification,
  type NotificationPreferences,
} from "@/lib/notifications";
import {
  deliverySummary,
  fetchPushDevices,
  removeDevice,
  sendTestNotification,
  setDeviceEnabled,
  thisDeviceEndpoint,
  type PushDevice,
} from "@/lib/financial-notifications";

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Notification[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    disabledKinds: [],
    pushEnabled: false,
    pushShowDetails: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [hereEndpoint, setHereEndpoint] = useState<string | null>(null);
  const { support, permission, enable, disableHere } = usePushSetup();

  const reloadDevices = () => {
    void fetchPushDevices()
      .then(setDevices)
      .catch(() => undefined);
    void thisDeviceEndpoint().then(setHereEndpoint);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([fetchNotifications(), fetchPreferences(), fetchPushDevices()])
      .then(([n, p, d]) => {
        if (!active) return;
        setRows(n);
        setPrefs(p);
        setDevices(d);
      })
      .catch((e: Error) => toast.error("Could not load notifications", { description: e.message }))
      .finally(() => active && setLoading(false));
    void thisDeviceEndpoint().then((e) => active && setHereEndpoint(e));
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: NotificationPreferences) => {
    setPrefs(next);
    setSaving(true);
    try {
      await savePreferences(next);
    } catch (e) {
      toast.error("Could not save your choice", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const enablePush = async () => {
    setBusy(true);
    const { result, error } = await enable(prefs);
    setBusy(false);
    if (result === "enabled") {
      setPrefs((p) => ({ ...p, pushEnabled: true }));
      reloadDevices();
      toast.success("Phone notifications are on", {
        description: "This device will be alerted even when ONE WAVE is closed.",
      });
    } else if (result === "denied") {
      toast.error("Your browser blocked notifications", {
        description: "Allow notifications for this site in your browser or phone settings.",
      });
    } else if (result === "unavailable") {
      toast.error("Phone notifications are not available here yet", {
        description: "Open the published app (or add it to your Home Screen on iPhone).",
      });
    } else if (result === "error") {
      toast.error("Could not switch on phone notifications", { description: error });
    }
  };

  const disablePush = async () => {
    setBusy(true);
    try {
      await disableHere();
      await persist({ ...prefs, pushEnabled: false });
      reloadDevices();
      toast.success("Phone notifications are off", {
        description: "Everything still shows up in your list here.",
      });
    } catch (e) {
      toast.error("Could not switch off", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const testPush = async () => {
    setBusy(true);
    try {
      await sendTestNotification();
      toast.success("Test sent", {
        description: "It should reach your registered devices within a few seconds.",
      });
    } catch (e) {
      toast.error("Could not send a test", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const toggleDevice = async (d: PushDevice, on: boolean) => {
    setDevices((ds) => ds.map((x) => (x.id === d.id ? { ...x, push_enabled: on } : x)));
    try {
      await setDeviceEnabled(d.id, on);
    } catch (e) {
      toast.error("Could not update this device", { description: (e as Error).message });
      reloadDevices();
    }
  };

  const forgetDevice = async (d: PushDevice) => {
    setDevices((ds) => ds.filter((x) => x.id !== d.id));
    try {
      await removeDevice(d.id);
    } catch (e) {
      toast.error("Could not remove this device", { description: (e as Error).message });
      reloadDevices();
    }
  };

  const hereRegistered = !!hereEndpoint && devices.some((d) => d.endpoint === hereEndpoint);
  const pushOnHere = prefs.pushEnabled && permission === "granted" && hereRegistered;
  const pushDevices = devices.filter((d) => d.push_capable);

  const open = async (n: Notification) => {
    if (!n.read_at) {
      await markRead([n.id]).catch(() => undefined);
      setRows((rs) =>
        rs.map((r) => (r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)),
      );
    }
    // Links may carry a query string (e.g. /universe/friends?tab=requests).
    void navigate({ href: notificationLink(n) });
  };

  const markAll = async () => {
    try {
      await markRead();
      const now = new Date().toISOString();
      setRows((rs) => rs.map((r) => ({ ...r, read_at: r.read_at ?? now })));
    } catch (e) {
      toast.error("Could not update", { description: (e as Error).message });
    }
  };

  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <div className="space-y-4">
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Notifications</CardTitle>
            <CardDescription>
              {unread > 0 ? `${unread} new` : "You are all caught up"}
            </CardDescription>
          </div>
          {unread > 0 ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={markAll}>
              <Check className="size-4" /> Mark all read
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-1 pb-4">
          {loading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing yet"
              description="Likes, replies, mentions, messages, friend requests, gifts and cashback will show up here."
            />
          ) : (
            rows.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void open(n)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/60",
                  !n.read_at && "bg-accent/40",
                )}
              >
                <span
                  className={cn(
                    "mt-1 size-2 shrink-0 rounded-full",
                    n.read_at ? "bg-transparent" : "bg-primary",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  {n.body ? (
                    <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                  ) : null}
                  <span className="block text-[11px] text-muted-foreground">
                    {when(n.created_at)}
                    {n.category === "financial" ? ` • ${deliverySummary(n.delivery_status)}` : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">What you get notified about</CardTitle>
          <CardDescription>Switch off anything you would rather not hear about.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-5">
          {NOTIFICATION_CATEGORIES.map((c) => {
            const enabled = !prefs.disabledKinds.includes(c.kind);
            return (
              <div key={c.kind} className="flex items-center justify-between gap-3">
                <Label htmlFor={`notif-${c.kind}`} className="text-sm font-normal">
                  {c.label}
                </Label>
                <Switch
                  id={`notif-${c.kind}`}
                  checked={enabled}
                  disabled={saving}
                  onCheckedChange={(v) =>
                    void persist({
                      ...prefs,
                      disabledKinds: toggleCategory(prefs.disabledKinds, c.kind, v),
                    })
                  }
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="size-4" /> Phone notifications
          </CardTitle>
          <CardDescription>
            Get alerted on this device even when ONE WAVE is closed. We never turn this on for you —
            your browser asks first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-5 text-sm">
          {support === "unsupported" ? (
            <p className="text-muted-foreground">
              This browser cannot receive phone notifications. Your in-app list still works.
            </p>
          ) : support === "needs-install" ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Add ONE WAVE to your Home Screen first</p>
              <p className="mt-1">
                On iPhone and iPad, notifications only work for apps added to the Home Screen: tap
                Share, then “Add to Home Screen”, open ONE WAVE from there and come back here.
              </p>
            </div>
          ) : support === "unavailable" ? (
            <p className="text-muted-foreground">
              Phone notifications are only available in the published app, not in this preview.
            </p>
          ) : pushOnHere ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-success">
                <Bell className="size-4" /> On for this device.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => void testPush()}
                >
                  <Send className="size-4" /> Send me a test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground"
                  disabled={busy}
                  onClick={() => void disablePush()}
                >
                  <BellOff className="size-4" /> Turn off
                </Button>
              </div>
            </div>
          ) : permission === "denied" ? (
            <p className="text-muted-foreground">
              Notifications are blocked for this site. Allow them in your browser or phone settings,
              then come back here.
            </p>
          ) : (
            <div className="space-y-2">
              <Button
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() => void enablePush()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Smartphone className="size-4" />
                )}
                Turn on for this device
              </Button>
              <p className="text-xs text-muted-foreground">
                Alerts say what happened — “Ana sent you a gift on your post” — and open the app to
                the details.
              </p>
            </div>
          )}
          {support !== "unsupported" ? (
            <div className="flex items-start justify-between gap-3 border-t border-border pt-3">
              <div className="min-w-0">
                <p className="font-medium">Show details on the lock screen</p>
                <p className="text-xs text-muted-foreground">
                  On: names, amounts and statuses appear in the alert. Off: alerts only say the type
                  of event. Codes, references and account numbers are never shown either way.
                </p>
              </div>
              <Switch
                checked={prefs.pushShowDetails}
                disabled={saving}
                onCheckedChange={(v) => void persist({ ...prefs, pushShowDetails: v })}
                aria-label="Show details on the lock screen"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Your devices</CardTitle>
          <CardDescription>
            Every phone or computer where you turned notifications on. Switch one off or remove it
            any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-5 text-sm">
          {pushDevices.length === 0 ? (
            <p className="text-muted-foreground">
              No device receives phone notifications yet. Your alerts still appear in the list
              above.
            </p>
          ) : (
            pushDevices.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {d.device_label ?? "Unnamed device"}
                    {d.endpoint && d.endpoint === hereEndpoint ? (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        (this one)
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.expired_at
                      ? `Needs turning on again — ${d.last_error ?? "the browser dropped this device"}`
                      : `Last seen ${when(d.last_seen_at)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={d.push_enabled && !d.expired_at}
                    disabled={!!d.expired_at}
                    onCheckedChange={(v) => void toggleDevice(d, v)}
                    aria-label={`Alerts on ${d.device_label ?? "this device"}`}
                  />
                  <Button size="sm" variant="ghost" onClick={() => void forgetDevice(d)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

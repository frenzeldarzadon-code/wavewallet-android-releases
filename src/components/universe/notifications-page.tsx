/**
 * Universe notifications: what happened to you, and which alerts you want.
 *
 * Every row here belongs to the signed-in person only. Nothing shows balances
 * or message contents — just who did what, with a link to the place it
 * happened.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, BellRing, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import {
  NOTIFICATION_CATEGORIES,
  PUSH_REQUIREMENTS,
  fetchNotifications,
  fetchPreferences,
  markRead,
  notificationLink,
  notificationPermission,
  requestNotificationPermission,
  savePreferences,
  toggleCategory,
  type Notification,
  type NotificationPreferences,
} from "@/lib/notifications";
import {
  deliverySummary,
  fetchPushDevices,
  registerThisDevice,
  removeDevice,
  setDeviceEnabled,
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
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState(notificationPermission());
  const [devices, setDevices] = useState<PushDevice[]>([]);

  const reloadDevices = () => {
    void fetchPushDevices()
      .then(setDevices)
      .catch(() => undefined);
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
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "granted") {
      await persist({ ...prefs, pushEnabled: true });
      await registerThisDevice().catch(() => undefined);
      reloadDevices();
      toast.success("Alerts on", {
        description: "You will see pop-up alerts while ONE WAVE is open in this browser.",
      });
    } else if (result === "denied") {
      toast.error("Your browser blocked alerts", {
        description: "Allow notifications for this site in your browser settings.",
      });
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
            <BellRing className="size-4" /> Pop-up alerts on this device
          </CardTitle>
          <CardDescription>
            We never turn these on for you — your browser asks first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-5 text-sm">
          {permission === "unsupported" ? (
            <p className="text-muted-foreground">
              This browser does not support notifications. Your in-app list still works.
            </p>
          ) : permission === "granted" ? (
            <p className="flex items-center gap-2 text-success">
              <Bell className="size-4" /> Alerts are allowed on this device.
            </p>
          ) : (
            <Button size="sm" onClick={() => void enablePush()} disabled={permission === "denied"}>
              {permission === "denied" ? "Blocked in browser settings" : "Allow alerts"}
            </Button>
          )}
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Alerts with the app closed are not switched on yet.
            </p>
            <p className="mt-1">Turning that on needs:</p>
            <ul className="mt-1 list-disc pl-4">
              {PUSH_REQUIREMENTS.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-1">
              Until then ONE WAVE only alerts you while a tab is open, and everything is always
              waiting for you here.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Your devices</CardTitle>
            <CardDescription>
              Switch money alerts on or off for each phone or computer you use.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void registerThisDevice()
                .then(() => {
                  reloadDevices();
                  toast.success("This device is registered");
                })
                .catch((e: Error) =>
                  toast.error("Could not register this device", { description: e.message }),
                )
            }
          >
            Add this device
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 pb-5 text-sm">
          {devices.length === 0 ? (
            <p className="text-muted-foreground">
              No device registered yet. Your alerts still appear in the list above.
            </p>
          ) : (
            devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{d.device_label ?? "Unnamed device"}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.expired_at
                      ? `Needs re-registering — ${d.last_error ?? "the browser dropped this device"}`
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

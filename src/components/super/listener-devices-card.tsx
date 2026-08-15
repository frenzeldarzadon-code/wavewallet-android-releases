/**
 * Platform-owner management for the GCash notification listener devices.
 *
 * The paired phone forwards GCash notification text only. It is corroborating
 * evidence for a Cash In — never proof of payment on its own, and it can never
 * release credits by itself.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, EmptyState } from "@/components/ui-kit";
import {
  deviceStateLabel,
  eventResultLabel,
  fetchListenerStatus,
  LISTENER_ENDPOINT_PATH,
  registerListenerDevice,
  revokeListenerDevice,
  type ListenerStatus,
} from "@/lib/listener-devices";

const when = (value: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export function ListenerDevicesCard() {
  const [status, setStatus] = useState<ListenerStatus | null>(null);
  const [label, setLabel] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ deviceId: string; secret: string } | null>(null);

  const load = async () => {
    try {
      setStatus(await fetchListenerStatus());
    } catch {
      setStatus({ devices: [], recent_events: [] });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!status) return null;

  const register = async () => {
    if (!label.trim()) {
      toast.error("Give the phone a name so you can recognise it later.");
      return;
    }
    setBusy(true);
    try {
      const created = await registerListenerDevice({ label: label.trim(), windowMinutes });
      setSecret({ deviceId: created.device_id, secret: created.pairing_secret });
      setLabel("");
      await load();
      toast.success("Listener device registered", {
        description: "Copy the pairing secret now — it is shown only once.",
      });
    } catch (error) {
      toast.error("Could not register the device", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string, name: string) => {
    setBusy(true);
    try {
      await revokeListenerDevice(id);
      await load();
      toast.success(`${name} can no longer send events`);
    } catch (error) {
      toast.error("Could not revoke the device", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle>GCash notification listener</CardTitle>
        <p className="text-sm text-muted-foreground">
          Pair an Android phone that receives the GCash notifications. It forwards the amount and
          sender it read from the notification, which is matched against a single pending Cash In.
          Nothing is approved when the match is unclear, and a notification alone never releases
          credits.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="listener-label">Device name</Label>
            <Input
              id="listener-label"
              placeholder="Shop phone (Oppo A78)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="listener-window">Match window (min)</Label>
            <Input
              id="listener-window"
              type="number"
              min={1}
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(Number(e.target.value))}
            />
          </div>
          <Button onClick={register} disabled={busy}>
            Register device
          </Button>
        </div>

        {secret ? (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="font-medium">Pairing details — shown once</p>
            <p className="mt-1 break-all text-muted-foreground">
              Device ID: <span className="font-mono">{secret.deviceId}</span>
            </p>
            <p className="break-all text-muted-foreground">
              Pairing secret: <span className="font-mono">{secret.secret}</span>
            </p>
            <p className="mt-1 text-muted-foreground">
              Endpoint: <span className="font-mono">{LISTENER_ENDPOINT_PATH}</span>
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setSecret(null)}>
              I saved it
            </Button>
          </div>
        ) : null}

        {status.devices.length === 0 ? (
          <EmptyState
            title="No listener device paired"
            description="Cash In approval keeps using the configured amount, receiving number and reference."
          />
        ) : (
          <div className="space-y-3">
            {status.devices.map((device) => {
              const state = deviceStateLabel(device);
              return (
                <div key={device.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{device.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {device.ecosystem_name ?? "All shops"} · window {device.match_window_minutes} min
                      </p>
                    </div>
                    <StatusBadge tone={state.tone} label={state.label} />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                    <div>
                      <dt>Last seen</dt>
                      <dd className="text-foreground">{when(device.last_seen_at)}</dd>
                    </div>
                    <div>
                      <dt>Last notification</dt>
                      <dd className="text-foreground">{when(device.last_event_at)}</dd>
                    </div>
                    <div>
                      <dt>Readable events</dt>
                      <dd className="text-foreground">
                        {device.accepted_events} ({device.unparsed_events} unreadable)
                      </dd>
                    </div>
                    <div>
                      <dt>Cash Ins corroborated</dt>
                      <dd className="text-foreground">{device.matched_cash_ins}</dd>
                    </div>
                  </dl>
                  {device.status !== "revoked" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      disabled={busy}
                      onClick={() => revoke(device.id, device.label)}
                    >
                      Revoke device
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Recent notifications</p>
          {status.recent_events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing forwarded yet.</p>
          ) : (
            <ul className="space-y-2">
              {status.recent_events.map((event) => (
                <li key={event.id} className="rounded-lg border p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {event.amount_php !== null ? `₱${Number(event.amount_php).toFixed(2)}` : "Unreadable"}
                      {event.sender_name ? ` · ${event.sender_name}` : ""}
                      {event.sender_number ? ` · ${event.sender_number}` : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">{when(event.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{eventResultLabel(event)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

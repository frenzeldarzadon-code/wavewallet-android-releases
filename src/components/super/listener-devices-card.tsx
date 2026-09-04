/**
 * Management for the payment notification listener devices (platform owner
 * and shop admin views share this card).
 *
 * A registered phone forwards the text of every supported payment-app
 * notification it receives (GCash, banks, any app the source rules allow). It
 * is never tied to one receiving account. A notification is corroborating
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
import { formatPairingCode } from "@/lib/listener-pairing-code";
import { resolvePaymentProvider } from "@/lib/payment-providers";

import {
  deviceHealthLine,
  deviceStateLabel,
  eventResultLabel,
  fetchListenerStatus,
  LISTENER_ENDPOINT_PATH,
  registerListenerDevice,
  repairListenerDevice,
  revokeListenerDevice,
  type ListenerStatus,
} from "@/lib/listener-devices";

/** Which payment app's notifications this phone forwards (recognised by package). */
const listensTo = (packageName: string) => {
  const provider = resolvePaymentProvider(packageName);
  return provider
    ? `${provider.name} notifications`
    : `${packageName || "unknown app"} notifications`;
};

const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";

export function ListenerDevicesCard({
  ecosystemId = null,
  ecosystemName,
}: {
  /** Pair phones for one shop only (shop admin view). Null = platform owner. */
  ecosystemId?: string | null;
  ecosystemName?: string | null;
} = {}) {
  const [status, setStatus] = useState<ListenerStatus | null>(null);
  const [label, setLabel] = useState("");
  const [receivingNumber, setReceivingNumber] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ deviceId: string; secret: string } | null>(null);
  const shopScoped = ecosystemId !== null;

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

  const view = status ?? { devices: [], recent_events: [] };

  const register = async () => {
    if (!label.trim()) {
      toast.error("Give the phone a name so you can recognise it later.");
      return;
    }
    setBusy(true);
    try {
      const created = await registerListenerDevice({
        label: label.trim(),
        windowMinutes,
        ecosystemId,
        receivingNumber: receivingNumber.trim() || null,
      });
      setSecret({ deviceId: created.device_id, secret: created.pairing_secret });
      setLabel("");
      setReceivingNumber("");
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

  /** Same phone, brand-new one-time secret. The old credential dies with it. */
  const repair = async (id: string, name: string) => {
    setBusy(true);
    try {
      const issued = await repairListenerDevice(id);
      setSecret({ deviceId: issued.device_id, secret: issued.pairing_secret });
      await load();
      toast.success(`${name} can be paired again`, {
        description: "Enter the new one-time code in the app — it is shown only once.",
      });
    } catch (error) {
      toast.error("Could not re-pair the device", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** Clipboard helper so credentials never have to be transcribed by hand. */
  const copy = async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(done);
    } catch {
      toast.error("Could not copy — select the text and copy it manually.");
    }
  };

  return (
    <Card id="payment-listener" className="shadow-[var(--shadow-card)] scroll-mt-24">
      <CardHeader>
        <CardTitle>Payment notification listener</CardTitle>
        <p className="text-sm text-muted-foreground">
          Register an Android phone that receives the payment notifications for{" "}
          {shopScoped ? (ecosystemName ?? "this shop") : "the platform (Universe Cash In)"}. The
          phone captures every supported payment app allowed in the notification sources (GCash,
          bank apps, …) — it is not paired to one receiving account. Each notification is compared
          with the customer&apos;s uploaded receipt; a Cash In is credited automatically only when
          at least two independent details agree (amount, reference, sending account, …) and the
          receipt was never credited before. Anything unclear waits for manual review, and a
          notification alone never releases credits.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
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
            <Label htmlFor="listener-number">Receiving account (optional note)</Label>
            <Input
              id="listener-number"
              inputMode="numeric"
              placeholder="09XXXXXXXXX (e-wallet) or account number"
              value={receivingNumber}
              onChange={(e) => setReceivingNumber(e.target.value)}
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
        <p className="-mt-3 text-xs text-muted-foreground">
          The receiving account is informational only — it helps you recognise which SIM or account
          the phone carries. Matching does not depend on it: a shop phone only ever matches that
          shop&apos;s Cash Ins, and a platform phone matches platform / Universe Cash Ins for any
          configured collection account. Without any registered phone, Cash Ins stay on manual
          review.
        </p>

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
            <p className="mt-1 text-muted-foreground">
              Tap “Copy both (one paste)” and paste the single value into the ONE WAVE app under
              “Pair device” — it fills in the Device ID and the code for you. Enter these in the ONE
              WAVE app under “Pair device”. A phone that was paired before already knows its Device
              ID and only asks for this one-time code. The code cannot be shown again — use “Re-pair
              this device” to issue a new one.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => copy(secret.deviceId, "Device ID copied")}>
                Copy Device ID
              </Button>
              <Button size="sm" onClick={() => copy(secret.secret, "Pairing code copied")}>
                Copy pairing code
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  copy(
                    formatPairingCode(secret.deviceId, secret.secret),
                    "Device ID and code copied together",
                  )
                }
              >
                Copy both (one paste)
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSecret(null)}>
                I saved it
              </Button>
            </div>
          </div>
        ) : null}

        {view.devices.length === 0 ? (
          <EmptyState
            title="No listener device registered"
            description="Until a phone is registered, every Cash In stays in manual review with the receipt (amount, receiving account and reference) as evidence."
          />
        ) : (
          <div className="space-y-3">
            {view.devices.map((device) => {
              const state = deviceStateLabel(device);
              return (
                <div key={device.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{device.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {device.ecosystem_name ?? "Platform-owned"} ·{" "}
                        {device.receiving_number
                          ? `on ${device.receiving_number}`
                          : "all supported payment apps"}
                        {" · "}
                        {listensTo(device.package_name)}
                        {(device.shops_served ?? 0) > 1
                          ? ` · serves ${device.shops_served} shops`
                          : ""}{" "}
                        · window {device.match_window_minutes} min
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {deviceHealthLine(device)}
                      </p>
                      {device.notification_access === false ? (
                        <p className="text-xs text-destructive">
                          This phone lost Notification Access — re-grant it in Android settings.
                        </p>
                      ) : device.listener_connected === false ? (
                        <p className="text-xs text-destructive">
                          Android disconnected the listener on this phone. Open the app and tap
                          “Reconnect listener”.
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    {device.status !== "revoked" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => revoke(device.id, device.label)}
                      >
                        Revoke device
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => repair(device.id, device.label)}
                    >
                      Re-pair this device
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Recent notifications</p>
          {view.recent_events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing forwarded yet.</p>
          ) : (
            <ul className="space-y-2">
              {view.recent_events.map((event) => (
                <li key={event.id} className="rounded-lg border p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {event.amount_php !== null
                        ? `₱${Number(event.amount_php).toFixed(2)}`
                        : "Unreadable"}
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

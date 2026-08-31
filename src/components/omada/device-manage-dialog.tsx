/**
 * Omada device management drawer — ADMIN ONLY.
 *
 * Everything shown here is read from, or written to, the shop's own connected
 * Omada controller through the server. Only capabilities the controller
 * actually answers are offered: firmware information and online upgrade,
 * adoption, force reprovision, locate (LED), forget, connected clients, and —
 * for access points — per-band radio settings (on/off, channel, channel width
 * and transmit power) using the channel list the AP itself reports.
 *
 * Capabilities the controller does not support for a device are hidden or
 * clearly marked unavailable; no control here is decorative.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { antennaTypeLabel, type AntennaView } from "@/lib/omada-devices";
import {
  getAntennaDetail,
  runAntennaAction,
  updateAntennaRadio,
  type DeviceManagementView,
} from "@/lib/omada-devices.functions";

const BAND_LABEL: Record<string, string> = {
  "2g": "2.4 GHz",
  "5g": "5 GHz",
  "5g1": "5 GHz (1)",
  "5g2": "5 GHz (2)",
  "6g": "6 GHz",
};

/** Channel-width codes as documented by the controller's own API. */
const WIDTHS_2G = [
  { value: "4", label: "Auto (20/40 MHz)" },
  { value: "2", label: "20 MHz" },
  { value: "3", label: "40 MHz" },
];
const WIDTHS_5G = [
  { value: "6", label: "Auto (20/40/80 MHz)" },
  { value: "2", label: "20 MHz" },
  { value: "3", label: "40 MHz" },
  { value: "5", label: "80 MHz" },
  { value: "7", label: "160 MHz" },
];

const POWER_LEVELS = [
  { value: "4", label: "Auto" },
  { value: "0", label: "Low" },
  { value: "1", label: "Medium" },
  { value: "2", label: "High" },
  { value: "3", label: "Custom (keep current dBm)" },
];

/** The AP reports its channel list per radio: 2.4 GHz is radio 0, 5 GHz radio 1. */
function optionsForBand(view: DeviceManagementView, band: string) {
  const wanted = band.startsWith("2") ? "2" : band.startsWith("6") ? "6" : "5";
  return view.channelOptions.filter((o) => (o.band || "").toUpperCase().startsWith(wanted));
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="break-all text-right text-sm font-medium">{value}</span>
    </div>
  );
}

export function DeviceManageDialog({
  device,
  ecosystemId,
  open,
  onOpenChange,
  onChanged,
}: {
  device: AntennaView;
  ecosystemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<DeviceManagementView | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);
  const [draft, setDraft] = useState<
    Record<string, { radioEnable: boolean; channel: string; width: string; power: string }>
  >({});

  const isAp = device.deviceType.toLowerCase() === "ap";
  const pendingAdoption =
    device.statusCode === 2 ||
    (device.detailStatusCode !== null && device.detailStatusCode >= 20 && device.detailStatusCode <= 25);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const result = await getAntennaDetail({
        data: { ecosystemId, mac: device.mac, deviceType: device.deviceType },
      });
      setView(result);
      const next: typeof draft = {};
      for (const r of result.radios) {
        next[r.band] = {
          radioEnable: r.radioEnable,
          channel: r.channel ?? "0",
          width: r.channelWidth ?? "",
          power: r.txPowerLevel === null ? "" : String(r.txPowerLevel),
        };
      }
      setDraft(next);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "The controller did not answer.");
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, device.mac, device.deviceType]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const act = async (
    key: string,
    action: "locate-on" | "locate-off" | "force-provision" | "forget" | "upgrade" | "adopt",
    message: string,
  ) => {
    setBusy(key);
    try {
      await runAntennaAction({ data: { ecosystemId, mac: device.mac, action } });
      toast.success(message);
      onChanged();
      if (action === "forget") onOpenChange(false);
      else await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The controller refused that.");
    } finally {
      setBusy(null);
    }
  };

  const saveRadio = async (band: string) => {
    const d = draft[band];
    if (!d) return;
    const options = view ? optionsForBand(view, band) : [];
    const picked = options.find((o) => o.channel === d.channel);
    setBusy(`radio-${band}`);
    try {
      const result = await updateAntennaRadio({
        data: {
          ecosystemId,
          mac: device.mac,
          updates: [
            {
              band: band as "2g" | "5g" | "5g1" | "5g2" | "6g",
              radioEnable: d.radioEnable,
              ...(d.radioEnable && d.channel ? { channel: d.channel } : {}),
              ...(d.radioEnable && picked?.freq ? { freq: picked.freq } : {}),
              ...(d.radioEnable && d.width ? { channelWidth: d.width } : {}),
              ...(d.radioEnable && d.power ? { txPowerLevel: Number(d.power) } : {}),
            },
          ],
        },
      });
      setView((v) => (v ? { ...v, radios: result.radios } : v));
      toast.success("Radio settings saved to the controller.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The controller refused that change.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{device.name}</DialogTitle>
          <DialogDescription>
            {antennaTypeLabel(device.deviceType)} · {device.mac}
          </DialogDescription>
        </DialogHeader>

        {failure ? <p className="text-sm text-destructive">{failure}</p> : null}
        {loading && !view ? (
          <p className="text-sm text-muted-foreground">Reading the controller…</p>
        ) : null}

        {view ? (
          <Tabs defaultValue={isAp ? "radio" : "clients"}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5">
              {isAp ? (
                <TabsTrigger value="radio" className="h-9 flex-auto px-3 text-xs">
                  Wireless
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="clients" className="h-9 flex-auto px-3 text-xs">
                Clients
              </TabsTrigger>
              <TabsTrigger value="firmware" className="h-9 flex-auto px-3 text-xs">
                Firmware
              </TabsTrigger>
              <TabsTrigger value="actions" className="h-9 flex-auto px-3 text-xs">
                Actions
              </TabsTrigger>
            </TabsList>

            {isAp ? (
              <TabsContent value="radio" className="mt-4 space-y-4">
                {view.radioError ? (
                  <p className="text-sm text-muted-foreground">
                    This device does not expose radio settings to the controller API.
                  </p>
                ) : null}
                {view.radios.length === 0 && !view.radioError ? (
                  <p className="text-sm text-muted-foreground">
                    The controller reports no configurable radios for this device.
                  </p>
                ) : null}
                {view.radios.map((r) => {
                  const d = draft[r.band];
                  if (!d) return null;
                  const options = optionsForBand(view, r.band);
                  const widths = r.band.startsWith("2") ? WIDTHS_2G : WIDTHS_5G;
                  return (
                    <div key={r.band} className="space-y-3 rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{BAND_LABEL[r.band] ?? r.band}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Radio on</span>
                          <Switch
                            checked={d.radioEnable}
                            onCheckedChange={(v) =>
                              setDraft((s) => ({ ...s, [r.band]: { ...d, radioEnable: v } }))
                            }
                          />
                        </div>
                      </div>

                      {d.radioEnable ? (
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Select
                            value={d.channel}
                            onValueChange={(v) =>
                              setDraft((s) => ({ ...s, [r.band]: { ...d, channel: v } }))
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Channel" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">Auto channel</SelectItem>
                              {options.map((o) => (
                                <SelectItem key={`${o.band}-${o.channel}`} value={o.channel}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={d.width}
                            onValueChange={(v) =>
                              setDraft((s) => ({ ...s, [r.band]: { ...d, width: v } }))
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Channel width" />
                            </SelectTrigger>
                            <SelectContent>
                              {widths.map((w) => (
                                <SelectItem key={w.value} value={w.value}>
                                  {w.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={d.power}
                            onValueChange={(v) =>
                              setDraft((s) => ({ ...s, [r.band]: { ...d, power: v } }))
                            }
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Transmit power" />
                            </SelectTrigger>
                            <SelectContent>
                              {POWER_LEVELS.map((p) => (
                                <SelectItem key={p.value} value={p.value}>
                                  {p.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}

                      <p className="text-[11px] text-muted-foreground">
                        Controller now: channel {r.channel ?? "—"}
                        {r.freq ? ` (${r.freq} MHz)` : ""} ·{" "}
                        {r.txPower === null ? "power unknown" : `${r.txPower} dBm`}
                      </p>

                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => void saveRadio(r.band)}
                      >
                        {busy === `radio-${r.band}` ? "Saving…" : "Save to controller"}
                      </Button>
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground">
                  Changing a radio briefly interrupts everyone connected on that band.
                </p>
              </TabsContent>
            ) : null}

            <TabsContent value="clients" className="mt-4 space-y-2">
              {view.clientsError ? (
                <p className="text-sm text-muted-foreground">
                  The controller did not return a client list for this device.
                </p>
              ) : null}
              {view.clients.length === 0 && !view.clientsError ? (
                <p className="text-sm text-muted-foreground">Nobody is connected right now.</p>
              ) : null}
              {view.clients.map((c) => (
                <div
                  key={c.mac}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {c.mac}
                      {c.ssid ? ` · ${c.ssid}` : ""}
                      {c.channel ? ` · ch ${c.channel}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline">{c.wireless ? "Wi-Fi" : "Wired"}</Badge>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="firmware" className="mt-4 space-y-3">
              {view.firmwareError ? (
                <p className="text-sm text-muted-foreground">
                  The controller does not report firmware information for this device.
                </p>
              ) : null}
              {view.firmware ? (
                <div className="rounded-lg border px-3">
                  <Row label="Installed" value={view.firmware.current} />
                  <Row
                    label="Latest available"
                    value={view.firmware.latest ?? "None reported by the controller"}
                  />
                </div>
              ) : null}
              {view.firmware?.releaseLog ? (
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
                  {view.firmware.releaseLog}
                </p>
              ) : null}
              {view.firmware?.updateAvailable ? (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void act("upgrade", "upgrade", "Firmware upgrade started.")}
                >
                  {busy === "upgrade" ? "Starting…" : "Upgrade now"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No newer firmware is offered for this device.
                </p>
              )}
            </TabsContent>

            <TabsContent value="actions" className="mt-4 space-y-3">
              {pendingAdoption ? (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={busy !== null}
                  onClick={() => void act("adopt", "adopt", "Adoption started.")}
                >
                  {busy === "adopt" ? "Adopting…" : "Adopt this device"}
                </Button>
              ) : null}
              {view.adopt && view.adopt.errorCode !== null && view.adopt.errorCode !== 0 ? (
                <p className="text-sm text-warning">
                  Last adoption attempt failed (code {view.adopt.errorCode}).
                </p>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void act("locate-on", "locate-on", "The device LED is flashing.")}
                >
                  {busy === "locate-on" ? "Sending…" : "Flash LED"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void act("locate-off", "locate-off", "LED flashing stopped.")}
                >
                  {busy === "locate-off" ? "Sending…" : "Stop flashing"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="sm:col-span-2"
                  disabled={busy !== null}
                  onClick={() =>
                    void act("force-provision", "force-provision", "Reprovision started.")
                  }
                >
                  {busy === "force-provision" ? "Sending…" : "Force reprovision"}
                </Button>
              </div>

              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                disabled={busy !== null}
                onClick={() => setConfirmForget(true)}
              >
                Remove from the controller
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Removing returns the device to its factory-managed state and takes it off this
                shop's site. Its WaveWallet assignment history is kept.
              </p>
            </TabsContent>
          </Tabs>
        ) : null}

        <AlertDialog open={confirmForget} onOpenChange={setConfirmForget}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {device.name} from the controller?</AlertDialogTitle>
              <AlertDialogDescription>
                The device stops serving this site and has to be adopted again to come back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>No</AlertDialogCancel>
              <AlertDialogAction onClick={() => void act("forget", "forget", "Device removed.")}>
                Yes, remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

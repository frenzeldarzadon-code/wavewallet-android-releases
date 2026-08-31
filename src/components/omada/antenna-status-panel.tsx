/**
 * Antenna Status.
 *
 * Admin view: every antenna the shop's controller manages, with assignment and
 * restart. Member view: only the antennas assigned to that member, which they
 * may restart. Both views read the controller live on the server; permissions
 * are re-checked there, never only here.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  antennaTypeLabel,
  healthTone,
  uplinkLabel,
  type AntennaView,
} from "@/lib/omada-devices";
import {
  assignAntenna,
  listAntennaAssignees,
  listMyAntennas,
  listShopAntennas,
  rebootAntenna,
  unassignAntenna,
  type AntennaList,
  type ShopMemberOption,
} from "@/lib/omada-devices.functions";
import { DeviceManageDialog } from "./device-manage-dialog";


function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function when(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function AntennaCard({
  device,
  manage,
  members,
  ecosystemId,
  onAssign,
  onUnassign,
  onReboot,
  onChanged,
}: {
  device: AntennaView;
  manage: boolean;
  members: ShopMemberOption[];
  ecosystemId: string | null | undefined;
  onAssign: (mac: string, userId: string) => Promise<void>;
  onUnassign: (mac: string) => Promise<void>;
  onReboot: (mac: string) => Promise<void>;
  onChanged: () => void;
}) {
  const [choice, setChoice] = useState(device.assignedUserId ?? "");
  const [busy, setBusy] = useState<null | "assign" | "unassign" | "reboot">(null);
  const [confirm, setConfirm] = useState(false);
  const [managing, setManaging] = useState(false);


  useEffect(() => setChoice(device.assignedUserId ?? ""), [device.assignedUserId]);

  const run = async (kind: "assign" | "unassign" | "reboot", fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{device.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {antennaTypeLabel(device.deviceType)} · {device.mac}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Badge variant="outline" className={healthTone[device.health]}>
            {device.statusLabel}
          </Badge>
          {manage ? (
            <Badge variant={device.assignedUserId ? "secondary" : "outline"}>
              {device.assignedUserId ? `Assigned · ${device.assignedUserName}` : "Not assigned"}
            </Badge>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Detail label="Model" value={device.model} />
        <Detail label="Connection" value={uplinkLabel(device.detailStatusCode)} />
        <Detail label="Local address" value={device.ip} />
        <Detail label="Public address" value={device.publicIp} />
        <Detail label="Uptime" value={device.uptime} />
        <Detail label="Firmware" value={device.firmware} />
        <Detail label="Serial" value={device.serial} />
        <Detail label="Last seen" value={when(device.lastSeen)} />
        <Detail
          label="Processor use"
          value={device.cpuPercent === null ? null : `${device.cpuPercent}%`}
        />
        <Detail
          label="Memory use"
          value={device.memoryPercent === null ? null : `${device.memoryPercent}%`}
        />
        <Detail label="Assigned to" value={device.assignedUserName} />
      </dl>

      {device.missingFromController ? (
        <p className="text-xs text-muted-foreground">
          This antenna is no longer listed by the controller. The assignment is kept so nothing is
          lost.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {manage ? (
          <>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="h-9 w-full sm:w-64">
                <SelectValue placeholder="Assign to a member" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name} · {m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null || !choice || choice === device.assignedUserId}
              onClick={() => void run("assign", () => onAssign(device.mac, choice))}
            >
              {busy === "assign" ? "Saving…" : device.assignedUserId ? "Reassign" : "Assign"}
            </Button>
            {device.assignedUserId ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void run("unassign", () => onUnassign(device.mac))}
              >
                {busy === "unassign" ? "Removing…" : "Unassign"}
              </Button>
            ) : null}
          </>
        ) : null}

        {device.missingFromController ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => setConfirm(true)}
          >
            {busy === "reboot" ? "Restarting…" : "Restart"}
          </Button>
        )}

        {manage && ecosystemId && !device.missingFromController ? (
          <Button size="sm" variant="outline" onClick={() => setManaging(true)}>
            Manage device
          </Button>
        ) : null}
      </div>

      {manage && ecosystemId && !device.missingFromController ? (
        <DeviceManageDialog
          device={device}
          ecosystemId={ecosystemId}
          open={managing}
          onOpenChange={setManaging}
          onChanged={onChanged}
        />
      ) : null}



      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart {device.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone connected through this antenna loses their connection for a minute or two
              while it starts up again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run("reboot", () => onReboot(device.mac))}>
              Yes, restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AntennaStatusPanel({
  ecosystemId,
  manage = false,
}: {
  ecosystemId?: string | null;
  manage?: boolean;
}) {
  const [state, setState] = useState<AntennaList | null>(null);
  const [members, setMembers] = useState<ShopMemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ecosystemId) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure(null);
    try {
      const result = manage
        ? await listShopAntennas({ data: { ecosystemId } })
        : await listMyAntennas({ data: { ecosystemId } });
      setState(result);
      if (manage) setMembers(await listAntennaAssignees({ data: { ecosystemId } }));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not read the antennas.");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, manage]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    if (!ecosystemId) return;
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">{manage ? "Device status" : "Antenna status"}</CardTitle>
          <CardDescription>
            {manage
              ? "Every device this shop's controller manages — access points, routers and switches — whether or not it is assigned. Assign a device to a member so they can watch and restart it themselves."
              : "The antennas assigned to you in this shop."}
          </CardDescription>
          {manage && state && state.devices.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {state.devices.length} device{state.devices.length === 1 ? "" : "s"} ·{" "}
              {state.devices.filter((d) => d.assignedUserId).length} assigned ·{" "}
              {state.devices.filter((d) => !d.assignedUserId).length} unassigned
            </p>
          ) : null}
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {failure ? <p className="text-sm text-destructive">{failure}</p> : null}
        {state && !state.configured ? (
          <p className="text-sm text-muted-foreground">
            This shop has no hotspot controller connected yet.
          </p>
        ) : null}
        {state?.error ? (
          <p className="text-sm text-destructive">
            The controller could not be reached: {state.error}
          </p>
        ) : null}
        {state && state.configured && state.devices.length === 0 && !state.error ? (
          <p className="text-sm text-muted-foreground">
            {manage
              ? "The controller reports no managed devices on this shop's site."
              : "No antenna is assigned to you yet. Ask your shop admin to assign one."}
          </p>
        ) : null}
        {state?.devices.map((device) => (
          <AntennaCard
            key={device.mac}
            device={device}
            manage={manage}
            members={members}
            ecosystemId={ecosystemId}
            onChanged={() => void load()}

            onAssign={(mac, userId) =>
              act("Antenna assigned.", () =>
                assignAntenna({
                  data: {
                    ecosystemId: ecosystemId!,
                    mac,
                    userId,
                    deviceName: device.name,
                    deviceType: device.deviceType,
                  },
                }),
              )
            }
            onUnassign={(mac) =>
              act("Antenna unassigned.", () => unassignAntenna({ data: { ecosystemId: ecosystemId!, mac } }))
            }
            onReboot={(mac) =>
              act("Restart sent to the antenna.", () =>
                rebootAntenna({ data: { ecosystemId: ecosystemId!, mac } }),
              )
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

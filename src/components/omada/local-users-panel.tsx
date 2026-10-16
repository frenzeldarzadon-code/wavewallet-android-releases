/**
 * Omada local users for this shop: search, add a user, add GB, extend expiry.
 * Omada stays in charge of logins and access — this panel never disconnects,
 * disables, deletes or resets anyone.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  addOmadaLocalUserQuota,
  createOmadaLocalUser,
  listOmadaLocalUsers,
  setOmadaLocalUserExpiry,
  type LocalUsersResult,
} from "@/lib/omada-local-users.functions";
import type { LocalUserView } from "@/lib/omada-local-users";
import { formatData } from "@/lib/omada-voucher-view";

const fmtDate = (ms: number | null) =>
  ms === null ? "—" : new Date(ms).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LocalUsersPanel({ ecosystemId }: { ecosystemId: string | null }) {
  const [data, setData] = useState<LocalUsersResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      setData(await listOmadaLocalUsers({ data: { ecosystemId } }));
    } catch (e) {
      toast.error(err(e));
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const users = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = data?.users ?? [];
    return s ? list.filter((u) => u.userName.toLowerCase().includes(s)) : list;
  }, [data, q]);

  if (!ecosystemId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Local users</CardTitle>
        <CardDescription>
          Omada local users on this shop's controller. You can add users, add data, or extend expiry. Omada still
          decides who can sign in — nothing here disconnects, disables or deletes anyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data && !data.supported ? (
          <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
            {data.reason ?? "Local users aren't available on this controller."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Search username"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </Button>
              <Button onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Add user"}</Button>
            </div>
            {adding && data ? (
              <CreateForm
                ecosystemId={ecosystemId}
                portals={data.portals}
                onDone={() => {
                  setAdding(false);
                  void load();
                }}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              {data ? `${users.length} of ${data.users.length} users` : "Loading…"}
            </p>
            <ul className="space-y-2">
              {users.map((u) => (
                <li key={u.id} className="rounded-xl border border-border p-3 text-sm">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 text-left"
                    onClick={() => setOpen(open === u.id ? null : u.id)}
                  >
                    <span className="truncate font-medium">{u.userName}</span>
                    <span className="flex shrink-0 gap-1">
                      {!u.enabled ? <Badge variant="secondary">Disabled on Omada</Badge> : null}
                      {u.expired ? <Badge variant="destructive">Expired</Badge> : null}
                    </span>
                  </button>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-muted-foreground">
                    <dt>Data</dt>
                    <dd className="text-right tabular-nums">
                      {u.limited && u.limitBytes !== null
                        ? `${u.remainingBytes ? formatData(u.remainingBytes) : "0 GB"} left of ${formatData(u.limitBytes)}`
                        : "Unlimited"}
                    </dd>
                    <dt>Expires</dt>
                    <dd className="text-right">{fmtDate(u.expiresAt)}</dd>
                    {u.downKbps || u.upKbps ? (
                      <>
                        <dt>Speed</dt>
                        <dd className="text-right">
                          ↓{u.downKbps ? `${u.downKbps / 1024} Mbps` : "—"} ↑{u.upKbps ? `${u.upKbps / 1024} Mbps` : "—"}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  {open === u.id ? (
                    <UserActions
                      ecosystemId={ecosystemId}
                      user={u}
                      onChanged={(next) =>
                        setData((d) => (d ? { ...d, users: d.users.map((x) => (x.id === next.id ? next : x)) } : d))
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UserActions({
  ecosystemId,
  user,
  onChanged,
}: {
  ecosystemId: string;
  user: LocalUserView;
  onChanged: (u: LocalUserView) => void;
}) {
  const [gb, setGb] = useState("");
  const [days, setDays] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ ok: boolean; user: LocalUserView; usageDropped?: boolean }>, okMsg: string) => {
    setBusy(true);
    try {
      const r = await fn();
      onChanged(r.user);
      if (!r.ok) toast.error("Omada didn't save the change. Nothing else was touched.");
      else if (r.usageDropped) toast.warning(`${okMsg} Note: Omada lowered this user's used-data counter.`);
      else toast.success(okMsg);
    } catch (e) {
      toast.error(err(e));
    } finally {
      setBusy(false);
    }
  };

  const gbNum = Number(gb);
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {user.limited ? (
        <div className="space-y-1">
          <Label htmlFor={`gb-${user.id}`}>Add data (GB)</Label>
          <div className="flex gap-2">
            <Input id={`gb-${user.id}`} inputMode="decimal" value={gb} onChange={(e) => setGb(e.target.value)} placeholder="e.g. 5" />
            <Button
              disabled={busy || !(gbNum > 0)}
              onClick={() =>
                void run(() => addOmadaLocalUserQuota({ data: { ecosystemId, userId: user.id, addGb: gbNum } }), `Added ${gbNum} GB.`)
              }
            >
              Add
            </Button>
          </div>
          {gbNum > 0 && user.limitBytes !== null ? (
            <p className="text-xs text-muted-foreground">
              Cap {formatData(user.limitBytes)} → {formatData(user.limitBytes + gbNum * 1024 ** 3)}; unused data is kept.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Unlimited data on Omada — no cap to add to.</p>
      )}
      <div className="space-y-1">
        <Label htmlFor={`days-${user.id}`}>Extend expiry by days</Label>
        <div className="flex gap-2">
          <Input id={`days-${user.id}`} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="e.g. 30" />
          <Button
            disabled={busy || !(Number(days) > 0)}
            onClick={() =>
              void run(
                () => setOmadaLocalUserExpiry({ data: { ecosystemId, userId: user.id, change: { mode: "extend", days: Number(days) } } }),
                `Extended by ${days} days.`,
              )
            }
          >
            Extend
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`date-${user.id}`}>Or set a later expiry date</Label>
        <div className="flex gap-2">
          <Input
            id={`date-${user.id}`}
            type="datetime-local"
            value={date}
            min={toLocalInput(Math.max(Date.now(), user.expiresAt ?? 0))}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button
            disabled={busy || !date}
            onClick={() =>
              void run(
                () =>
                  setOmadaLocalUserExpiry({
                    data: { ecosystemId, userId: user.id, change: { mode: "set", at: new Date(date).getTime() } },
                  }),
                "Expiry updated.",
              )
            }
          >
            Set
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateForm({
  ecosystemId,
  portals,
  onDone,
}: {
  ecosystemId: string;
  portals: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [days, setDays] = useState("30");
  const [gb, setGb] = useState("");
  const [devices, setDevices] = useState("1");
  const [down, setDown] = useState("");
  const [up, setUp] = useState("");
  const [picked, setPicked] = useState<string[]>(portals.length === 1 ? [portals[0]!.id] : []);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await createOmadaLocalUser({
        data: {
          ecosystemId,
          user: {
            userName,
            password,
            portals: picked,
            expiresAt: Date.now() + Number(days) * 86_400_000,
            quotaGb: gb ? Number(gb) : null,
            maxUsers: Number(devices) || 1,
            downKbps: down ? Number(down) * 1024 : null,
            upKbps: up ? Number(up) * 1024 : null,
          },
        },
      });
      toast.success(`Created ${userName}. Share the password with them now — it isn't shown again.`);
      onDone();
    } catch (e) {
      toast.error(err(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label>Username</Label><Input value={userName} onChange={(e) => setUserName(e.target.value)} /></div>
        <div><Label>Password</Label><Input value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div><Label>Valid for (days)</Label><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></div>
        <div><Label>Data cap (GB, empty = unlimited)</Label><Input inputMode="decimal" value={gb} onChange={(e) => setGb(e.target.value)} /></div>
        <div><Label>Devices at once</Label><Input inputMode="numeric" value={devices} onChange={(e) => setDevices(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Down Mbps</Label><Input inputMode="decimal" value={down} onChange={(e) => setDown(e.target.value)} /></div>
          <div><Label>Up Mbps</Label><Input inputMode="decimal" value={up} onChange={(e) => setUp(e.target.value)} /></div>
        </div>
      </div>
      <div>
        <Label>Portals</Label>
        {portals.length === 0 ? (
          <p className="text-xs text-muted-foreground">Couldn't read this controller's portals, so new users can't be added yet.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-2">
            {portals.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant={picked.includes(p.id) ? "default" : "outline"}
                onClick={() => setPicked((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
              >
                {p.name}
              </Button>
            ))}
          </div>
        )}
      </div>
      <Button disabled={busy || !userName || !password || picked.length === 0} onClick={() => void submit()}>
        {busy ? "Creating…" : "Create user"}
      </Button>
    </div>
  );
}

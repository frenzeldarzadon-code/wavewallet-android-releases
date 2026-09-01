/**
 * Per-shop Omada controller connection.
 *
 * Each shop admin configures their OWN controller. The Client Secret is sent
 * once to the server, encrypted there and never sent back to the browser, and
 * no shop can read another shop's connection.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import {
  disconnectOmada,
  getOmadaConnection,
  saveOmadaConnection,
  testOmadaConnection,
  type OmadaConnectionView,
} from "@/lib/omada.functions";
import type { ProbeReport } from "@/lib/omada.server";

export function OmadaConnectionCard({ ecosystemId }: { ecosystemId: string | null }) {
  const [conn, setConn] = useState<OmadaConnectionView | null>(null);
  const [form, setForm] = useState({
    baseUrl: "",
    omadacId: "",
    clientId: "",
    clientSecret: "",
    siteName: "",
    hotspotOperatorUser: "",
    hotspotOperatorPassword: "",
  });
  const [busy, setBusy] = useState<"" | "save" | "test" | "disconnect">("");
  const [report, setReport] = useState<ProbeReport | null>(null);

  useEffect(() => {
    if (!ecosystemId) return;
    void getOmadaConnection({ data: { ecosystemId } })
      .then((c) => {
        setConn(c);
        setForm({
          baseUrl: c.baseUrl,
          omadacId: c.omadacId,
          clientId: c.clientId,
          clientSecret: "",
          siteName: c.siteName,
        });
      })
      .catch(() => setConn(null));
  }, [ecosystemId]);

  if (!ecosystemId) return null;

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setBusy("save");
    try {
      const saved = await saveOmadaConnection({ data: { ecosystemId, ...form } });
      setConn(saved);
      setForm((f) => ({ ...f, clientSecret: "" }));
      setReport(null);
      toast.success("Omada details saved for your shop.");
    } catch (e) {
      toast.error("Could not save", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const next = await testOmadaConnection({ data: { ecosystemId } });
      setReport(next);
      const fresh = await getOmadaConnection({ data: { ecosystemId } });
      setConn(fresh);
      if (next.ok) toast.success("Connected to your Omada controller.");
      else toast.error("Connection failed", { description: next.error ?? undefined });
    } catch (e) {
      toast.error("Connection test failed", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await disconnectOmada({ data: { ecosystemId } });
      setConn(null);
      setReport(null);
      setForm({ baseUrl: "", omadacId: "", clientId: "", clientSecret: "", siteName: "" });
      toast.success("Omada controller disconnected.");
    } catch (e) {
      toast.error("Could not disconnect", { description: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const status = conn?.lastStatus ?? "untested";

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span>Omada integration</span>
          <StatusBadge
            tone={status === "connected" ? "success" : status === "failed" ? "danger" : "muted"}
          >
            {status === "connected" ? "Connected" : status === "failed" ? "Failed" : "Not tested"}
          </StatusBadge>
        </CardTitle>
        <CardDescription>
          Connect your own Omada controller. These details belong to your shop only — no other
          shop and no platform-wide setting is used. Your Client Secret is stored encrypted on
          the server and is never shown again. Your controller must use a valid HTTPS
          certificate for its address.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="omadaUrl">Omada interface access address</Label>
            <Input
              id="omadaUrl"
              placeholder="https://controller.example.com:8043"
              value={form.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="omadacId">Omada ID</Label>
            <Input
              id="omadacId"
              value={form.omadacId}
              onChange={(e) => set({ omadacId: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="omadaSite">Site name (optional)</Label>
            <Input
              id="omadaSite"
              value={form.siteName}
              onChange={(e) => set({ siteName: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="omadaClientId">Client ID</Label>
            <Input
              id="omadaClientId"
              value={form.clientId}
              onChange={(e) => set({ clientId: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="omadaClientSecret">Client Secret</Label>
            <Input
              id="omadaClientSecret"
              type="password"
              autoComplete="off"
              placeholder={conn?.hasClientSecret ? "Stored — leave blank to keep" : ""}
              value={form.clientSecret}
              onChange={(e) => set({ clientSecret: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy !== ""} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : "Save details"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== "" || !conn?.configured}
            onClick={() => void test()}
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </Button>
          {conn?.configured ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== ""}
              onClick={() => void disconnect()}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : null}
        </div>

        {conn?.lastCheckedAt ? (
          <p className="text-[11px] text-muted-foreground">
            Last checked {new Date(conn.lastCheckedAt).toLocaleString()}
            {conn.lastError ? ` — ${conn.lastError}` : ""}
          </p>
        ) : null}

        {report ? (
          <ul className="space-y-2">
            {report.steps.map((step) => (
              <li key={step.step} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{step.step}</span>
                  <StatusBadge tone={step.ok ? "success" : "danger"}>
                    {step.ok ? "Passed" : "Failed"}
                  </StatusBadge>
                </div>
                <p className="mt-1 break-words text-xs text-muted-foreground">{step.detail}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

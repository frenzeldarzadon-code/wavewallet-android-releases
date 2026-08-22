/**
 * Configurable notification sources for the payment listener.
 *
 * A source rule decides whether the listener may read notifications from one
 * Android app at all. Disabled sources are filtered on arrival: nothing is
 * read, nothing is stored beyond the app identity, and they can never become
 * payment candidates.
 *
 * Scope is enforced on the server: a shop admin only ever sees and edits rules
 * for their own shop and their own paired phones; the platform owner manages
 * platform-wide defaults too.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, EmptyState } from "@/components/ui-kit";
import { providerName } from "@/lib/payment-providers";
import {
  deleteListenerSourceRule,
  fetchListenerSourceRules,
  setListenerSourceRule,
  type ListenerSourceRule,
} from "@/lib/listener-devices";

export function ListenerSourceRulesCard({
  ecosystemId = null,
  ecosystemName,
}: {
  /** Shop admin view: rules for this shop only. Null = platform owner. */
  ecosystemId?: string | null;
  ecosystemName?: string | null;
} = {}) {
  const [rules, setRules] = useState<ListenerSourceRule[]>([]);
  const [packageName, setPackageName] = useState("");
  const [mode, setMode] = useState<"allow" | "deny">("deny");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setRules(await fetchListenerSourceRules(ecosystemId));
    } catch {
      setRules([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecosystemId]);

  const save = async () => {
    if (!packageName.trim()) {
      toast.error("Enter the app id (package name), for example com.globe.gcash.android.");
      return;
    }
    setBusy(true);
    try {
      await setListenerSourceRule({
        packageName: packageName.trim(),
        mode,
        ecosystemId,
        note: note.trim() || null,
      });
      setPackageName("");
      setNote("");
      await load();
      toast.success(mode === "deny" ? "Source disabled" : "Source enabled");
    } catch (error) {
      toast.error("Could not save the source rule", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: ListenerSourceRule) => {
    setBusy(true);
    try {
      await deleteListenerSourceRule(rule.id);
      await load();
      toast.success(`Rule for ${rule.package_name} removed`);
    } catch (error) {
      toast.error("Could not remove the rule", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const scopeLabel = (rule: ListenerSourceRule) =>
    rule.device_label
      ? `This phone: ${rule.device_label}`
      : rule.ecosystem_name
        ? `Shop: ${rule.ecosystem_name}`
        : "Platform-wide default";

  return (
    <Card id="listener-sources" className="shadow-[var(--shadow-card)] scroll-mt-24">
      <CardHeader>
        <CardTitle>Notification sources</CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose which apps the listener on{" "}
          {ecosystemId ? (ecosystemName ?? "this shop") : "any paired phone"} may read. With no
          rules saved every source is allowed, so existing phones keep working exactly as before. A
          disabled source is filtered the moment it arrives — nothing is read from it and it can
          never settle a Cash In.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="source-package">App id (package name)</Label>
            <Input
              id="source-package"
              placeholder="com.globe.gcash.android or *"
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-mode">Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "allow" | "deny")}>
              <SelectTrigger id="source-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deny">Disabled</SelectItem>
                <SelectItem value="allow">Enabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source-note">Why (optional)</Label>
            <Input
              id="source-note"
              placeholder="Chat app, never a payment"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button onClick={save} disabled={busy}>
            Save rule
          </Button>
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          Use <span className="font-mono">*</span> to disable every app, then add an “Enabled” rule
          for each payment app you trust. The most specific rule wins: a rule for one phone beats a
          shop rule, and a shop rule beats the platform default.
        </p>

        {rules.length === 0 ? (
          <EmptyState
            title="No source rules"
            description="Every notification source is allowed. Recognised payment apps are processed; anything else is recorded as not a payment app."
          />
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <p className="font-mono text-sm">{rule.package_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {scopeLabel(rule)}
                    {rule.provider_id ? ` · ${providerName(rule.provider_id)}` : ""}
                    {rule.note ? ` · ${rule.note}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={rule.mode === "allow" ? "success" : "danger"}>
                    {rule.mode === "allow" ? "Enabled" : "Disabled"}
                  </StatusBadge>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => remove(rule)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

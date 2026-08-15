/**
 * Platform-owner control for automatic Cash In approval.
 *
 * The switch is deliberately powerless on its own: automatic approval only ever
 * settles a request when an authorised payment feed has delivered a matching
 * verified transaction. With no feed connected, everything stays in the manual
 * queue — screenshots are never accepted as proof of payment.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui-kit";
import {
  DEFAULT_AUTO_RULE,
  fetchCashInAutoStatus,
  feedStatusLabel,
  setCashInAutoApproval,
  type CashInAutoStatus,
} from "@/lib/cash-in-auto";

export function CashInAutoCard() {
  const [status, setStatus] = useState<CashInAutoStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [rule, setRule] = useState(DEFAULT_AUTO_RULE);

  const load = async () => {
    const next = await fetchCashInAutoStatus();
    setStatus(next);
    setRule({
      enabled: next.platform_rule?.enabled ?? false,
      require_reference_match: next.platform_rule?.require_reference_match ?? true,
      amount_tolerance_php: Number(next.platform_rule?.amount_tolerance_php ?? 0),
      max_auto_amount_php: next.platform_rule?.max_auto_amount_php ?? null,
    });
  };

  useEffect(() => {
    void load().catch(() => {});
  }, []);

  if (!status) return null;

  const banner = feedStatusLabel(status);

  const save = async (next: typeof rule) => {
    if (!Number.isFinite(next.amount_tolerance_php) || next.amount_tolerance_php < 0) {
      toast.error("The amount tolerance must be zero or more.");
      return;
    }
    setSaving(true);
    try {
      await setCashInAutoApproval({
        ecosystemId: null,
        enabled: next.enabled,
        requireReference: next.require_reference_match,
        tolerance: next.amount_tolerance_php,
        maxAmount: next.max_auto_amount_php,
      });
      setRule(next);
      toast.success(
        next.enabled
          ? "Automatic approval is on. Only verified payments from a connected feed can settle a request."
          : "Automatic approval is off. Every cash in waits for manual review.",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Automatic cash in approval</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{banner.title}</p>
            <StatusBadge tone={banner.tone === "success" ? "success" : "warning"}>
              {status.connected ? "Connected" : "Not connected"}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{banner.detail}</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {status.sources.map((s) => (
              <li key={s.provider}>
                {s.label}: {s.status === "connected" ? "receiving payments" : "no authorised feed"}
                {s.last_event_at ? ` · last payment ${new Date(s.last_event_at).toLocaleString()}` : ""}
                {s.last_error ? ` · ${s.last_error}` : ""}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="auto-cash-in">Approve matching cash ins automatically</Label>
            <p className="text-xs text-muted-foreground">
              A request settles only when a verified payment matches its amount and reference. Anything unmatched stays
              pending for you.
            </p>
          </div>
          <Switch
            id="auto-cash-in"
            checked={rule.enabled}
            disabled={saving}
            onCheckedChange={(v) => void save({ ...rule, enabled: v })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="auto-tolerance">Amount tolerance (₱)</Label>
            <Input
              id="auto-tolerance"
              type="number"
              min={0}
              step="0.01"
              value={rule.amount_tolerance_php}
              onChange={(e) => setRule({ ...rule, amount_tolerance_php: Number(e.target.value) })}
            />
            <p className="mt-1 text-xs text-muted-foreground">Keep at 0 to require the exact amount.</p>
          </div>
          <div>
            <Label htmlFor="auto-max">Automatic limit (₱, blank = no limit)</Label>
            <Input
              id="auto-max"
              type="number"
              min={0}
              step="1"
              value={rule.max_auto_amount_php ?? ""}
              onChange={(e) =>
                setRule({ ...rule, max_auto_amount_php: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">Larger payments always go to manual review.</p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="auto-ref">Require a matching payment reference</Label>
            <p className="text-xs text-muted-foreground">
              Strongly recommended. Without it, amount alone decides the match.
            </p>
          </div>
          <Switch
            id="auto-ref"
            checked={rule.require_reference_match}
            disabled={saving}
            onCheckedChange={(v) => setRule({ ...rule, require_reference_match: v })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={saving} onClick={() => void save(rule)}>
            {saving ? "Saving…" : "Save matching rules"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Auto-approved in the last 30 days: {status.auto_approved_30d} · unmatched verified payments:{" "}
            {status.unmatched_payments}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

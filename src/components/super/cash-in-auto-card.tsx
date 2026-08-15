/**
 * Platform-owner control for automatic Cash In approval.
 *
 * Automatic approval rests entirely on *configured* matching data: the amount,
 * the shop's receiving GCash number, a never-used payment reference and an
 * attached screenshot. Nothing here contacts GCash, and a screenshot is never
 * treated as proof that a payment happened — it is kept as supporting evidence
 * for audit and manual review.
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
  matchingStatusLabel,
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
      amount_tolerance_php: Number(next.platform_rule?.amount_tolerance_php ?? 0),
      max_auto_amount_php: next.platform_rule?.max_auto_amount_php ?? null,
      expected_amount_php: next.platform_rule?.expected_amount_php ?? null,
    });
  };

  useEffect(() => {
    void load().catch(() => {});
  }, []);

  if (!status) return null;

  const banner = matchingStatusLabel({ ...status, platform_rule: { ...rule, ecosystem_id: null } });

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
        tolerance: next.amount_tolerance_php,
        maxAmount: next.max_auto_amount_php,
        expectedAmount: next.expected_amount_php,
      });
      setRule(next);
      toast.success(
        next.enabled
          ? "Automatic approval is on. Only requests that match the configured details are settled."
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
              {rule.enabled ? "On" : "Off"}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{banner.detail}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Shops with a receiving GCash number configured: {status.shops_with_number}
          </p>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="auto-cash-in">Approve matching cash ins automatically</Label>
            <p className="text-xs text-muted-foreground">
              A request settles only when the amount, the shop's receiving GCash number and a brand new payment
              reference all match and a screenshot is attached. Anything else stays pending for you.
            </p>
          </div>
          <Switch
            id="auto-cash-in"
            checked={rule.enabled}
            disabled={saving}
            onCheckedChange={(v) => void save({ ...rule, enabled: v })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="auto-expected">Expected amount (₱, blank = any)</Label>
            <Input
              id="auto-expected"
              type="number"
              min={0}
              step="0.01"
              value={rule.expected_amount_php ?? ""}
              onChange={(e) =>
                setRule({ ...rule, expected_amount_php: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">Set this to auto-approve one fixed amount only.</p>
          </div>
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

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={saving} onClick={() => void save(rule)}>
            {saving ? "Saving…" : "Save matching rules"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Auto-approved in the last 30 days: {status.auto_approved_30d} · duplicate references blocked:{" "}
            {status.duplicates_blocked_30d}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

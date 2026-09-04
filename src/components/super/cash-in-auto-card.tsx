/**
 * Platform-owner control for automatic Cash In approval.
 *
 * Automatic approval rests entirely on *configured* matching data: the amount,
 * the receiving account the member paid, a never-used payment reference and an
 * attached screenshot. Nothing here contacts any e-wallet or bank, and a screenshot is never
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
  recheckPendingCashIns,
  setCashInAuthFields,
  setCashInAutoApproval,
  type CashInAutoStatus,
} from "@/lib/cash-in-auto";

export function CashInAutoCard() {
  const [status, setStatus] = useState<CashInAutoStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [rule, setRule] = useState(DEFAULT_AUTO_RULE);

  const load = async () => {
    const next = await fetchCashInAutoStatus();
    setStatus(next);
    setRule({
      enabled: next.platform_rule?.enabled ?? false,
      amount_tolerance_php: Number(next.platform_rule?.amount_tolerance_php ?? 0),
      max_auto_amount_php: next.platform_rule?.max_auto_amount_php ?? null,
      expected_amount_php: next.platform_rule?.expected_amount_php ?? null,
      require_listener_match: next.platform_rule?.require_listener_match ?? true,
      require_receipt_match: next.platform_rule?.require_receipt_match ?? true,
      verification_mode: next.platform_rule?.verification_mode ?? "staged",
      layer1_require_amount: true,
      layer1_require_sender_number: next.platform_rule?.layer1_require_sender_number ?? true,
      layer1_require_time_window: false,
      layer2_require_amount_match: next.platform_rule?.layer2_require_amount_match ?? true,
      layer2_require_sender_match: next.platform_rule?.layer2_require_sender_match ?? true,
      layer2_require_listener_reference: false,
    });
  };

  useEffect(() => {
    void load().catch(() => {});
  }, []);

  if (!status) return null;

  const banner = matchingStatusLabel({ ...status, platform_rule: { ...rule, ecosystem_id: null } });
  const listenerActive = status.listener_devices_active ?? 0;
  const listenerProven = status.listener_devices_proven ?? 0;
  const listenerReady = listenerProven > 0;

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
        requireListener: next.require_listener_match ?? true,
        requireReceipt: next.require_receipt_match ?? true,
        verificationMode: next.verification_mode ?? "staged",
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

  /** Saves one authentication-field toggle. Amount and duplicate checks stay on. */
  const saveFields = async (next: typeof rule) => {
    setSaving(true);
    try {
      await setCashInAuthFields({
        ecosystemId: null,
        layer1SenderNumber: next.layer1_require_sender_number ?? true,
        layer2AmountMatch: next.layer2_require_amount_match ?? true,
        layer2SenderMatch: next.layer2_require_sender_match ?? true,
        requireReceipt: next.require_receipt_match ?? true,
      });
      setRule(next);
      toast.success("Authentication rules saved and recorded in the audit log.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const recheck = async () => {
    setRechecking(true);
    try {
      const r = await recheckPendingCashIns();
      toast.success("Pending cash ins re-checked", {
        description: `${r.events_checked} payment(s) re-examined · ${r.linked} newly linked · ${r.approved} approved by the rules.`,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not re-check.");
    } finally {
      setRechecking(false);
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
            Shops with a receiving account number configured: {status.shops_with_number}
          </p>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="auto-cash-in">Approve matching cash ins automatically</Label>
            <p className="text-xs text-muted-foreground">
              A request settles only when the amount, the receiving account the member paid (shop or
              platform) and a brand new payment reference all match and a screenshot is attached.
              Anything else stays pending for you.
            </p>
          </div>
          <Switch
            id="auto-cash-in"
            checked={rule.enabled}
            disabled={saving}
            onCheckedChange={(v) => void save({ ...rule, enabled: v })}
          />
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="auto-listener">
                First layer — a listener phone must confirm the payment
              </Label>
              <p className="text-xs text-muted-foreground">
                A cash in is only settled automatically if a paired phone saw a matching
                notification. A phone paired to one shop can only settle that shop's requests, and
                platform phones settle Universe / platform requests; the receiving number printed in
                the notification is informational and never blocks approval.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Paired phones ready: {listenerProven} of {listenerActive} active ·{" "}
                {status.listener_matches_30d ?? 0} confirmed payments in the last 30 days
              </p>
              {(status.listener_devices_unscoped ?? 0) > 0 ? (
                <p className="mt-1 text-xs text-destructive">
                  {status.listener_devices_unscoped} paired phone(s) have no receiving account set —
                  they will never match anything until you set one.
                </p>
              ) : null}
              {(status.shared_numbers ?? []).length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Shared receiving numbers:{" "}
                  {(status.shared_numbers ?? [])
                    .map((s) => `${s.number} (${s.shops} shops)`)
                    .join(", ")}{" "}
                  — matching stays per shop, and anything ambiguous goes to manual review.
                </p>
              ) : null}
              {!listenerReady ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Pair a phone and send one test notification first to unlock this.
                </p>
              ) : null}
            </div>
            <Switch
              id="auto-listener"
              checked={rule.require_listener_match ?? true}
              disabled={saving || (!listenerReady && !(rule.require_listener_match ?? true))}
              onCheckedChange={(v) => void save({ ...rule, require_listener_match: v })}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="auto-receipt">
                Second layer — the reference must match the receipt
              </Label>
              <p className="text-xs text-muted-foreground">
                The reference read from the uploaded screenshot must agree with the reference the
                member typed. A mismatch always blocks automatic approval; switching this off only
                relaxes the case where the receipt could not be read at all.
              </p>
            </div>
            <Switch
              id="auto-receipt"
              checked={rule.require_receipt_match ?? true}
              disabled={saving}
              onCheckedChange={(v) => void save({ ...rule, require_receipt_match: v })}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 space-y-3">
          <div>
            <p className="font-semibold">Required authentication details</p>
            <p className="text-xs text-muted-foreground">
              Choose exactly which details each layer must confirm. The received amount is always
              required and a payment reference can never be used twice — those two cannot be
              switched off. Change these only if a payment app changes what its notifications show.
              Every change is written to the audit log.
            </p>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="l1-amount">First layer · amount received</Label>
              <p className="text-xs text-muted-foreground">Always required.</p>
            </div>
            <Switch id="l1-amount" checked disabled />
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="l1-sender">First layer · sending number / account</Label>
              <p className="text-xs text-muted-foreground">
                The notification must show which number or account sent the money.
              </p>
            </div>
            <Switch
              id="l1-sender"
              checked={rule.layer1_require_sender_number ?? true}
              disabled={saving}
              onCheckedChange={(v) => void saveFields({ ...rule, layer1_require_sender_number: v })}
            />
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="l2-amount">Second layer · submitted amount must match</Label>
              <p className="text-xs text-muted-foreground">
                The amount on the request must equal the amount the phone confirmed.
              </p>
            </div>
            <Switch
              id="l2-amount"
              checked={rule.layer2_require_amount_match ?? true}
              disabled={saving}
              onCheckedChange={(v) => void saveFields({ ...rule, layer2_require_amount_match: v })}
            />
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="l2-sender">
                Second layer · receipt sender must match the notification
              </Label>
              <p className="text-xs text-muted-foreground">
                The sending number on the payment screenshot must equal the number the phone
                reported.
              </p>
            </div>
            <Switch
              id="l2-sender"
              checked={rule.layer2_require_sender_match ?? true}
              disabled={saving}
              onCheckedChange={(v) => void saveFields({ ...rule, layer2_require_sender_match: v })}
            />
          </div>

          <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            First layer reads only what the payment app's notification actually reports (GCash
            today, any app allowed in the notification sources): the sending number and the amount.
            Transaction time is not used, and no reference number is expected from the notification.
            Second layer reads the payment screenshot for the sender, the receiving account, the
            amount, the reference and the transaction date and time. The reference and date/time are
            then checked against every shop on the platform — any earlier use holds the cash in for
            manual review.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Legacy · deprecated rules (read-only)</p>
            <StatusBadge tone="muted">Not active</StatusBadge>
          </div>
          <p className="text-xs text-muted-foreground">
            These rules are retired. They cannot be switched on and the backend ignores any old
            stored value.
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">
                Receiving-number (destination) match
              </span>{" "}
              — retired. A masked or differently formatted receiving number is informational only.
              Shop isolation still applies: a phone paired to one shop can only settle that shop's
              Cash In.
            </li>
            <li>
              <span className="font-medium text-foreground">Require reference match flag</span> —
              retired. Reference uniqueness and duplicate/replay protection are always enforced and
              cannot be switched off.
            </li>
          </ul>
          {(status.mismatched_devices ?? []).length > 0 ? (
            <p className="text-xs text-muted-foreground">
              For information only, {(status.mismatched_devices ?? []).length} shop receiving
              number(s) differ from the nearest paired phone. This no longer prevents automatic
              approval.
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor="auto-active">Verification mode — active settlement</Label>
              <p className="text-xs text-muted-foreground">
                Staged runs every check on live payments and records the result, but never settles a
                request. Turn this on to let matching cash ins settle automatically.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Currently {(rule.verification_mode ?? "staged") === "active" ? "active" : "staged"}{" "}
                · {status.staged_30d ?? 0} request(s) would have been approved while staged in the
                last 30 days.
              </p>
            </div>
            <Switch
              id="auto-active"
              checked={(rule.verification_mode ?? "staged") === "active"}
              disabled={saving}
              onCheckedChange={(v) =>
                void save({ ...rule, verification_mode: v ? "active" : "staged" })
              }
            />
          </div>
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
                setRule({
                  ...rule,
                  expected_amount_php: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Set this to auto-approve one fixed amount only.
            </p>
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
            <p className="mt-1 text-xs text-muted-foreground">
              Keep at 0 to require the exact amount.
            </p>
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
                setRule({
                  ...rule,
                  max_auto_amount_php: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Larger payments always go to manual review.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={saving} onClick={() => void save(rule)}>
            {saving ? "Saving…" : "Save matching rules"}
          </Button>
          <Button size="sm" variant="outline" disabled={rechecking} onClick={() => void recheck()}>
            {rechecking ? "Re-checking…" : "Re-check pending cash ins"}
          </Button>

          <p className="text-xs text-muted-foreground">
            Auto-approved in the last 30 days: {status.auto_approved_30d} · duplicate references
            blocked: {status.duplicates_blocked_30d}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

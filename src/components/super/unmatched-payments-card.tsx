/**
 * Incoming GCash payments that have not been attached to a Cash In yet.
 *
 * Every notification the paired phone forwards is stored before any matching
 * is attempted, so a real payment is always visible here even when the member
 * has not submitted a Cash In yet. Linking a payment is evidence only — it
 * never credits a wallet and never changes lineage, cashback or fees.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, StatusBadge } from "@/components/ui-kit";
import { providerName } from "@/lib/payment-providers";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { maskAccountNumber } from "@/lib/cash-in-receipt";
import {
  dismissListenerEvent,
  fetchUnmatchedListenerEvents,
  linkListenerEvent,
  type UnmatchedListenerEvent,
} from "@/lib/listener-devices";
import { ManualRecoveryDialog } from "./manual-recovery-dialog";


const line = (label: string, value: string) => (
  <p key={label} className="text-muted-foreground">
    <span className="font-medium text-foreground">{label}:</span> {value}
  </p>
);

const when = (value: string | null | undefined) => (value ? shortDateTime(value) : "not recorded");

const resultLabel = (event: UnmatchedListenerEvent) => {
  if (event.outcome === "unparsed") return "Amount could not be read";
  switch (event.match_result) {
    case "ambiguous":
      return "Several possible Cash Ins";
    case "device_without_receiving_number":
      return "Phone has no receiving number set";
    case "wrong_shop":
      return "That phone is paired to a different shop";
    case "destination_mismatch":
      return "Receiving number looked different (informational — not a failure)";
    case "no_pending_match":
      return "No matching Cash In yet";
    default:
      return "Waiting for review";
  }
};

export function UnmatchedPaymentsCard() {
  const [events, setEvents] = useState<UnmatchedListenerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await fetchUnmatchedListenerEvents());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load incoming payments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const link = async (event: UnmatchedListenerEvent, cashInId: string) => {
    setBusy(event.id);
    try {
      await linkListenerEvent(event.id, cashInId, note[event.id]);
      toast.success("Payment attached. The Cash In still needs approval.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not attach that payment");
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (event: UnmatchedListenerEvent) => {
    setBusy(event.id);
    try {
      await dismissListenerEvent(event.id, note[event.id]);
      toast.success("Payment set aside. Nothing was credited.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not set that payment aside");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Incoming payments awaiting review</CardTitle>
        <div className="flex items-center gap-2">
          <ManualRecoveryDialog onRecorded={() => void load()} />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Money received on a paired phone that no Cash In has claimed yet. Nothing here has touched
          a wallet. A Cash In is only attached automatically when at least two independent details
          agree — the amount on its own is never enough.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <EmptyState title="Nothing waiting" description="Every received payment has been accounted for." />
        ) : (
          events.map((event) => (
            <div key={event.id} className="space-y-3 rounded-lg border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {event.amount_php == null ? "Amount unknown" : peso(Number(event.amount_php))}
                </p>
                <div className="flex items-center gap-2">
                  <StatusBadge tone="muted">
                    {event.provider_id
                      ? providerName(event.provider_id)
                      : (event.app_label ?? "Unrecognised app")}
                  </StatusBadge>
                  <StatusBadge tone="warning">{resultLabel(event)}</StatusBadge>
                </div>
              </div>
              {line("Payment reference", event.gcash_reference ?? "not reported")}
              {line("Paid from", maskAccountNumber(event.sender_number))}
              {line("Payer name", event.sender_name ?? "not reported")}
              {line("Received", when(event.posted_at ?? event.created_at))}
              {line("Listener phone", event.device_label)}
              {line("Receiving number", maskAccountNumber(event.receiving_number))}
              {line("Shop", event.ecosystem_name ?? "all shops on this number")}

              <div className="space-y-2">
                <p className="font-medium text-foreground">Attach to a pending Cash In</p>
                {event.candidates.length === 0 ? (
                  <p className="text-muted-foreground">
                    No pending Cash In on this receiving number yet. This payment stays here until one
                    arrives.
                  </p>
                ) : (
                  event.candidates.map((candidate) => (
                    <div
                      key={candidate.cash_in_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-2"
                    >
                      <span className="text-muted-foreground">
                        {peso(Number(candidate.amount_php))} ·{" "}
                        {candidate.member_handle ? `@${candidate.member_handle}` : (candidate.member_name ?? "member")}{" "}
                        · {candidate.ecosystem_name ?? "shop"} · {shortDateTime(candidate.created_at)}
                        <span className="ml-1 text-foreground">
                          ·{" "}
                          {candidate.auto_matchable
                            ? `${candidate.signals ?? 0} details agree`
                            : `${candidate.signals ?? 0} detail${(candidate.signals ?? 0) === 1 ? "" : "s"} agree — needs your review`}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        disabled={busy === event.id}
                        onClick={() => void link(event, candidate.cash_in_id)}
                      >
                        Attach
                      </Button>
                    </div>
                  ))
                )}
              </div>


              <Input
                value={note[event.id] ?? ""}
                placeholder="Note for the audit log (optional)"
                onChange={(e) => setNote((prev) => ({ ...prev, [event.id]: e.target.value }))}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={busy === event.id}
                onClick={() => void dismiss(event)}
              >
                Set aside
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

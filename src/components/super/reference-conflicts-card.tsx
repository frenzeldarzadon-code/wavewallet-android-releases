/**
 * Duplicate GCash reference review.
 *
 * When a new Cash In arrives with a reference an older transaction already
 * used, nothing is credited and nothing older is touched. The two transactions
 * are shown side by side here so a human can decide what really happened.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, StatusBadge } from "@/components/ui-kit";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  creditedFirstLabel,
  fetchReferenceConflicts,
  maskAccountNumber,
  resolveReferenceConflict,
  verificationStatus,
  RECEIPT_CHECK_LABEL,
  type ConflictSnapshot,
  type ReceiptCheck,
  type ReferenceConflict,
} from "@/lib/cash-in-receipt";

const line = (label: string, value: string) => (
  <p key={label} className="text-muted-foreground">
    <span className="font-medium text-foreground">{label}:</span> {value}
  </p>
);

const when = (value: string | null | undefined) => (value ? shortDateTime(value) : "not recorded");

function Side({ title, snap, creditedFirst }: { title: string; snap: ConflictSnapshot | null; creditedFirst: boolean }) {
  if (!snap) {
    return (
      <div className="rounded-lg border border-border p-3 text-xs">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground">That transaction is no longer available.</p>
      </div>
    );
  }
  return (
    <div className={`rounded-lg border p-3 text-xs ${creditedFirst ? "border-success" : "border-border"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <div className="flex flex-wrap gap-1">
          {creditedFirst ? <StatusBadge tone="success">CREDITED FIRST</StatusBadge> : null}
          <StatusBadge tone={verificationStatus(snap) === "VERIFIED" ? "success" : "warning"}>
            {verificationStatus(snap)}
          </StatusBadge>
          <StatusBadge tone={snap.status === "approved" ? "success" : snap.status === "rejected" ? "danger" : "warning"}>
            {snap.status ?? "unknown"}
          </StatusBadge>
        </div>
      </div>
      {line("Cash in", snap.reference ?? snap.cash_in_id)}
      {line("Transaction id", snap.cash_in_id)}
      {line("Submitted reference", snap.submitted_reference ?? snap.payment_reference ?? "not provided")}
      {line("Reference on receipt", snap.receipt_reference ?? "not read")}
      {line("Receipt check", RECEIPT_CHECK_LABEL[(snap.receipt_check as ReceiptCheck) ?? "pending"])}
      {line("Receipt read", when(snap.receipt_read_at))}
      {line("Amount", snap.amount_php == null ? "unknown" : peso(Number(snap.amount_php)))}
      {line("Credits", snap.credits == null ? "unknown" : Number(snap.credits).toLocaleString())}
      {line("Paid from", maskAccountNumber(snap.sender_number))}
      {line("Payer name", snap.sender_name ?? "not reported")}
      {line("Receiving shop", snap.shop_name ?? "unknown")}
      {line("Receiving number", maskAccountNumber(snap.receiving_number))}
      {line("Credited to", snap.credited_to_name ?? snap.credited_to_user_id ?? "unknown")}
      {line("Reseller involved", snap.reseller_name ?? "none")}
      {line("Approval", snap.approval_method ?? "not approved")}
      {line("Approved by", snap.approved_by_name ?? "not approved")}
      {line("Approved at", when(snap.approved_at))}
      {line("Payment notification seen", when(snap.payment_seen_at))}
      {line("Request submitted", when(snap.requested_at))}
      {line("Reviewed", when(snap.reviewed_at))}
      {line(
        "Coins released",
        snap.credits_released
          ? `${Number(snap.credits_released_amount ?? snap.coins ?? 0).toLocaleString()} coins on ${when(snap.credits_released_at)}`
          : "no coins released",
      )}
      {line("Screenshot", snap.has_screenshot ? "attached to the transaction" : "not attached")}
      {line("Listener event", snap.listener_event_id ?? "none")}
      {line("Ledger entry", snap.ledger_id ?? "none")}
      {line("Audit key", snap.request_key ?? snap.cash_in_id)}
    </div>
  );
}


export function ReferenceConflictsCard() {
  const [rows, setRows] = useState<ReferenceConflict[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchReferenceConflicts("open")
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(load, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          Duplicate reference review
          {rows.length > 0 ? (
            <StatusBadge tone="danger" className="ml-2">
              {rows.length} to investigate
            </StatusBadge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <EmptyState title="No duplicate references" description="Every payment reference so far was used once." />
        ) : (
          rows.map((c) => (
            <div key={c.id} className="space-y-2 rounded-lg border border-destructive/40 p-3">
              <p className="text-sm font-semibold">Reference {c.reference ?? c.reference_key}</p>
              <p className="text-xs text-muted-foreground">{creditedFirstLabel(c)}</p>
              <p className="text-xs text-muted-foreground">
                The newer request was held for manual investigation. The older transaction was not changed.
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                <Side title="Earlier transaction" snap={c.old_snapshot} creditedFirst={c.credited_first === "old"} />
                <Side title="New transaction" snap={c.new_snapshot} creditedFirst={c.credited_first === "new"} />

              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === c.id}
                onClick={() => {
                  const note = window.prompt("What did you conclude about this duplicate reference?") ?? "";
                  setBusy(c.id);
                  resolveReferenceConflict(c.id, note)
                    .then(() => {
                      toast.success("Marked as reviewed.");
                      load();
                    })
                    .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save that."))
                    .finally(() => setBusy(null));
                }}
              >
                Mark reviewed
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

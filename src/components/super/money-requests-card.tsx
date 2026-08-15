/**
 * Platform-owner queues for real-money movement.
 *
 * Approve / reject / release are database-authorized (`review_withdrawal`,
 * `review_cash_in`) — the row is locked and a second decision is refused, so a
 * double click can never pay twice. Each card shows the request's own
 * snapshot: valuation, fee percent, fee amount and net payout as they stood
 * when the member submitted.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, StatusBadge } from "@/components/ui-kit";
import { CashInProofViewer } from "@/components/money/cash-in-proof";
import { RECEIPT_CHECK_LABEL, type ReceiptCheck } from "@/lib/cash-in-receipt";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  fetchAllCashIns,
  fetchAllWithdrawals,
  creditsAfterFee,
  filterByStatus,
  paymentModeLabel,
  pendingMoneyCount,
  reviewCashIn,
  reviewWithdrawal,
  snapshotQuote,
  statusLabel,
  type CashInRequest,
  type WithdrawalRequest,
} from "@/lib/wallet-money";

const FILTERS = ["pending", "approved", "released", "rejected", "all"];
const CASH_IN_FILTERS = ["pending", "approved", "rejected", "all"];

const tone = (s: string) =>
  s === "released" || s === "approved" ? ("success" as const) : s === "pending" ? ("warning" as const) : ("danger" as const);

export function MoneyRequestsCard() {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [cashIns, setCashIns] = useState<CashInRequest[]>([]);
  const [wFilter, setWFilter] = useState("pending");
  const [cFilter, setCFilter] = useState("pending");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [w, c] = await Promise.all([
      fetchAllWithdrawals().catch(() => []),
      fetchAllCashIns().catch(() => []),
    ]);
    setWithdrawals(w);
    setCashIns(c);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      setReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That action failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Card className="mb-6 shadow-[var(--shadow-card)]">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            Cash out requests
            {pendingMoneyCount(withdrawals) > 0 ? (
              <StatusBadge tone="danger" className="ml-2">
                {pendingMoneyCount(withdrawals)} pending
              </StatusBadge>
            ) : null}
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Button key={f} size="sm" variant={wFilter === f ? "default" : "outline"} onClick={() => setWFilter(f)}>
                {f}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Optional note recorded with your decision"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {filterByStatus(withdrawals, wFilter).length === 0 ? (
            <EmptyState title="Nothing here" />
          ) : (
            filterByStatus(withdrawals, wFilter).map((w) => {
              const q = snapshotQuote(w);
              return (
                <div key={w.id} className="rounded-lg border border-border p-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {w.requester_name} · {w.requester_role}
                      </p>
                      <p className="text-muted-foreground">
                        {w.reference} · {Number(w.credits).toLocaleString()} credits
                      </p>
                      <p className="text-muted-foreground">
                        Fee {q.feePercent}% · net payout{" "}
                        <span className="font-semibold text-foreground">
                          {creditsAfterFee(Number(w.credits), q.feePercent).toLocaleString()} credits
                        </span>
                      </p>
                      <p className="text-muted-foreground">
                        {paymentModeLabel(w.payment_mode)}
                        {w.account_name ? ` · ${w.account_name}` : ""}
                        {w.account_number ? ` · ${w.account_number}` : ""}
                      </p>
                      {w.notes ? <p className="text-muted-foreground">Notes: {w.notes}</p> : null}
                      <p className="text-muted-foreground">
                        Requested {shortDateTime(w.created_at)}
                        {w.reviewer_name ? ` · decided by ${w.reviewer_name}` : ""}
                        {w.released_at ? ` · released ${shortDateTime(w.released_at)}` : ""}
                      </p>
                    </div>
                    <StatusBadge tone={tone(w.status)}>{statusLabel(w.status)}</StatusBadge>
                  </div>
                  {w.status === "pending" || w.status === "approved" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {w.status === "pending" ? (
                        <Button
                          size="sm"
                          disabled={busy === w.id}
                          onClick={() => act(w.id, () => reviewWithdrawal(w.id, "approve", reason), "Approved for payout.")}
                        >
                          Approve
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="default"
                        disabled={busy === w.id}
                        onClick={() => {
                          if (!window.confirm(`Confirm you have SENT ${peso(q.net)} to ${w.requester_name}.`)) return;
                          void act(w.id, () => reviewWithdrawal(w.id, "release", reason), "Marked as released.");
                        }}
                      >
                        Mark released
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === w.id}
                        onClick={() =>
                          act(w.id, () => reviewWithdrawal(w.id, "reject", reason), "Rejected — credits returned.")
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="mb-6 shadow-[var(--shadow-card)]">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">
            Cash in requests
            {pendingMoneyCount(cashIns) > 0 ? (
              <StatusBadge tone="danger" className="ml-2">
                {pendingMoneyCount(cashIns)} pending
              </StatusBadge>
            ) : null}
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {CASH_IN_FILTERS.map((f) => (
              <Button key={f} size="sm" variant={cFilter === f ? "default" : "outline"} onClick={() => setCFilter(f)}>
                {f}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {filterByStatus(cashIns, cFilter).length === 0 ? (
            <EmptyState title="Nothing here" />
          ) : (
            filterByStatus(cashIns, cFilter).map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-3 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      {c.requester_name} · {c.requester_role}
                    </p>
                    <p className="text-muted-foreground">
                      {c.reference} · {Number(c.credits).toLocaleString()} credits
                    </p>
                    <p className="text-muted-foreground">
                      {c.method_name}
                      {c.payer_reference ? ` · ref ${c.payer_reference}` : ""} · {shortDateTime(c.created_at)}
                    </p>
                    <p className="text-muted-foreground">
                      Payment reference: {c.payer_reference ? c.payer_reference : "not provided"}
                    </p>
                    <p className="text-muted-foreground">
                      Paid from: {c.sender_number ?? c.payer_number ?? "not provided"} · amount{" "}
                      {peso(Number(c.amount_php))}
                    </p>
                    {c.notes ? (
                      <p className="text-muted-foreground">Additional notes: {c.notes}</p>
                    ) : (
                      <p className="text-muted-foreground">Additional notes: none</p>
                    )}
                    {c.proof_path ? (
                      <CashInProofViewer path={c.proof_path} />
                    ) : (
                      <p className="mt-1 text-muted-foreground">Payment screenshot: not attached</p>
                    )}
                    <p className="text-muted-foreground">
                      Receipt reference read: {c.receipt_reference ? c.receipt_reference : "not read"} ·{" "}
                      {RECEIPT_CHECK_LABEL[(c.receipt_check as ReceiptCheck) ?? "pending"]}
                    </p>
                    {c.duplicate_reference ? (
                      <p className="font-medium text-destructive">
                        This GCash reference was already used — see the duplicate reference review below.
                      </p>
                    ) : null}
                    <p className="text-muted-foreground">
                      {c.listener_event_id
                        ? "Listener phone confirmed a matching GCash notification"
                        : "No listener confirmation for this payment"}
                    </p>
                    {c.status === "approved" ? (
                      <p className="mt-1 text-muted-foreground">
                        {c.approval_method === "automatic"
                          ? `Approved automatically from the configured matching rules${c.auto_match_note ? ` · ${c.auto_match_note}` : ""}`
                          : `Approved manually by ${c.reviewer_name ?? "the platform owner"}`}
                      </p>
                    ) : null}
                  </div>

                  <StatusBadge tone={tone(c.status)}>{statusLabel(c.status)}</StatusBadge>
                </div>
                {c.status === "pending" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy === c.id}
                      onClick={() => {
                        if (!window.confirm(`Confirm you RECEIVED ${peso(Number(c.amount_php))} from ${c.requester_name}.`))
                          return;
                        void act(c.id, () => reviewCashIn(c.id, "approve", reason), "Credits issued.");
                      }}
                    >
                      Approve & issue credits
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === c.id}
                      onClick={() => act(c.id, () => reviewCashIn(c.id, "reject", reason), "Rejected.")}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}

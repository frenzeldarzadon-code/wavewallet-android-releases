/**
 * Shop admin settlement queue.
 *
 * Two things only the shop admin can settle, both strictly inside their own
 * shop and both plain 1:1 credit movements with no fee and nothing minted:
 *
 *  - Cash out (shop): the member's held credits move to the admin once the
 *    admin has handed over the cash in person.
 *  - Cash in (admin GCash): the admin received the real GCash payment, so the
 *    admin's own credits move to the member. The requested amount stays
 *    reserved against the admin's spendable credits until this is decided.
 *
 * Every decision is authorized server side; this screen only shows the queue
 * and forwards approve/reject.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { CashInProofViewer } from "@/components/money/cash-in-proof";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  EMPTY_CAPACITY,
  fetchAdminCashInCapacity,
  fetchShopCashIns,
  fetchShopCashouts,
  reviewAdminCashIn,
  reviewAdminCashout,
  statusLabel,
  type AdminCashInCapacity,
  type CashInRequest,
  type WithdrawalRequest,
} from "@/lib/wallet-money";

const tone = (status: string) =>
  status === "released" || status === "approved"
    ? ("success" as const)
    : status === "pending"
      ? ("warning" as const)
      : ("danger" as const);

export function ShopAdminQueue() {
  const { ecosystemDbId } = useSession();
  const [cashouts, setCashouts] = useState<WithdrawalRequest[]>([]);
  const [cashIns, setCashIns] = useState<CashInRequest[]>([]);
  const [capacity, setCapacity] = useState<AdminCashInCapacity>(EMPTY_CAPACITY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    const [w, c, cap] = await Promise.all([
      fetchShopCashouts(ecosystemDbId).catch(() => []),
      fetchShopCashIns(ecosystemDbId).catch(() => []),
      fetchAdminCashInCapacity(ecosystemDbId).catch(() => EMPTY_CAPACITY),
    ]);
    setCashouts(w);
    setCashIns(c);
    setCapacity(cap);
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (run: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await run();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that decision.");
    } finally {
      setBusy(false);
    }
  };

  const pendingCashouts = cashouts.filter((w) => w.status === "pending");
  const pendingCashIns = cashIns.filter((c) => c.status === "pending");

  return (
    <>
      <PageSection
        title="Settled by you"
        description="Cash you hand over in person, and payments made into your own GCash. No fee is charged on either — the credits simply move inside your shop."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Credits you can still fund"
            value={`${capacity.available.toLocaleString()} credits`}
            icon={Wallet}
            tone="brand"
          />
          <StatCard label="Cash outs waiting" value={String(pendingCashouts.length)} icon={ArrowUpFromLine} />
          <StatCard label="Cash ins waiting" value={String(pendingCashIns.length)} icon={ArrowDownToLine} />
        </div>
        {capacity.reserved > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {capacity.balance.toLocaleString()} credits in your wallet, {capacity.reserved.toLocaleString()} held by cash
            in requests still waiting for your decision.
          </p>
        ) : null}
      </PageSection>

      <PageSection title="Cash out requests to settle">
        {cashouts.length === 0 ? (
          <EmptyState
            title="Nothing to settle"
            description="Members who ask you to hand them cash will appear here."
          />
        ) : (
          <div className="space-y-2">
            {cashouts.map((w) => (
              <Card key={w.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-xs">
                  <div>
                    <p className="text-sm font-semibold">{Number(w.credits).toLocaleString()} credits</p>
                    <p className="text-muted-foreground">
                      {w.reference} · no fee · you pay {peso(Number(w.credits))} in cash
                    </p>
                    <p className="text-muted-foreground">{shortDateTime(w.created_at)}</p>
                    {w.notes ? <p className="text-muted-foreground">Note: {w.notes}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={tone(w.status)}>{statusLabel(w.status)}</StatusBadge>
                    {w.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            decide(
                              () => reviewAdminCashout(w.id, "approve"),
                              "Settled — the credits moved to your wallet.",
                            )
                          }
                        >
                          Settled
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt("Why are you declining this cash out?") ?? "";
                            if (!reason.trim()) return;
                            void decide(
                              () => reviewAdminCashout(w.id, "reject", reason),
                              "Declined — the member's credits were returned.",
                            );
                          }}
                        >
                          Decline
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Cash in paid to your GCash"
        description="Approve only after you can see the payment in your own GCash account. Approving moves your credits to the member."
      >
        {cashIns.length === 0 ? (
          <EmptyState
            title="No cash in requests"
            description="Members who pay into your GCash number will appear here."
          />
        ) : (
          <div className="space-y-2">
            {cashIns.map((c) => (
              <Card key={c.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-2 px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{peso(Number(c.amount_php))}</p>
                      <p className="text-muted-foreground">
                        Ref {c.payer_reference ?? "—"} · paid from {c.payer_number ?? "—"}
                      </p>
                      <p className="text-muted-foreground">{shortDateTime(c.created_at)}</p>
                      {c.decision_reason ? (
                        <p className="text-muted-foreground">Note: {c.decision_reason}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={tone(c.status)}>{statusLabel(c.status)}</StatusBadge>
                      {c.status === "pending" ? (
                        <>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              decide(
                                () => reviewAdminCashIn(c.id, "approve"),
                                "Approved — your credits moved to the member.",
                              )
                            }
                          >
                            Payment received
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt("Why are you declining this cash in?") ?? "";
                              if (!reason.trim()) return;
                              void decide(
                                () => reviewAdminCashIn(c.id, "reject", reason),
                                "Declined — your reserved credits are spendable again.",
                              );
                            }}
                          >
                            Decline
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <CashInProofViewer path={c.proof_path} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>
    </>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { Search, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  adminAdjustCredits,
  commissionBreakdown,
  fetchCommissionRate,
  LEDGER_COLUMNS,
  normalizeEntry,
  type CreditEntry,
} from "@/lib/wallet";
import { adminAdjustPoints } from "@/lib/rewards";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/wallets")({
  head: () => ({
    meta: [
      { title: "Wallet Management — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Search customers and resellers, review credit balances and add credits with a reason, reference and audited transaction ID.",
      },
      { property: "og:title", content: "Wallet Management — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Manage member credit balances and review the full ledger for your shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminWallets,
});

interface Member {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  status: string;
  role: string;
  balance: number;
  points: number;
  commission: number;
  discount: number;
}

function AdminWallets() {
  const { ecosystemDbId } = useSession("admin");
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Member | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState<CreditEntry[]>([]);
  const [mode, setMode] = useState<"credits" | "points">("credits");
  // Rate is read from the database; the server recomputes it on submit.
  const [rate, setRate] = useState(0);

  useEffect(() => {
    if (!target || mode !== "credits") {
      setRate(0);
      return;
    }
    let alive = true;
    void fetchCommissionRate(target.id).then((r) => alive && setRate(r));
    return () => {
      alive = false;
    };
  }, [target, mode]);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    const ecoCommission = await fetchEcosystemCommission(ecosystemDbId);
    const [{ data: profiles }, { data: roles }, { data: accounts }, { data: pointAccounts }, { data: entries }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone, status, reseller_commission_percent, reseller_discount_percent")
          .eq("ecosystem_id", ecosystemDbId),
        supabase.from("user_roles").select("user_id, role").eq("ecosystem_id", ecosystemDbId),
        supabase.from("credit_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
        supabase.from("points_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
        supabase
          .from("credit_ledger")
          .select(LEDGER_COLUMNS)
          .eq("ecosystem_id", ecosystemDbId)
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
    const roleBy = new Map((roles ?? []).map((r) => [r.user_id, r.role as string]));
    const balBy = new Map((accounts ?? []).map((a) => [a.user_id, Number(a.balance)]));
    const ptsBy = new Map((pointAccounts ?? []).map((a) => [a.user_id, Number(a.balance)]));
    setMembers(
      (profiles ?? [])
        .map((p) => ({
          ...p,
          role: roleBy.get(p.id) ?? "customer",
          balance: balBy.get(p.id) ?? 0,
          points: ptsBy.get(p.id) ?? 0,
          // null = no personal override; the shop default is resolved server-side.
          commission: Number(p.reseller_commission_percent ?? ecoCommission),
          discount: Number(p.reseller_discount_percent ?? 0),
        }))
        .filter((m) => m.role !== "admin" && m.role !== "super_admin")
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    );
    setLedger(
      ((entries ?? []) as unknown as CreditEntry[]).map(normalizeEntry),
    );
    setLoading(false);
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemDbId) return null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? members.filter(
        (m) =>
          m.full_name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.phone.includes(q),
      )
    : members;

  const nameFor = (id: string) => members.find((m) => m.id === id)?.full_name ?? id.slice(0, 8);

  const submit = async () => {
    if (!target) return;
    const value = Number(amount);
    if (!value) {
      toast.error("Enter an amount");
      return;
    }
    if (!reason.trim()) {
      toast.error("A reason is required");
      return;
    }
    setBusy(true);
    try {
      const tx =
        mode === "points"
          ? await adminAdjustPoints({
              userId: target.id,
              amount: Math.trunc(value),
              reason,
              ...(reference ? { reference } : {}),
            })
          : await adminAdjustCredits({
              userId: target.id,
              amount: value,
              reason,
              reference,
            });
      toast.success(mode === "points" ? "Points updated" : "Wallet updated", {
        description: `${value > 0 ? "+" : "−"}${
          mode === "points" ? `${Math.abs(Math.trunc(value))} pts` : peso(Math.abs(value))
        } · ${target.full_name} · ${tx}`,
      });
      setTarget(null);
      setAmount("");
      setReason("");
      setReference("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Wallet management"
        description="Add or correct credits for customers and resellers. Every adjustment is audited."
      >
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or mobile"
            />
          </div>
        </div>

        {loading ? (
          <EmptyState title="Loading wallets…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No members found" />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {filtered.map((m) => (
              <Card key={m.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.full_name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {m.email} · {m.phone || "no mobile"}
                    </p>
                    <div className="mt-1 flex gap-1.5">
                      <StatusBadge
                        tone={
                          m.role === "reseller" ? "brand" : m.role === "subreseller" ? "success" : "muted"
                        }
                      >
                        {m.role === "reseller" && m.commission > 0
                          ? `reseller · ${m.commission}% bonus`
                          : m.role === "subreseller"
                            ? `subreseller · ${m.discount}% off`
                            : m.role}
                      </StatusBadge>
                      <StatusBadge tone={m.status === "active" ? "success" : "danger"}>
                        {m.status}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold text-success">{peso(m.balance)}</p>
                    <p className="text-[11px] text-points">{m.points} pts</p>
                    <div className="mt-1 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMode("credits");
                          setTarget(m);
                        }}
                      >
                        <Wallet className="size-4" /> Credits
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMode("points");
                          setTarget(m);
                        }}
                      >
                        Points
                      </Button>
                    </div>
                  </div>

                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Ecosystem credit ledger"
        description="Latest 60 movements across all wallets. Commission bonuses are listed separately."
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Base credits released"
            value={peso(
              ledger
                .filter((e) => e.direction === "debit" && Number(e.commission_amount ?? 0) > 0)
                .reduce((s, e) => s + Number(e.base_amount ?? e.amount), 0),
            )}
            hint="Debited from admin wallets"
          />
          <StatCard
            label="Commission granted"
            value={peso(
              ledger
                .filter((e) => e.direction === "credit")
                .reduce((s, e) => s + Number(e.commission_amount ?? 0), 0),
            )}
            tone="positive"
            hint="Bonus credits to resellers"
          />
          <StatCard
            label="Total received by resellers"
            value={peso(
              ledger
                .filter((e) => e.direction === "credit" && Number(e.commission_amount ?? 0) > 0)
                .reduce((s, e) => s + e.amount, 0),
            )}
            tone="brand"
          />
        </div>
        {ledger.length === 0 ? (
          <EmptyState title="No credit movements yet" />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {ledger.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {nameFor(e.user_id)} · {e.reason}
                    </p>
                    {commissionBreakdown(e) ? (
                      <p className="text-[11px] font-medium text-success">{commissionBreakdown(e)}</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                      {e.reference ? ` · ${e.reference}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={
                        e.direction === "credit"
                          ? "text-sm font-semibold text-success"
                          : "text-sm font-semibold text-destructive"
                      }
                    >
                      {e.direction === "credit" ? "+" : "−"}
                      {peso(e.amount)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Bal {peso(e.balance_after)}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{mode === "points" ? "Adjust points" : "Adjust credits"}</DialogTitle>
            <DialogDescription>
              {target?.full_name} ·{" "}
              {mode === "points"
                ? `${target?.points ?? 0} pts`
                : `current balance ${peso(target?.balance ?? 0)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wamt">Amount (negative to deduct)</Label>
              <Input
                id="wamt"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            {mode === "credits" && rate === 0 && target?.role === "subreseller" ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Subresellers never receive commission — they are credited exactly what you release.
                Their earning is the {target.discount}% voucher discount.
              </div>
            ) : null}
            {mode === "credits" && rate > 0 ? (
              <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs">
                <p className="font-medium text-success">
                  Reseller commission {rate}% applies to this release.
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  Send {peso(Math.max(Number(amount) || 0, 0))} → {target?.full_name} receives{" "}
                  {peso(Math.max(Number(amount) || 0, 0) * (1 + rate / 100))} ({rate}% bonus). You
                  release only {peso(Math.max(Number(amount) || 0, 0))}.
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="wreason">Reason</Label>
              <Input
                id="wreason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Cash top-up at counter"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wref">Reference (optional)</Label>
              <Input
                id="wref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Receipt no."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : "Apply adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

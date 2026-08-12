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
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { adminAdjustCredits, type CreditEntry } from "@/lib/wallet";
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

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: accounts }, { data: entries }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone, status")
          .eq("ecosystem_id", ecosystemDbId),
        supabase.from("user_roles").select("user_id, role").eq("ecosystem_id", ecosystemDbId),
        supabase.from("credit_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
        supabase
          .from("credit_ledger")
          .select("id, direction, amount, balance_after, reason, reference, tx_id, created_at, user_id")
          .eq("ecosystem_id", ecosystemDbId)
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
    const roleBy = new Map((roles ?? []).map((r) => [r.user_id, r.role as string]));
    const balBy = new Map((accounts ?? []).map((a) => [a.user_id, Number(a.balance)]));
    setMembers(
      (profiles ?? [])
        .map((p) => ({
          ...p,
          role: roleBy.get(p.id) ?? "customer",
          balance: balBy.get(p.id) ?? 0,
        }))
        .filter((m) => m.role !== "admin" && m.role !== "super_admin")
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    );
    setLedger(
      ((entries ?? []) as unknown as CreditEntry[]).map((e) => ({
        ...e,
        amount: Number(e.amount),
        balance_after: Number(e.balance_after),
      })),
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
      const tx = await adminAdjustCredits({
        userId: target.id,
        amount: value,
        reason,
        reference,
      });
      toast.success("Wallet updated", {
        description: `${value > 0 ? "+" : "−"}${peso(value)} · ${target.full_name} · ${tx}`,
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
                      <StatusBadge tone={m.role === "reseller" ? "brand" : "muted"}>{m.role}</StatusBadge>
                      <StatusBadge tone={m.status === "active" ? "success" : "danger"}>
                        {m.status}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold text-success">{peso(m.balance)}</p>
                    <Button size="sm" variant="outline" className="mt-1" onClick={() => setTarget(m)}>
                      <Wallet className="size-4" /> Add credits
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection title="Ecosystem credit ledger" description="Latest 60 movements across all wallets.">
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
            <DialogTitle>Adjust credits</DialogTitle>
            <DialogDescription>
              {target?.full_name} · current balance {peso(target?.balance ?? 0)}
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

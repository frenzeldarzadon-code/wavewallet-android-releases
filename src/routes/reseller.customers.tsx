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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { InviteMemberCard } from "@/components/invite-member-card";
import { SubresellersPanel } from "@/components/reseller/subresellers-panel";

import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  fetchCreditBalance,
  fetchCreditLedger,
  lookupRecipient,
  resellerLoadCredits,
  type CreditEntry,
  type RecipientMatch,
} from "@/lib/wallet";
import { toast } from "sonner";

export const Route = createFileRoute("/reseller/customers")({
  head: () => ({
    meta: [
      { title: "Load Customer Coins — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Find a customer in your shop and load coins from your reseller wallet with a confirmed transaction ID.",
      },
      { property: "og:title", content: "Load Customer Coins — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Load coins to customers of your shop from your reseller wallet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerCustomers,
});

function ResellerCustomers() {
  const { account, ecosystem, ecosystemDbId } = useSession("reseller");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<RecipientMatch[] | null>(null);
  const [selected, setSelected] = useState<RecipientMatch | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState<CreditEntry[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    const [b, l] = await Promise.all([
      fetchCreditBalance(userId, ecosystemDbId),
      fetchCreditLedger(userId, ecosystemDbId, 50),
    ]);
    setBalance(b);
    setHistory(l.filter((e) => e.reason === "Coin load to customer"));
  }, [userId, ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystem) return null;

  const value = Number(amount) || 0;
  const invalid = !selected || value <= 0 || value > balance;

  const search = async () => {
    try {
      const res = await lookupRecipient(query);
      setMatches(res);
      setSelected(res[0] ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const tx = await resellerLoadCredits({
        customerId: selected.id,
        amount: value,
        reference,
      });
      toast.success("Coins loaded", { description: `${peso(value)} to ${selected.full_name} · ${tx}` });
      setConfirming(false);
      setAmount("");
      setReference("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isReseller = account.role === "reseller";

  return (
    <>
      <Tabs defaultValue="customers">
        {isReseller ? (
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="customers" className="flex-1">
              Customers
            </TabsTrigger>
            <TabsTrigger value="subresellers" className="flex-1">
              Subresellers
            </TabsTrigger>
          </TabsList>
        ) : null}
        <TabsContent value="customers" className="mt-0">
      <PageSection
        title="Load customer coins"
        description={`Available in your wallet: ${peso(balance)} · any customer in ${ecosystem.name}, plus the subresellers you own.`}
      >

        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cq">Customer or subreseller email / mobile</Label>
              <div className="flex gap-2">
                <Input
                  id="cq"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="customer@email.com or 09xx xxx xxxx"
                  onKeyDown={(e) => e.key === "Enter" && void search()}
                />
                <Button variant="outline" onClick={() => void search()} disabled={query.trim().length < 4}>
                  <Search className="size-4" /> Find
                </Button>
              </div>
              {matches?.length === 0 ? (
                <p className="text-xs text-destructive">
                  No active member matches that. You can load any customer in this shop and the
                  subresellers you own — another reseller's subresellers are blocked by the server.
                </p>
              ) : null}
            </div>

            {matches && matches.length > 0
              ? matches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelected(m)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                      selected?.id === m.id ? "border-primary bg-brand-soft" : "border-border"
                    }`}
                  >
                    <span className="font-medium">{m.full_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.masked_email} · {m.phone}
                    </span>
                  </button>
                ))
              : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="amt">Amount</Label>
                <Input
                  id="amt"
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ref">Reference (optional)</Label>
                <Input
                  id="ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Cash received, GCash ref…"
                />
              </div>
            </div>
            {value > balance ? (
              <p className="text-xs text-destructive">Amount exceeds your reseller balance.</p>
            ) : null}

            <Button className="w-full" disabled={invalid} onClick={() => setConfirming(true)}>
              <Wallet className="size-4" /> Review load
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <InviteMemberCard ecosystemId={ecosystemDbId} />



      <PageSection title="Load history">
        {history.length === 0 ? (
          <EmptyState title="No loads yet" />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {history.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                      {e.reference ? ` · ${e.reference}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-destructive">−{peso(e.amount)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>
        </TabsContent>

        {isReseller ? (
          <TabsContent value="subresellers" className="mt-0">
            <SubresellersPanel balance={balance} onTransferred={load} />
          </TabsContent>
        ) : null}
      </Tabs>



      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm coin load</DialogTitle>
            <DialogDescription>
              This moves coins out of your reseller wallet into the customer's wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-xl border border-border px-3 py-3 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-medium">{selected?.full_name}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold text-destructive">−{peso(value)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Your balance after</span>
              <span className="font-medium">{peso(balance - value)}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "Loading…" : "Load coins"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

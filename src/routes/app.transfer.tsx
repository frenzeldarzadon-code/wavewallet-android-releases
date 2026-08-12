import { createFileRoute } from "@tanstack/react-router";
import { Info, Search, Send } from "lucide-react";
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
import { EmptyState, PageSection } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  fetchCreditBalance,
  fetchCreditLedger,
  lookupRecipient,
  transferCredits,
  type CreditEntry,
  type RecipientMatch,
} from "@/lib/wallet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/transfer")({
  head: () => ({
    meta: [
      { title: "Send Credits — WaveWallet" },
      {
        name: "description",
        content:
          "Transfer credits to another member of your own shop. Atomic, confirmed and recorded with a shared transaction ID.",
      },
      { property: "og:title", content: "Send Credits — WaveWallet" },
      {
        property: "og:description",
        content: "Confirm the recipient and amount, then transfer credits inside your shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerTransfer,
});

function CustomerTransfer() {
  const { account, ecosystem } = useSession("customer");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<RecipientMatch[] | null>(null);
  const [selected, setSelected] = useState<RecipientMatch | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [balance, setBalance] = useState(0);
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    const [b, l] = await Promise.all([fetchCreditBalance(userId), fetchCreditLedger(userId, 50)]);
    setBalance(b);
    setEntries(l.filter((e) => e.reason.toLowerCase().includes("transfer")));
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystem) return null;

  const value = Number(amount) || 0;
  const invalid = value <= 0 || value > balance || !selected;

  const search = async () => {
    try {
      const res = await lookupRecipient(query);
      setMatches(res);
      setSelected(res[0] ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const send = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const tx = await transferCredits({ recipientId: selected.id, amount: value, note });
      toast.success("Transfer sent", {
        description: `${peso(value)} to ${selected.full_name} · ${tx}`,
      });
      setConfirming(false);
      setAmount("");
      setNote("");
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
        title="Send credits"
        description={`Transfers stay inside ${ecosystem.name}. Available: ${peso(balance)}`}
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rq">Recipient email or mobile</Label>
              <div className="flex gap-2">
                <Input
                  id="rq"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="member@email.com or 09xx xxx xxxx"
                  onKeyDown={(e) => e.key === "Enter" && void search()}
                />
                <Button variant="outline" onClick={() => void search()} disabled={query.trim().length < 4}>
                  <Search className="size-4" /> Find
                </Button>
              </div>
              {matches?.length === 0 ? (
                <p className="text-xs text-destructive">
                  No active member of this shop matches that email or mobile.
                </p>
              ) : null}
            </div>

            {matches && matches.length > 0 ? (
              <div className="space-y-2">
                {matches.map((m) => (
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
                ))}
              </div>
            ) : null}

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
              {value > balance ? (
                <p className="text-xs text-destructive">Amount exceeds your balance.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference" />
            </div>

            <p className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Transfers are atomic and appear in both histories with the same transaction ID. Credit
              transfers do not earn points and can never leave this shop.
            </p>

            <Button className="w-full" disabled={invalid} onClick={() => setConfirming(true)}>
              <Send className="size-4" /> Review transfer
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Transfer history">
        {entries.length === 0 ? (
          <EmptyState title="No transfers yet" />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                    </p>
                  </div>
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
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm transfer</DialogTitle>
            <DialogDescription>Check the recipient and amount before sending.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-xl border border-border px-3 py-3 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Recipient</span>
              <span className="font-medium">{selected?.full_name}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold text-destructive">−{peso(value)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Balance after</span>
              <span className="font-medium">{peso(balance - value)}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? "Sending…" : "Send credits"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

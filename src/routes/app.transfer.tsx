import { createFileRoute } from "@tanstack/react-router";
import { Info, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageSection } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { accountsIn, ledgerFor, peso, shortDateTime } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/transfer")({
  head: () => ({
    meta: [
      { title: "Send Credits — WaveWallet" },
      { name: "description", content: "Transfer credits instantly to other members of your ecosystem with a confirmed transaction ID." },
      { property: "og:title", content: "Send Credits — WaveWallet" },
      { property: "og:description", content: "Transfer credits instantly to other members of your ecosystem with a confirmed transaction ID." },
    ],
  }),
  component: CustomerTransfer,
});

function CustomerTransfer() {
  const { account, ecosystem } = useSession("customer");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  if (!account || !ecosystem) return null;

  const recipients = accountsIn(ecosystem.id, "customer").filter((a) => a.id !== account.id);
  const value = Number(amount) || 0;
  const invalid = value <= 0 || value > account.creditBalance || !to;
  const transfers = ledgerFor(account.id).filter((l) => l.kind.startsWith("credit_transfer"));

  return (
    <>
      <PageSection title="Send credits" description={`Transfers stay inside ${ecosystem.name}. Available: ${peso(account.creditBalance)}`}>
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Recipient</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a member of this ecosystem" />
                </SelectTrigger>
                <SelectContent>
                  {recipients.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {r.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount</Label>
              <Input
                id="amt"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
              {value > account.creditBalance ? (
                <p className="text-xs text-destructive">Amount exceeds your balance.</p>
              ) : null}
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Transfers are atomic and appear in both histories with the same transaction ID. Credit
              transfers do not earn points.
            </p>
            <Button
              className="w-full"
              disabled={invalid}
              onClick={() => {
                toast.success("Transfer sent", {
                  description: `${peso(value)} to ${recipients.find((r) => r.id === to)?.name}`,
                });
                setAmount("");
                setTo("");
              }}
            >
              <Send className="size-4" /> Send {value ? peso(value) : "credits"}
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Transfer history">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {transfers.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No transfers yet.</p>
            ) : (
              transfers.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {t.kind === "credit_transfer_out" ? "Sent to" : "Received from"} {t.counterpartyName}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {t.id} · {shortDateTime(t.createdAt)}
                    </p>
                  </div>
                  <p className={t.amount < 0 ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
                    {t.amount < 0 ? "−" : "+"}
                    {peso(t.amount)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>
    </>
  );
}

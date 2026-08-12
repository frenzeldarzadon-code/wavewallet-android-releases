import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { ledgerFor, peso, shortDateTime } from "@/lib/wavewallet";

export const Route = createFileRoute("/app/history")({
  head: () => ({
    meta: [
      { title: "Transaction History — WaveWallet" },
      { name: "description", content: "Complete history of voucher purchases, credit movements and points activity with transaction IDs." },
      { property: "og:title", content: "Transaction History — WaveWallet" },
      { property: "og:description", content: "Complete history of voucher purchases, credit movements and points activity with transaction IDs." },
    ],
  }),
  component: CustomerHistory,
});

const filters = [
  { id: "all", label: "All" },
  { id: "vouchers", label: "Vouchers" },
  { id: "credits", label: "Credits" },
  { id: "points", label: "Points" },
];

function CustomerHistory() {
  const { account } = useSession("customer");
  const [filter, setFilter] = useState("all");
  if (!account) return null;

  const all = ledgerFor(account.id);
  const entries = all.filter((t) => {
    if (filter === "vouchers") return t.kind === "voucher_purchase";
    if (filter === "credits") return t.kind === "credit_load" || t.kind.startsWith("credit_transfer");
    if (filter === "points") return t.kind.startsWith("points");
    return true;
  });

  return (
    <PageSection title="Transaction history" description="Every movement carries a unique transaction ID.">
      <Tabs value={filter} onValueChange={setFilter} className="mb-3">
        <TabsList className="flex w-full flex-wrap justify-start">
          {filters.map((f) => (
            <TabsTrigger key={f.id} value={f.id}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {entries.length === 0 ? (
        <EmptyState title="Nothing here yet" description="Transactions will appear as you use your wallet." />
      ) : (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {entries.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.productName ?? t.kind.replaceAll("_", " ")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.counterpartyName ? `${t.counterpartyName} · ` : ""}
                    {shortDateTime(t.createdAt)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{t.id}</p>
                  {t.voucherCode ? (
                    <p className="mt-1 inline-block rounded bg-muted px-2 py-0.5 font-mono text-[11px]">
                      {t.voucherCode}
                    </p>
                  ) : null}
                  {t.note ? <p className="mt-1 text-[11px] text-muted-foreground">{t.note}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className={t.amount < 0 ? "text-sm font-semibold text-destructive" : "text-sm font-semibold text-success"}>
                    {t.amount < 0 ? "−" : "+"}
                    {t.method === "points" ? `${Math.abs(t.amount)} pts` : peso(t.amount)}
                  </p>
                  <StatusBadge tone={t.method === "points" ? "points" : "brand"} className="mt-1">
                    {t.method}
                  </StatusBadge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </PageSection>
  );
}

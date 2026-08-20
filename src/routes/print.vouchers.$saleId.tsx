/**
 * Print Voucher page.
 *
 * Reads the exact vouchers already issued for one transaction and lays them out
 * as physical 2in x 1.5in cards for the browser's native print dialog.
 * Presentation only — no voucher is generated, consumed or modified here.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui-kit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { voucherPrintCss } from "@/lib/voucher-print-css";
import {
  fetchPrintableSale,
  voucherTemplates,
  type PrintableVoucherSale,
  type VoucherTemplateId,
} from "@/lib/voucher-print";

export const Route = createFileRoute("/print/vouchers/$saleId")({
  head: () => ({
    meta: [
      { title: "Print Vouchers — WaveWallet" },
      {
        name: "description",
        content:
          "Print the vouchers from one WaveWallet purchase as 2in x 1.5in cards, several per sheet, using your own printer.",
      },
      { property: "og:title", content: "Print Vouchers — WaveWallet" },
      {
        property: "og:description",
        content: "Choose a template and print your issued WaveWallet voucher codes at actual size.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrintVouchersPage,
});

function PrintVouchersPage() {
  const { saleId } = Route.useParams();
  const router = useRouter();
  const [sale, setSale] = useState<PrintableVoucherSale | null>(null);
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<VoucherTemplateId>("classic");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchPrintableSale(saleId)
      .then((s) => !cancelled && setSale(s))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [saleId]);

  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.history.back();
    else void router.navigate({ to: "/app/history" });
  };

  return (
    <div className="min-h-screen bg-background">
      <style dangerouslySetInnerHTML={{ __html: voucherPrintCss }} />

      <div className="vp-no-print mx-auto max-w-3xl space-y-4 px-4 py-5">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={back}>
            <ArrowLeft className="size-4" /> Back
          </Button>
          <Button size="sm" disabled={!sale || sale.codes.length === 0} onClick={() => window.print()}>
            <Printer className="size-4" /> Print
          </Button>
        </div>

        <div>
          <h1 className="text-lg font-semibold tracking-tight">Print vouchers</h1>
          {sale ? (
            <p className="text-xs text-muted-foreground">
              {sale.productName} · {sale.codes.length} voucher
              {sale.codes.length === 1 ? "" : "s"} · {sale.txId} ·{" "}
              {shortDateTime(sale.createdAt)}
            </p>
          ) : null}
        </div>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="vp-template">Template</Label>
              <Select
                value={template}
                onValueChange={(v) => setTemplate(v as VoucherTemplateId)}
              >
                <SelectTrigger id="vp-template" className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voucherTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} — {t.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs font-medium text-warning-foreground">
              For accurate voucher size, print at 100% / Actual Size. Do not use Fit to Page.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Each card prints at exactly 2in × 1.5in. Vouchers are arranged several per sheet and
              continue onto more pages automatically. Printing never changes a voucher.
            </p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="vp-no-print mx-auto max-w-3xl px-4 pb-8">
          <EmptyState title="Loading vouchers…" />
        </div>
      ) : !sale || sale.codes.length === 0 ? (
        <div className="vp-no-print mx-auto max-w-3xl px-4 pb-8">
          <EmptyState
            title="No vouchers to print"
            description="This transaction has no voucher codes available to you."
          />
        </div>
      ) : (
        <div className="mx-auto max-w-3xl px-4 pb-10">
          <div className="vp-sheet">
            {sale.codes.map((code, i) => (
              <div key={code} className={`vp-voucher vp-t-${template}`}>
                <div>
                  <p className="vp-brand">WaveWallet</p>
                  <p className="vp-shop">{sale.shopName}</p>
                  <p className="vp-product">{sale.productName}</p>
                </div>
                <div>
                  <p className="vp-code-label">WiFi voucher code</p>
                  <p className="vp-code">{code}</p>
                </div>
                <div className="vp-meta">
                  <span className="vp-price">{peso(sale.listPrice)}</span>
                  <span>
                    {i + 1}/{sale.codes.length} · {sale.txId.slice(0, 10)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

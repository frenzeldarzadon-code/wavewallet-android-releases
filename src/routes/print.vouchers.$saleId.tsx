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
import { peso, shortDateTime } from "@/lib/wavewallet";
import { voucherPrintCss, voucherSelectorCss } from "@/lib/voucher-print-css";
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

/** Keeps even very long codes on one or two readable lines inside 2in x 2in. */
function codeClass(code: string) {
  if (code.length > 18) return "vp-code vp-code-xs";
  if (code.length > 12) return "vp-code vp-code-long";
  return "vp-code";
}

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

  const card = (code: string, i: number, count: number) => (
    <div key={`${code}-${i}`} className={`vp-voucher vp-t-${template}`}>
      <span className="vp-art" aria-hidden />
      <div className="vp-head">
        <p className="vp-brand">WaveWallet</p>
        <p className="vp-shop">{sale?.shopName ?? "WaveWallet"}</p>
        <p className="vp-product">{sale?.productName}</p>
        {sale?.description ? <p className="vp-desc">{sale.description}</p> : null}
      </div>
      <div className="vp-body">
        <p className="vp-code-label">WiFi voucher code</p>
        <p className={codeClass(code)}>{code}</p>
      </div>
      <div className="vp-meta">
        <span className="vp-price">{peso(sale?.listPrice ?? 0)}</span>
        <span>
          {i + 1}/{count} · {(sale?.txId ?? "").slice(0, 10)}
        </span>
      </div>
    </div>
  );

  const sampleCode = sale?.codes[0] ?? "WAVE-2026";

  return (
    <div className="min-h-screen bg-background">
      <style dangerouslySetInnerHTML={{ __html: voucherPrintCss }} />
      <style dangerouslySetInnerHTML={{ __html: voucherSelectorCss }} />

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
            <div className="space-y-2">
              <Label>Template</Label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {voucherTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={template === t.id}
                    aria-label={`${t.name} template`}
                    onClick={() => setTemplate(t.id)}
                    className={`group rounded-xl border p-2 text-left transition-colors ${
                      template === t.id
                        ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="vp-thumb-frame mx-auto">
                      <div className={`vp-voucher vp-t-${t.id}`} aria-hidden>
                        <span className="vp-art" />
                        <div className="vp-head">
                          <p className="vp-brand">WaveWallet</p>
                          <p className="vp-shop">{sale?.shopName ?? "WaveWallet"}</p>
                          <p className="vp-product">{sale?.productName ?? "WiFi Voucher"}</p>
                          {sale?.description ? <p className="vp-desc">{sale.description}</p> : null}
                        </div>
                        <div className="vp-body">
                          <p className="vp-code-label">WiFi voucher code</p>
                          <p className={codeClass(sampleCode)}>{sampleCode}</p>
                        </div>
                        <div className="vp-meta">
                          <span className="vp-price">{peso(sale?.listPrice ?? 0)}</span>
                          <span>1/1</span>
                        </div>
                      </div>
                    </div>
                    <p className="mt-1.5 truncate text-[11px] font-semibold">{t.name}</p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {voucherTemplates.find((t) => t.id === template)?.description}
              </p>
            </div>
            <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs font-medium text-warning-foreground">
              For accurate voucher size, print at 100% / Actual Size. Do not use Fit to Page.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Each card prints at exactly 2in × 2in. Vouchers are arranged several per sheet and
              continue onto more pages automatically. Template choice changes the design only —
              never the voucher data.
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
            {sale.codes.map((code, i) => card(code, i, sale.codes.length))}
          </div>
        </div>
      )}
    </div>
  );
}

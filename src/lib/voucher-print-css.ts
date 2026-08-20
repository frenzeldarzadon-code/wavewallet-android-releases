/**
 * Print stylesheet for physical voucher cards.
 *
 * The card is locked to EXACTLY 2in x 1.5in in both screen preview and print.
 * No transforms, no scaling, no flex growth — only the sheet around the cards
 * reflows so multiple vouchers fill each page.
 */
import { VOUCHER_PRINT_HEIGHT_IN, VOUCHER_PRINT_WIDTH_IN } from "./voucher-print";

const W = `${VOUCHER_PRINT_WIDTH_IN}in`;
const H = `${VOUCHER_PRINT_HEIGHT_IN}in`;

export const voucherPrintCss = `
.vp-sheet {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: flex-start;
  gap: 0.08in;
  background: #ffffff;
}
.vp-voucher {
  width: ${W};
  height: ${H};
  min-width: ${W};
  max-width: ${W};
  min-height: ${H};
  max-height: ${H};
  flex: 0 0 auto;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 0.09in 0.1in;
  border: 1px dashed #94a3b8;
  border-radius: 0.05in;
  background: #ffffff;
  color: #0f172a;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  break-inside: avoid;
  page-break-inside: avoid;
}
.vp-shop { font-size: 7pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.vp-brand { font-size: 5.5pt; letter-spacing: .12em; text-transform: uppercase; opacity: .7; }
.vp-product { font-size: 7.5pt; font-weight: 600; line-height: 1.15; }
.vp-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13pt;
  font-weight: 700;
  letter-spacing: .06em;
  line-height: 1.1;
  word-break: break-all;
  text-align: center;
}
.vp-code-label { font-size: 5pt; letter-spacing: .14em; text-transform: uppercase; text-align: center; opacity: .65; }
.vp-meta { display: flex; justify-content: space-between; gap: .06in; font-size: 5.5pt; opacity: .8; }
.vp-price { font-size: 8pt; font-weight: 700; }

/* Templates change styling only — never the data or the physical size. */
.vp-t-minimal { border: 1px solid #e2e8f0; }
.vp-t-minimal .vp-brand { display: none; }
.vp-t-modern { border: 1px solid #cbd5e1; border-left: 0.06in solid #1d4ed8; }
.vp-t-modern .vp-shop { color: #1d4ed8; }
.vp-t-dark { background: #0b1b34; color: #f8fafc; border: 1px solid #0b1b34; }
.vp-t-dark .vp-code { color: #7dd3fc; }
.vp-t-colorful { border: 1px solid #16a34a; background: linear-gradient(135deg, #eff6ff 0%, #ecfdf5 100%); }
.vp-t-colorful .vp-shop { color: #1d4ed8; }
.vp-t-colorful .vp-price { color: #15803d; }

@page { margin: 0.25in; }

@media print {
  html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }
  .vp-no-print { display: none !important; }
  .vp-sheet { gap: 0.08in; }
  .vp-voucher {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;

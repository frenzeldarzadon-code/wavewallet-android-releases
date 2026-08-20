/**
 * Print stylesheet for physical voucher cards.
 *
 * The card is locked to EXACTLY 2in x 2in in both screen preview and print.
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
  gap: 0.06in;
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
  gap: 0.03in;
  padding: 0.07in 0.08in;
  border: 1px dashed #94a3b8;
  border-radius: 0.05in;
  background: #ffffff;
  color: #0f172a;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  break-inside: avoid;
  page-break-inside: avoid;
}
.vp-head { min-height: 0; }
.vp-body { min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; gap: 0.02in; }
.vp-shop { font-size: 7pt; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; line-height: 1.1; }
.vp-brand { font-size: 5pt; letter-spacing: .12em; text-transform: uppercase; opacity: .7; line-height: 1.1; }
.vp-product {
  font-size: 7.5pt;
  font-weight: 700;
  line-height: 1.12;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* The shop's stored description, wrapped and clipped — never overflowing. */
.vp-desc {
  font-size: 5.5pt;
  line-height: 1.2;
  opacity: .85;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.vp-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 17pt;
  font-weight: 800;
  letter-spacing: .04em;
  line-height: 1.05;
  word-break: break-all;
  text-align: center;
}
.vp-code-long { font-size: 13pt; letter-spacing: .02em; }
.vp-code-label { font-size: 4.5pt; letter-spacing: .14em; text-transform: uppercase; text-align: center; opacity: .65; line-height: 1.1; }
.vp-meta { display: flex; justify-content: space-between; align-items: flex-end; gap: .05in; font-size: 5pt; opacity: .8; line-height: 1.1; }
.vp-price { font-size: 8.5pt; font-weight: 800; opacity: 1; }

/* Templates change styling only — never the data or the physical size. */
.vp-t-minimal { border: 1px solid #e2e8f0; }
.vp-t-minimal .vp-brand { display: none; }
.vp-t-modern { border: 1px solid #cbd5e1; border-left: 0.05in solid #1d4ed8; }
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
  .vp-sheet { gap: 0.06in; }
  .vp-voucher {
    width: ${W};
    height: ${H};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;

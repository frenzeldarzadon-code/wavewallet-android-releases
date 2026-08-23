/**
 * Print stylesheet for physical voucher cards.
 *
 * The card is locked to EXACTLY 2in x 1.5in (landscape) in both screen preview and print.
 * No transforms, no scaling, no flex growth — only the sheet around the cards
 * reflows so multiple vouchers fill each page. Templates change styling ONLY:
 * every template renders the identical voucher data at the identical size.
 */
import { VOUCHER_PRINT_HEIGHT_IN, VOUCHER_PRINT_WIDTH_IN } from "./voucher-print";
import mistArt from "@/assets/voucher-art/mist.jpg.asset.json";
import terracesArt from "@/assets/voucher-art/terraces.jpg.asset.json";
import pinesArt from "@/assets/voucher-art/pines.jpg.asset.json";
import fallsArt from "@/assets/voucher-art/falls.jpg.asset.json";
import caveArt from "@/assets/voucher-art/cave.jpg.asset.json";
import sunriseArt from "@/assets/voucher-art/sunrise.jpg.asset.json";

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
  position: relative;
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
  gap: 0.01in;
  padding: 0.045in 0.055in;
  border: 1px dashed #cbd5e1;
  border-radius: 0.05in;
  background: #ffffff;
  color: #0f172a;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  break-inside: avoid;
  page-break-inside: avoid;
}
/* Decorative layer. Purely visual, sits behind the content, never clips text. */
.vp-art {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}
.vp-voucher p { margin: 0; }
.vp-head, .vp-body, .vp-meta { position: relative; z-index: 1; min-width: 0; }
.vp-head { min-height: 0; flex: 0 0 auto; overflow: hidden; }
.vp-body { min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; gap: 0.005in; }
.vp-shop { font-size: 6.5pt; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; line-height: 1.05; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vp-brand { font-size: 4.2pt; letter-spacing: .16em; text-transform: uppercase; opacity: .6; line-height: 1.1; }
.vp-product {
  font-size: 7pt;
  font-weight: 700;
  line-height: 1.08;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-height: 1.1em;
}
/* The shop's stored description, wrapped and clipped — never overflowing. */
.vp-desc {
  font-size: 5pt;
  line-height: 1.1;
  opacity: .82;
  overflow-wrap: anywhere;
  overflow: hidden;
  max-height: 2.2em;
}
.vp-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 17pt;
  font-weight: 800;
  letter-spacing: .03em;
  line-height: 1.0;
  word-break: break-all;
  text-align: center;
}
.vp-code-long { font-size: 12.5pt; letter-spacing: .01em; }
.vp-code-xs { font-size: 9pt; letter-spacing: 0; }
.vp-code-label { font-size: 4.6pt; letter-spacing: .16em; text-transform: uppercase; text-align: center; opacity: .65; line-height: 1.05; }
.vp-meta { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: flex-end; gap: .04in; font-size: 4.8pt; opacity: .78; line-height: 1.05; }
.vp-meta span:last-child { text-align: right; white-space: nowrap; opacity: .85; }
.vp-price { font-size: 24pt; font-weight: 900; opacity: 1; letter-spacing: -.02em; line-height: .9; }


/* ------------------------------------------------------------------ */
/* Templates — visual design only.                                     */
/* ------------------------------------------------------------------ */

/* 1. CLASSIC PREMIUM — refined ticket with a hairline rule and cut line. */
.vp-t-classic { border: 1px solid #0f172a; padding: 0.05in 0.06in; }
.vp-t-classic .vp-art {
  border: 1px solid rgba(15,23,42,.25);
  border-radius: 0.03in;
  margin: 0.03in;
}
.vp-t-classic .vp-shop { letter-spacing: .1em; }
.vp-t-classic .vp-code { border-top: 1px dashed rgba(15,23,42,.35); border-bottom: 1px dashed rgba(15,23,42,.35); padding: .008in 0; }

/* 2. MINIMAL — quiet Swiss card, maximum legibility. */
.vp-t-minimal { border: 1px solid #e5e7eb; }
.vp-t-minimal .vp-brand { display: none; }
.vp-t-minimal .vp-shop { font-weight: 700; letter-spacing: .1em; font-size: 6.2pt; opacity: .7; }
.vp-t-minimal .vp-code { letter-spacing: .08em; }

/* 3. VERY MODERN — editorial product card, generous type hierarchy. */
.vp-t-modern { border: 1px solid #e2e8f0; }
.vp-t-modern .vp-art { border-left: 0.045in solid #1d4ed8; }
.vp-t-modern .vp-head { padding-left: .02in; }
.vp-t-modern .vp-shop { color: #1d4ed8; letter-spacing: .08em; font-size: 6.2pt; }
.vp-t-modern .vp-product { font-size: 7.3pt; letter-spacing: -.01em; }
.vp-t-modern .vp-code { text-align: left; }
.vp-t-modern .vp-code-label { text-align: left; }

/* 4. GEOMETRIC — precise shapes, premium retail composition. */
.vp-t-geometric { border: 1px solid #0f172a; }
.vp-t-geometric .vp-art {
  background:
    radial-gradient(circle at 100% 0, #0f172a 0 0.16in, transparent 0.16in),
    repeating-linear-gradient(45deg, rgba(15,23,42,.08) 0 0.02in, transparent 0.02in 0.06in);
}
.vp-t-geometric .vp-head { padding-right: .15in; }
.vp-t-geometric .vp-shop { letter-spacing: .12em; }
.vp-t-geometric .vp-code { background: #0f172a; color: #ffffff; padding: .012in .02in; border-radius: .02in; }
.vp-t-geometric .vp-price { color: #0f172a; }

/* 5. FUTURISTIC — sleek tech surface, controlled grid. */
.vp-t-futuristic { background: #0b1220; color: #e2e8f0; border: 1px solid #0b1220; }
.vp-t-futuristic .vp-art {
  background:
    linear-gradient(120deg, rgba(56,189,248,.22), transparent 55%),
    repeating-linear-gradient(0deg, rgba(148,197,255,.10) 0 1px, transparent 1px 0.09in),
    repeating-linear-gradient(90deg, rgba(148,197,255,.10) 0 1px, transparent 1px 0.09in);
}
.vp-t-futuristic .vp-shop { color: #7dd3fc; letter-spacing: .14em; }
.vp-t-futuristic .vp-code { color: #ffffff; text-shadow: 0 0 0.02in rgba(56,189,248,.6); }
.vp-t-futuristic .vp-code-label { color: #7dd3fc; opacity: .9; }
.vp-t-futuristic .vp-price { color: #7dd3fc; }

/* 6. PASTEL — refined soft palette, youthful but grown-up. */
.vp-t-pastel { border: 1px solid #e9d5ff; background: linear-gradient(140deg, #fdf4ff 0%, #eff6ff 55%, #ecfeff 100%); color: #3b3352; }
.vp-t-pastel .vp-art { background: radial-gradient(circle at 12% 92%, rgba(196,181,253,.45) 0 0.35in, transparent 0.35in); }
.vp-t-pastel .vp-shop { color: #7c3aed; letter-spacing: .12em; }
.vp-t-pastel .vp-code { color: #4c1d95; }
.vp-t-pastel .vp-price { color: #0e7490; }

/* 7. LUXURY — black-tie card with restrained metallic accents. */
.vp-t-luxury { background: #0c0a09; color: #f5f0e6; border: 1px solid #0c0a09; }
.vp-t-luxury .vp-art { border: 0.008in solid rgba(212,175,55,.6); margin: 0.03in; border-radius: 0.02in; }
.vp-t-luxury .vp-brand { color: #d4af37; opacity: .95; }
.vp-t-luxury .vp-shop { color: #f5f0e6; letter-spacing: .12em; font-size: 6.5pt; }
.vp-t-luxury .vp-product { font-family: Georgia, "Times New Roman", serif; font-size: 7pt; }
.vp-t-luxury .vp-code { color: #d4af37; letter-spacing: .06em; }
.vp-t-luxury .vp-code-label { color: rgba(212,175,55,.85); }
.vp-t-luxury .vp-price { color: #d4af37; }

/* 8. AURORA GLASS — translucent gradient sheet, prints gracefully. */
.vp-t-aurora { border: 1px solid #c7d2fe; background: linear-gradient(135deg, #eef2ff 0%, #e0f2fe 45%, #f0fdfa 100%); }
.vp-t-aurora .vp-art {
  background:
    radial-gradient(circle at 88% 12%, rgba(129,140,248,.35) 0 0.4in, transparent 0.4in),
    radial-gradient(circle at 5% 100%, rgba(45,212,191,.32) 0 0.45in, transparent 0.45in);
}
.vp-t-aurora .vp-shop { color: #4338ca; }
.vp-t-aurora .vp-body { background: rgba(255,255,255,.62); border: 1px solid rgba(255,255,255,.9); border-radius: .04in; padding: .012in; }
.vp-t-aurora .vp-code { color: #1e1b4b; }
.vp-t-aurora .vp-price { color: #0f766e; }

/* 9. BOLD POP — confident shapes and heavy type. */
.vp-t-pop { border: 0.02in solid #111827; background: #fde047; color: #111827; }
.vp-t-pop .vp-art { background: linear-gradient(0deg, #fb7185 0 0.1in, transparent 0.1in); }
.vp-t-pop .vp-shop { font-size: 7pt; letter-spacing: 0; }
.vp-t-pop .vp-code { background: #111827; color: #fde047; padding: .012in .02in; border-radius: .03in; letter-spacing: .02em; }
.vp-t-pop .vp-meta { opacity: .9; }
.vp-t-pop .vp-price { font-size: 25pt; }

/* 10. ORGANIC — earthy palette and soft curves. */
.vp-t-organic { border: 1px solid #d6cbb8; background: #faf7f0; color: #3f3a2f; border-radius: 0.14in; }
.vp-t-organic .vp-art {
  border-radius: 0.14in;
  background: radial-gradient(120% 60% at 50% 108%, rgba(132,155,110,.35) 0 60%, transparent 60%);
}
.vp-t-organic .vp-shop { color: #4d6b3c; letter-spacing: .1em; }
.vp-t-organic .vp-product { font-family: Georgia, "Times New Roman", serif; }
.vp-t-organic .vp-code { color: #33402a; }
.vp-t-organic .vp-price { color: #4d6b3c; }

/* 11. NEON NIGHT — dark nightlife card with controlled neon. */
.vp-t-neon { background: #120a1f; color: #f5e8ff; border: 1px solid #120a1f; }
.vp-t-neon .vp-art {
  background:
    linear-gradient(200deg, rgba(236,72,153,.35), transparent 45%),
    linear-gradient(20deg, rgba(34,211,238,.3), transparent 45%);
}
.vp-t-neon .vp-shop { color: #f472b6; letter-spacing: .16em; }
.vp-t-neon .vp-code { color: #22d3ee; border: 0.01in solid rgba(34,211,238,.55); border-radius: .03in; padding: .01in .02in; }
.vp-t-neon .vp-code-label { color: #f9a8d4; opacity: .9; }
.vp-t-neon .vp-price { color: #f472b6; }

/* 12. MONO PRESS — inked editorial press stub. */
.vp-t-mono { border: 1px solid #111827; background: #f8f7f4; color: #111827; }
.vp-t-mono .vp-art { background: repeating-linear-gradient(90deg, rgba(17,24,39,.08) 0 1px, transparent 1px 0.05in); }
.vp-t-mono .vp-brand { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.vp-t-mono .vp-shop { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; }
.vp-t-mono .vp-body { border-top: 0.012in solid #111827; border-bottom: 0.012in solid #111827; padding: .01in 0; }
.vp-t-mono .vp-meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* ------------------------------------------------------------------ */
/* Nature series — Sagada-inspired decorative artwork.                 */
/* The artwork is always a background layer: every text block sits on  */
/* an opaque or near-opaque reading surface so print contrast holds.   */
/* ------------------------------------------------------------------ */
.vp-nature .vp-art {
  background-repeat: no-repeat;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* Shared frosted reading plate used by the photographic templates. */
.vp-nature .vp-body {
  background: rgba(255,255,255,.92);
  border: 1px solid rgba(255,255,255,.95);
  border-radius: .04in;
  padding: .012in .018in;
  box-shadow: 0 0 .03in rgba(255,255,255,.9);
}

/* 13. SAGADA MIST — full-bleed ridges, frosted column of text. */
.vp-t-mist { border: 1px solid #b8c9cd; background: #f2f7f8; color: #10262b; }
.vp-t-mist .vp-art {
  background-image:
    linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,.08) 45%, rgba(255,255,255,.35) 100%),
    url("${mistArt.url}");
  background-size: cover, cover;
  background-position: center, center bottom;
}
.vp-t-mist .vp-head { background: rgba(255,255,255,.86); border-radius: .04in; padding: .008in .016in; }
.vp-t-mist .vp-shop { color: #14555f; letter-spacing: .1em; }
.vp-t-mist .vp-code { color: #0b3138; }
.vp-t-mist .vp-price { color: #14555f; }
.vp-t-mist .vp-meta { background: rgba(255,255,255,.82); border-radius: .04in; padding: .006in .014in; opacity: 1; }

/* 14. RICE TERRACES — artwork as a grounded band under the price. */
.vp-t-terraces { border: 1px solid #d9cba4; background: #fdfaf0; color: #3a3320; }
.vp-t-terraces .vp-art {
  background-image: url("${terracesArt.url}");
  background-size: 100% 0.62in;
  background-position: left bottom;
  opacity: 1;
  filter: saturate(1.5) contrast(1.12);
}
.vp-t-terraces .vp-body {
  background: rgba(253,250,240,.94);
  border: 1px solid rgba(190,167,110,.45);
  box-shadow: none;
}
.vp-t-terraces .vp-shop { color: #7a5f16; letter-spacing: .11em; }
.vp-t-terraces .vp-code { color: #2f2a17; }
.vp-t-terraces .vp-meta { background: rgba(253,250,240,.9); border-radius: .04in; padding: .006in .014in; opacity: 1; }
.vp-t-terraces .vp-price { color: #6b5310; }

/* 15. PINE FOREST — vertical forest strip, ink column beside it. */
.vp-t-pines { border: 1px solid #cbd5d1; background: #f7faf8; color: #16241f; }
.vp-t-pines .vp-art {
  background-image: url("${pinesArt.url}");
  background-size: 0.42in 100%;
  background-position: left top;
  opacity: .95;
  filter: saturate(1.2) contrast(1.08);
}
.vp-t-pines .vp-head,
.vp-t-pines .vp-body,
.vp-t-pines .vp-meta { margin-left: 0.36in; }
.vp-t-pines .vp-body { background: rgba(247,250,248,.95); box-shadow: none; border-color: rgba(120,150,135,.4); }
.vp-t-pines .vp-shop { color: #2f6b4f; letter-spacing: .09em; }
.vp-t-pines .vp-code { color: #14301f; text-align: left; }
.vp-t-pines .vp-code-label { text-align: left; }
.vp-t-pines .vp-price { color: #2f6b4f; }

/* 16. BOMOD-OK FALLS — airy wash, centred code plate. */
.vp-t-falls { border: 1px solid #cfe0dd; background: #f6fbfa; color: #123033; }
.vp-t-falls .vp-art {
  background-image:
    linear-gradient(90deg, rgba(232,245,243,.85) 0%, rgba(232,245,243,0) 50%, rgba(232,245,243,.85) 100%),
    url("${fallsArt.url}");
  background-size: cover, auto 230%;
  background-position: center, center bottom;
  filter: saturate(1.9) contrast(1.2);
}
.vp-t-falls .vp-head { text-align: center; }
.vp-t-falls .vp-shop { color: #0f6b6b; letter-spacing: .14em; }
.vp-t-falls .vp-body { border-radius: .07in; border-color: rgba(15,107,107,.25); }
.vp-t-falls .vp-code { color: #0b3a3c; }
.vp-t-falls .vp-meta { justify-content: center; text-align: center; }
.vp-t-falls .vp-meta span:last-child { text-align: center; }
.vp-t-falls .vp-price { color: #0f6b6b; }

/* 17. LIMESTONE — cliffs in the corner over warm paper stock. */
.vp-t-cave { border: 1px solid #ded2bd; background: #fbf7ef; color: #33291c; }
.vp-t-cave .vp-art {
  background-image: url("${caveArt.url}");
  background-size: 1.15in auto;
  background-position: right bottom;
  opacity: .95;
  filter: saturate(1.15);
}
.vp-t-cave .vp-head { padding-right: .1in; }
.vp-t-cave .vp-shop { color: #8a6a2f; letter-spacing: .12em; }
.vp-t-cave .vp-body {
  background: rgba(251,247,239,.95);
  border: 1px solid rgba(138,106,47,.35);
  border-radius: .03in;
  box-shadow: none;
}
.vp-t-cave .vp-code { color: #2b2114; }
.vp-t-cave .vp-price { color: #8a6a2f; }
.vp-t-cave .vp-meta { background: rgba(251,247,239,.88); border-radius: .03in; padding: .006in .014in; opacity: 1; }

/* 18. KILTEPAN SUNRISE — warm ridge glow behind a bright scrim. */
.vp-t-sunrise { border: 1px solid #f0d3bb; background: #fff6ef; color: #2c2118; }
.vp-t-sunrise .vp-art {
  background-image:
    linear-gradient(180deg, rgba(255,246,239,.05) 0%, rgba(255,246,239,.72) 38%, rgba(255,246,239,.25) 100%),
    url("${sunriseArt.url}");
  background-size: cover, cover;
  background-position: center, center top;
}
.vp-t-sunrise .vp-shop { color: #a4552a; letter-spacing: .12em; }
.vp-t-sunrise .vp-body {
  background: rgba(255,255,255,.9);
  border: 1px solid rgba(164,85,42,.28);
  border-radius: .05in;
  box-shadow: none;
}
.vp-t-sunrise .vp-code { color: #3a2415; }
.vp-t-sunrise .vp-price { color: #b3541f; }
.vp-t-sunrise .vp-meta { background: rgba(255,246,239,.85); border-radius: .04in; padding: .006in .014in; opacity: 1; }


/* Long codes must never inherit a template's wide tracking. */
.vp-voucher .vp-code-long { letter-spacing: .01em; }
.vp-voucher .vp-code-xs { letter-spacing: 0; }

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

/**
 * Selector-only styles (screen). The thumbnail scales a real card down so the
 * preview is honest; this never applies to a printed card.
 */
export const voucherSelectorCss = `
.vp-thumb-frame {
  width: 96px;
  height: 72px;
  overflow: hidden;
  border-radius: 0.5rem;
  position: relative;
}
.vp-thumb-frame .vp-voucher {
  position: absolute;
  top: 0;
  left: 0;
  transform: scale(var(--vp-thumb-scale, 0.5));
  transform-origin: top left;
}
`;

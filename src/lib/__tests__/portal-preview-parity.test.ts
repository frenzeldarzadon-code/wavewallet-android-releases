/**
 * The admin design preview and the generated Omada page must never diverge:
 * both build their body from portal-sections.ts.
 */
import { describe, expect, it } from "vitest";
import { portalSectionsHtml, PORTAL_SECTION_FEATURE_DEFAULTS } from "../portal-sections";
import { portalThemePreviewHtml, defaultPortalTheme } from "../portal-themes";
import {
  analyzeOmadaTemplate,
  generateWaveWalletPortal,
  DEFAULT_TEMPLATE_FEATURES,
} from "../portal-template";

const MASTER = `<!DOCTYPE html>
<html><head><title>Portal</title></head>
<body>
  <form id="loginForm" method="post" action="/portal/auth">
    <input type="hidden" name="clientMac" value="" />
    <input type="hidden" name="apMac" value="" />
    <input type="hidden" name="site" value="" />
    <input type="text" name="voucherCode" />
    <button type="submit">Connect</button>
  </form>
  <script src="/portal/js/portal.js"></script>
</body></html>`;

function generated(features = DEFAULT_TEMPLATE_FEATURES) {
  return generateWaveWalletPortal(MASTER, analyzeOmadaTemplate(MASTER), features, {
    origin: "https://wallet.example.com",
    mappingId: "map-1",
    shopName: "Sagada Wave One-stop-shop",
    shopSlug: "sagada-wave",
    portalId: "p1",
    portalName: "Sagada Wave",
    siteId: "s1",
    siteName: "Sagada Wave V2",
    theme: defaultPortalTheme(),
  });
}

const order = (html: string) => [
  html.indexOf("Already have a code?"),
  html.indexOf("Wi-Fi</p>"),
];

describe("admin preview parity with the generated portal", () => {
  it("keeps the Omada authentication card ABOVE the buy-a-voucher card", () => {
    for (const html of [
      generated(),
      portalThemePreviewHtml(defaultPortalTheme(), { shopName: "Sagada Wave One-stop-shop" }),
    ]) {
      const [auth = -1, buy = -1] = order(html);
      expect(auth).toBeGreaterThan(-1);
      expect(buy).toBeGreaterThan(-1);
      expect(auth).toBeLessThan(buy);
    }
  });

  it("uses the shared section builder verbatim in the generated page", () => {
    expect(generated()).toContain(
      portalSectionsHtml({
        shopName: "Sagada Wave One-stop-shop",
        features: DEFAULT_TEMPLATE_FEATURES,
        mode: "runtime",
        portalName: "Sagada Wave",
      }),
    );
  });

  it("shows the same headings, labels and buttons in the preview", () => {
    const preview = portalThemePreviewHtml(defaultPortalTheme(), { shopName: "Sagada Wave" });
    for (const label of [
      "Already have a code?",
      "Enter your voucher",
      "Buy a voucher to resume internet",
      "Buy a voucher",
      "Voucher status",
      "Sign in",
      "Powered by WaveWallet",
    ]) {
      expect(preview).toContain(label);
      expect(generated()).toContain(label);
    }
  });

  it("mirrors disabled features in the preview", () => {
    const features = { ...PORTAL_SECTION_FEATURE_DEFAULTS, buyVoucher: false, voucherStatus: false };
    const preview = portalThemePreviewHtml(defaultPortalTheme(), { shopName: "Shop", features });
    expect(preview).not.toContain("Voucher status");
    expect(preview).not.toContain(">Buy a voucher<");
    expect(preview).toContain("Already have a code?");
  });

  it("never leaks runtime hooks or scripts into the static preview", () => {
    const preview = portalThemePreviewHtml(defaultPortalTheme(), { shopName: "Shop" });
    expect(preview).not.toContain("data-ww-link");
    expect(preview).not.toContain("<script");
  });

  it("keeps the real Omada auth mechanics in the generated page only", () => {
    const html = generated();
    expect(html).toContain('id="loginForm"');
    expect(html).toContain('name="clientMac"');
    expect(html).toContain('name="voucherCode"');
    expect(html).toContain("/portal/js/portal.js");
    expect(html).toContain('id="ww-voucher-slot"');
    expect(html).toContain("data-ww-methods");
  });
});

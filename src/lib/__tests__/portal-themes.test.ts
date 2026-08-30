import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORTAL_THEME_SLUG,
  PORTAL_THEMES,
  buildPortalThemeCss,
  defaultPortalTheme,
  normalizePortalTheme,
  portalThemePreviewHtml,
  resolvePortalTheme,
} from "../portal-themes";
import { analyzeOmadaTemplate, generateWaveWalletPortal, normalizeTemplateFeatures } from "../portal-template";
import { generatePortalFromMaster } from "../portal-generate";

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

const binding = {
  origin: "https://wallet.example.com",
  mappingId: "map-1",
  shopName: "Sagada Wave",
  shopSlug: "sagada-wave",
  portalId: "p1",
  portalName: "Sagada Wave",
  siteId: "s1",
  siteName: "Sagada Wave V2",
};

const master = { version: 3, checksum: "abc123", html: MASTER, files: { "index.html": MASTER } };

/** Anything that could need the internet before the customer is authorised. */
const NETWORK = /(https?:)?\/\/(?!wallet\.example\.com)|url\((?!#)|@import|<img|\.woff|fonts\.googleapis|cdn\./i;

describe("portal design gallery catalog", () => {
  it("ships at least 10 themes", () => {
    expect(PORTAL_THEMES.length).toBeGreaterThanOrEqual(10);
  });

  it("has unique slugs, names and descriptions", () => {
    expect(new Set(PORTAL_THEMES.map((t) => t.slug)).size).toBe(PORTAL_THEMES.length);
    expect(new Set(PORTAL_THEMES.map((t) => t.name)).size).toBe(PORTAL_THEMES.length);
    for (const t of PORTAL_THEMES) expect(t.description.length).toBeGreaterThan(20);
  });

  it("is more than a colour swap: layouts and decorative treatments really differ", () => {
    expect(new Set(PORTAL_THEMES.map((t) => t.layout)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(PORTAL_THEMES.map((t) => t.decor)).size).toBe(PORTAL_THEMES.length);
    expect(new Set(PORTAL_THEMES.map((t) => t.fontStack)).size).toBeGreaterThanOrEqual(4);
  });

  it("resolves by slug and falls back to the default", () => {
    expect(resolvePortalTheme("cyber-arena").slug).toBe("cyber-arena");
    expect(resolvePortalTheme("nope").slug).toBe(DEFAULT_PORTAL_THEME_SLUG);
    expect(defaultPortalTheme().slug).toBe(DEFAULT_PORTAL_THEME_SLUG);
  });

  it("normalizes a database row and rejects unsafe token values", () => {
    const theme = normalizePortalTheme({
      slug: "db-theme",
      name: "DB Theme",
      description: "From the database.",
      layout: "hero",
      decor: "waves",
      font_stack: "rounded",
      motion: "bold",
      sort_order: 5,
      tokens: { brand: "#ff0000", ink: 'url("http://evil/x.png")' },
    });
    expect(theme.slug).toBe("db-theme");
    expect(theme.layout).toBe("hero");
    expect(theme.tokens.brand).toBe("#ff0000");
    expect(theme.tokens.ink).toBe(defaultPortalTheme().tokens.ink);
  });

  it("falls back safely on junk rows", () => {
    const theme = normalizePortalTheme({ layout: "weird", decor: "weird", motion: "weird" });
    expect(theme.layout).toBe(defaultPortalTheme().layout);
    expect(theme.decor).toBe(defaultPortalTheme().decor);
  });
});

describe("theme CSS", () => {
  for (const theme of PORTAL_THEMES) {
    it(`${theme.name} builds lightweight, offline-safe CSS`, () => {
      const css = buildPortalThemeCss(theme);
      expect(css).toContain("--ww-brand");
      expect(css).toContain(".ww-slot");
      expect(css).toContain("prefers-reduced-motion");
      expect(css).not.toMatch(NETWORK);
      expect(new TextEncoder().encode(css).length).toBeLessThan(9_000);
    });

    it(`${theme.name} preview is self-contained`, () => {
      const html = portalThemePreviewHtml(theme, { shopName: "Sagada Wave" });
      expect(html).not.toMatch(NETWORK);
      expect(html).toContain("Enter your voucher");
      expect(new TextEncoder().encode(html).length).toBeLessThan(14_000);
    });
  }
});

describe("generation with every theme", () => {
  const analysis = analyzeOmadaTemplate(MASTER);

  for (const theme of PORTAL_THEMES) {
    it(`${theme.name}: keeps the canonical master and its mechanics`, () => {
      const out = generatePortalFromMaster(master, {}, binding, theme);
      // The master's own form, action, hidden fields and script survive.
      expect(out.html).toContain('action="/portal/auth"');
      expect(out.html).toContain('name="clientMac"');
      expect(out.html).toContain('src="/portal/js/portal.js"');
      expect(out.html).toContain('id="loginForm"');
      // Manual voucher entry is always present and never disabled.
      expect(out.features.manualVoucher).toBe(true);
      expect(out.html).toContain("ww-voucher-slot");
      // Only the presentation layer changed.
      expect(out.html).toContain(`data-ww-theme="${theme.slug}"`);
      expect(out.themeSlug).toBe(theme.slug);
      // Voucher Shop only — never Inventory, never an Omada voucher creation.
      expect(out.html).toContain("wwIntent");
      expect(out.html).toContain('data-ww-link="buy"');
      expect(out.html).not.toMatch(/inventory/i);
      expect(out.html).not.toMatch(/voucher-groups|createVoucher/i);
      // Captive-portal safe: nothing external, and small.
      expect(out.html).not.toMatch(NETWORK);
      expect(out.bytes).toBe(new TextEncoder().encode(out.html).length);
      expect(out.bytes).toBeLessThan(40_000);
    });

    it(`${theme.name}: is deterministic`, () => {
      const a = generatePortalFromMaster(master, {}, binding, theme);
      const b = generatePortalFromMaster(master, {}, binding, theme);
      expect(a.checksum).toBe(b.checksum);
      expect(a.html).toBe(b.html);
    });
  }

  it("themes really produce different pages", () => {
    const sums = PORTAL_THEMES.map((t) => generatePortalFromMaster(master, {}, binding, t).checksum);
    expect(new Set(sums).size).toBe(PORTAL_THEMES.length);
  });

  it("keeps the shop's configured features on every theme", () => {
    const features = normalizeTemplateFeatures({ buyVoucher: true, cashIn: true, voucherStatus: false });
    for (const theme of PORTAL_THEMES) {
      const html = generateWaveWalletPortal(MASTER, analysis, features, {
        ...binding,
        theme,
      });
      expect(html).toContain('data-ww-link="buy"');
      expect(html).toContain('data-ww-link="cashin"');
      expect(html).not.toContain('data-ww-link="status"');
      expect(html).toContain("ww-voucher-slot");
    }
  });

  it("defaults to the neutral theme when none is chosen", () => {
    const out = generatePortalFromMaster(master, {}, binding);
    expect(out.themeSlug).toBe(DEFAULT_PORTAL_THEME_SLUG);
  });
});

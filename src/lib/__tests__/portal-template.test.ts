import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE_FEATURES,
  analyzeOmadaTemplate,
  generateWaveWalletPortal,
  generatedFileName,
  normalizeTemplateFeatures,
  templateStage,
} from "../portal-template";

const OMADA_TEMPLATE = `<!DOCTYPE html>
<html><head><title>Portal</title></head>
<body>
  <form id="loginForm" method="post" action="/portal/auth">
    <input type="hidden" name="clientMac" value="" />
    <input type="hidden" name="apMac" value="" />
    <input type="hidden" name="ssidName" value="" />
    <input type="hidden" name="radioId" value="" />
    <input type="hidden" name="site" value="" />
    <input type="text" name="voucherCode" />
    <button type="submit">Connect</button>
  </form>
  <script src="/portal/js/portal.js"></script>
  <script>var submitUrl = "/portal/auth";</script>
</body></html>`;

const ctx = {
  origin: "https://wallet.example.com/",
  mappingId: "map-1",
  shopName: "Sagada Wave",
  shopSlug: "sagada-wave",
  portalName: "Sagada Wave",
  siteName: "Sagada Wave V2",
};

describe("Omada template validation", () => {
  it("accepts a real Omada portal template and reports what is preserved", () => {
    const a = analyzeOmadaTemplate(OMADA_TEMPLATE);
    expect(a.valid).toBe(true);
    expect(a.forms.length).toBe(1);
    expect(a.forms[0]?.hiddenFields).toContain("clientMac");
    expect(a.omadaParameters).toContain("clientMac");
    expect(a.scriptSources).toContain("/portal/js/portal.js");
    expect(a.preserved.join(" ")).toMatch(/form/i);
  });

  it("rejects a file with no form to submit the voucher with", () => {
    const a = analyzeOmadaTemplate("<html><body><p>hello</p></body></html>");
    expect(a.valid).toBe(false);
    expect(a.errors.length).toBeGreaterThan(0);
  });

  it("rejects something that is not HTML at all", () => {
    const a = analyzeOmadaTemplate("just some text");
    expect(a.valid).toBe(false);
  });
});

describe("Portal page generation", () => {
  const analysis = analyzeOmadaTemplate(OMADA_TEMPLATE);
  const html = generateWaveWalletPortal(OMADA_TEMPLATE, analysis, DEFAULT_TEMPLATE_FEATURES, ctx);

  it("keeps the original Omada form, hidden fields and scripts intact", () => {
    expect(html).toContain('action="/portal/auth"');
    expect(html).toContain('name="clientMac"');
    expect(html).toContain('name="voucherCode"');
    expect(html).toContain('src="/portal/js/portal.js"');
  });

  it("binds the page to the exact selected portal and shop", () => {
    expect(html).toContain("map-1");
    expect(html).toContain("Sagada Wave");
    expect(html).toContain("https://wallet.example.com");
    expect(html).not.toContain("https://wallet.example.com/portal/"); // trailing origin slash trimmed
  });

  it("does not leak personal balances into the downloadable file", () => {
    expect(html).not.toMatch(/\b\d+\.\d{2}\s*(coins|points)\b/i);
  });

  it("omits features the admin turned off", () => {
    const off = generateWaveWalletPortal(
      OMADA_TEMPLATE,
      analysis,
      { ...DEFAULT_TEMPLATE_FEATURES, buyVoucher: false, signUpLink: false },
      ctx,
    );
    expect(off).not.toContain("wwFeature-buyVoucher");
  });

  it("is stable: generating twice produces the same file", () => {
    const again = generateWaveWalletPortal(OMADA_TEMPLATE, analysis, DEFAULT_TEMPLATE_FEATURES, ctx);
    expect(again).toBe(html);
  });
});

describe("Wizard helpers", () => {
  it("always keeps manual voucher entry enabled", () => {
    expect(normalizeTemplateFeatures({ manualVoucher: false }).manualVoucher).toBe(true);
  });

  it("names the file after the shop and portal", () => {
    expect(generatedFileName("Sagada Wave", "Sagada Wave")).toBe("sagada-wave-sagada-wave-portal.html");
  });

  it("only reaches the imported stage on a verified read-back", () => {
    const base = {
      controllerConnected: true,
      portalSelected: true,
      templateUploaded: true,
      templateValidated: true,
      generated: true,
    };
    expect(templateStage({ ...base, importedVerified: false })).toBe("generate");
    expect(templateStage({ ...base, importedVerified: true })).toBe("import");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE_FEATURES,
  analyzeOmadaTemplate,
  generateWaveWalletPortal,
  generatedFileName,
  normalizeTemplateFeatures,
  omadaAuthResponseVerdict,
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
      featuresChosen: true,
      generated: true,
    };
    expect(templateStage({ ...base, importedVerified: false })).toBe("generate");
    expect(templateStage({ ...base, importedVerified: true })).toBe("import");
  });
});

describe("Generated runtime script", () => {
  const analysis = analyzeOmadaTemplate(OMADA_TEMPLATE);
  const html = generateWaveWalletPortal(OMADA_TEMPLATE, analysis, DEFAULT_TEMPLATE_FEATURES, ctx);

  it("keeps backslash escapes intact in the injected script", () => {
    expect(html).toContain("/\\s+/g");
    expect(html).not.toContain("/s+/g");
  });

  it("offers the authentication card and method selector hooks", () => {
    for (const hook of ["data-ww-methods", "data-ww-error", "ww-voucher-slot", "ww-auth-action"]) {
      expect(html).toContain(hook);
    }
  });

  it("watches the real /portal/auth response via fetch and XHR interception", () => {
    expect(html).toContain("/portal/auth");
    expect(html).toContain("noteAuthResponse");
    expect(html).toContain("window.fetch");
    expect(html).toContain("XMLHttpRequest.prototype.send");
    expect(html).toContain("if (AUTH_OK) return true;");
  });

  it("keeps the existing success-view words alongside the OK signal", () => {
    expect(html).toContain("authentication success");
    expect(html).toContain("authorized successfully");
  });
});

describe("Omada /portal/auth response verdict", () => {
  it("treats an exact OK body as success (Hotspot Voucher and Local User)", () => {
    expect(omadaAuthResponseVerdict(200, "OK")).toBe("success");
    expect(omadaAuthResponseVerdict(200, "  OK \n")).toBe("success");
    expect(omadaAuthResponseVerdict(200, "ok")).toBe("success");
  });

  it("treats an Omada envelope with errorCode 0 as success", () => {
    expect(omadaAuthResponseVerdict(200, '{"errorCode":0,"msg":"Success."}')).toBe("success");
  });

  it("never treats OK as success when the response carries an errorCode", () => {
    expect(omadaAuthResponseVerdict(200, '{"errorCode":-1,"msg":"OK"}')).toBe("failure");
    expect(omadaAuthResponseVerdict(200, '{"errorCode":-30005}')).toBe("failure");
  });

  it("never treats OK as success on an HTTP error status", () => {
    expect(omadaAuthResponseVerdict(400, "OK")).toBe("failure");
    expect(omadaAuthResponseVerdict(500, "OK")).toBe("failure");
  });

  it("returns unknown for unrelated or failed-authentication responses", () => {
    expect(omadaAuthResponseVerdict(200, "Incorrect voucher code")).toBe("unknown");
    expect(omadaAuthResponseVerdict(200, "<html><body>Login failed</body></html>")).toBe("unknown");
    expect(omadaAuthResponseVerdict(200, "")).toBe("unknown");
  });
});

describe("Purchased-code redemption runtime", () => {
  const analysis = analyzeOmadaTemplate(OMADA_TEMPLATE);
  const html = generateWaveWalletPortal(OMADA_TEMPLATE, analysis, DEFAULT_TEMPLATE_FEATURES, ctx);
  const script = html.slice(html.indexOf('<script id="ww-portal-script">'));

  it("exchanges the wwRedeem ticket with WaveWallet instead of reading a code from the URL", () => {
    expect(script).toContain("wwRedeem");
    expect(script).toContain("/api/public/portal-redeem");
  });

  it("fills the controller's own voucher field and clicks the controller's own control", () => {
    expect(script).toContain("input[name=voucherCode]");
    expect(script).toContain("field.value = REDEEM_CODE");
    expect(script).toContain("control.click()");
    expect(script).toContain("#button-login,button[type=submit],input[type=submit]");
  });

  it("never builds its own /portal/auth request", () => {
    // The master owns the submission: the injected script sets no authType and
    // sends no voucherCode in any request body of its own.
    expect(script).not.toContain("authType:");
    expect(script).not.toContain('voucherCode:');
  });

  it("strips the ticket from the address bar and from forwarded WaveWallet links", () => {
    expect(script).toContain('wwq.delete("wwRedeem")');
    expect(script).toContain('k === "wwRedeem"');
  });

  it("reports the controller's real verdict back once the master's own request was seen", () => {
    expect(script).toContain("AUTH_SENT");
    expect(script).toContain("reportRedeem(verdict, bodyText)");
  });
});

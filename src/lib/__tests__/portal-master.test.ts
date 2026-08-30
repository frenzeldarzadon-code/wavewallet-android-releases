import { describe, expect, it } from "vitest";
import {
  checksumOf,
  deriveFromMaster,
  inlineMasterAssets,
  masterFromArchive,
  readZipEntries,
  stripVisualLayer,
} from "../portal-master";
import { generatePortalFromMaster } from "../portal-generate";
import { analyzeOmadaTemplate, DEFAULT_TEMPLATE_FEATURES } from "../portal-template";

/** A faithful reduction of the real Omada customized-page download. */
const INDEX_HTML = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Portal</title>
<link rel="stylesheet" href="index.css">
<link rel="icon" href="img/favicon.ico">
</head>
<body>
  <img class="logo" src="logo.png" alt="logo">
  <div class="content">
    <form id="loginForm" method="post" action="/portal/auth">
      <input type="hidden" name="clientMac" value="">
      <input type="hidden" name="apMac" value="">
      <input type="hidden" name="gatewayMac" value="">
      <input type="hidden" name="ssidName" value="">
      <input type="hidden" name="radioId" value="">
      <input type="hidden" name="vid" value="">
      <input type="hidden" name="originUrl" value="">
      <input type="text" name="voucherCode" id="voucherCode">
      <button type="submit">Connect</button>
    </form>
  </div>
  <script src="jquery.min.js"></script>
  <script src="index.js"></script>
</body></html>`;

const INDEX_CSS = `body{background:url("background.png") no-repeat}
@media (max-width:480px){body{background-image:url(background_mobile.png)}}`;

const INDEX_JS = `var authTypes = {externalRadius:2,voucher:3,localUser:5,sms:6,radius:8,formAuth:12,externalLdap:15};
$.post("/portal/getPortalPageSetting", {clientMac: clientMac, apMac: apMac, gatewayMac: gatewayMac, ssidName: ssidName, radioId: radioId, vid: vid, originUrl: originUrl});
function submitAuth(){ $.post("/portal/auth", payload, function(res){ if(res.errorCode===0){ window.location.href = res.result.landingUrl; } }); }
function sms(){ $.post("/portal/sendSmsAuthCode", {phone: phone}); }
function radiusAuth(){ $.post("/portal/radius/auth", payload); }
function ldapAuth(){ $.post("/portal/ldap/auth", payload); }
var ERRORS = {"-41500":"Invalid authentication type","-41538":"Voucher expired"};`;

const FILES: Record<string, string> = {
  "index.html": INDEX_HTML,
  "index.css": INDEX_CSS,
  "index.js": INDEX_JS,
  "jquery.min.js": "/* jquery */ var jQuery = {};",
};

const NAMES = [...Object.keys(FILES), "logo.png", "background.png", "background_mobile.png", "img/icon.png"];

const master = {
  version: 3,
  checksum: checksumOf(INDEX_HTML),
  html: INDEX_HTML,
  files: FILES,
  analysis: analyzeOmadaTemplate(INDEX_HTML),
};

const binding = {
  origin: "https://wallet.example.com/",
  mappingId: "11111111-1111-4111-8111-111111111111",
  shopName: "Sagada Wave",
  shopSlug: "sagada-wave",
  portalId: "portal-abc",
  portalName: "Sagada Wave",
  siteId: "site-1",
  siteName: "Sagada Wave V2",
};

const generated = generatePortalFromMaster(master, DEFAULT_TEMPLATE_FEATURES, binding);

/* ------------------------------------------------------------------ */

describe("the uploaded master is the source of truth", () => {
  it("is never modified while generating", () => {
    const before = checksumOf(INDEX_HTML);
    generatePortalFromMaster(master, { buyVoucher: false }, binding);
    expect(checksumOf(master.html)).toBe(before);
    expect(master.html).toBe(INDEX_HTML);
    expect(master.files["index.js"]).toBe(INDEX_JS);
  });

  it("records which canonical version and fingerprint the page came from", () => {
    expect(generated.masterVersion).toBe(3);
    expect(generated.masterChecksum).toBe(checksumOf(INDEX_HTML));
    expect(generated.html).toContain(checksumOf(INDEX_HTML));
    expect(generated.summary.join(" ")).toContain("canonical master v3");
  });

  it("rejects a file that is not an Omada portal template", () => {
    expect(analyzeOmadaTemplate("<html><body><p>hello</p></body></html>").valid).toBe(false);
    expect(analyzeOmadaTemplate("just some text").valid).toBe(false);
    expect(analyzeOmadaTemplate("").valid).toBe(false);
  });

  it("accepts the real master and refuses an already generated page", () => {
    expect(analyzeOmadaTemplate(INDEX_HTML).valid).toBe(true);
    expect(analyzeOmadaTemplate(generated.html).valid).toBe(false);
  });
});

describe("archive handling", () => {
  it("reads a stored zip and picks index.html without altering it", async () => {
    const zip = storedZip({ "index.html": INDEX_HTML, "index.js": INDEX_JS });
    const entries = await readZipEntries(zip);
    expect(entries.names).toEqual(["index.html", "index.js"]);
    const source = masterFromArchive(entries.text, entries.names);
    expect(source.html).toBe(INDEX_HTML);
  });

  it("explains that image assets are dropped on purpose", () => {
    const source = masterFromArchive(FILES, NAMES);
    expect(source.warnings.join(" ")).toMatch(/image asset/i);
  });

  it("refuses an archive with no page in it", () => {
    expect(() => masterFromArchive({ "readme.txt": "x" }, ["readme.txt"])).toThrow();
  });
});

describe("Omada mechanics survive the derivation", () => {
  it("keeps the master's own form, action and hidden fields", () => {
    expect(generated.html).toContain('action="/portal/auth"');
    expect(generated.html).toContain('name="clientMac"');
    expect(generated.html).toContain('name="gatewayMac"');
    expect(generated.html).toContain('name="originUrl"');
    expect(generated.html).toContain('name="voucherCode"');
  });

  it("keeps every endpoint and auth-type id the master itself uses", () => {
    for (const endpoint of [
      "/portal/getPortalPageSetting",
      "/portal/auth",
      "/portal/radius/auth",
      "/portal/ldap/auth",
      "/portal/sendSmsAuthCode",
    ]) {
      expect(generated.html).toContain(endpoint);
    }
    expect(generated.html).toContain("voucher:3");
    expect(generated.html).toContain("formAuth:12");
    expect(generated.html).toContain("-41538");
    expect(generated.html).toContain("landingUrl");
  });

  it("inlines the master's scripts verbatim instead of rewriting them", () => {
    const inlined = inlineMasterAssets(INDEX_HTML, FILES);
    expect(inlined.inlined).toContain("index.js");
    expect(inlined.html).toContain(INDEX_JS);
    expect(inlined.html).not.toContain('src="index.js"');
  });

  it("leaves controller-served scripts referenced exactly as the master had them", () => {
    const withController = INDEX_HTML.replace(
      '<script src="index.js"></script>',
      '<script src="/portal/js/portal.js"></script>',
    );
    const out = inlineMasterAssets(withController, FILES);
    expect(out.html).toContain('src="/portal/js/portal.js"');
  });
});

describe("manual voucher entry", () => {
  it("is present even with every optional feature switched off", () => {
    const bare = generatePortalFromMaster(
      master,
      {
        buyVoucher: false,
        signIn: false,
        showBalance: false,
        showPoints: false,
        cashIn: false,
        voucherStatus: false,
        signUpLink: false,
      },
      binding,
    );
    expect(bare.features.manualVoucher).toBe(true);
    expect(bare.html).toContain('name="voucherCode"');
    expect(bare.html).toContain('id="ww-voucher-slot"');
    expect(bare.html).not.toContain('data-ww-link="buy"');
  });
});

describe("feature flags and shop routing", () => {
  it("renders only the selected features", () => {
    expect(generated.html).toContain('data-ww-link="buy"');
    const noBuy = generatePortalFromMaster(master, { ...DEFAULT_TEMPLATE_FEATURES, buyVoucher: false }, binding);
    expect(noBuy.html).not.toContain('data-ww-link="buy"');
    const noSignup = generatePortalFromMaster(
      master,
      { ...DEFAULT_TEMPLATE_FEATURES, signUpLink: false },
      binding,
    );
    expect(noSignup.html).not.toContain('data-ww-link="signup"');
  });

  it("buys through the shop's Voucher Shop and never creates an Omada voucher", () => {
    expect(generated.html).toContain('"/portal"');
    expect(generated.html).toContain("wwIntent=");
    expect(generated.html).not.toContain("voucher-groups");
    expect(generated.html).not.toContain("/openapi/");
    expect(generated.html).not.toMatch(/inventory/i);
  });
});

describe("exact tenant binding", () => {
  it("names the one shop, site and portal it was generated for", () => {
    expect(generated.html).toContain(binding.mappingId);
    expect(generated.html).toContain("portal-abc");
    expect(generated.html).toContain("site-1");
    expect(generated.html).toContain("https://wallet.example.com");
    expect(generated.html).not.toContain("https://wallet.example.com/portal/");
    expect(generated.summary.join(" ")).toContain("Sagada Wave V2");
  });

  it("carries no credential, token or secret value", () => {
    for (const leak of [/omadac_id/i, /csrf/i, /access[_-]?token/i, /client[_-]?secret/i, /api[_-]?key/i, /bearer /i, /password\s*[:=]/i]) {
      expect(generated.html).not.toMatch(leak);
    }
  });

  it("escapes values taken from shop data", () => {
    const evil = generatePortalFromMaster(master, DEFAULT_TEMPLATE_FEATURES, {
      ...binding,
      shopName: '</script><img src=x onerror=alert(1)>',
    });
    expect(evil.html).not.toContain("<img src=x");
    expect(evil.html).not.toContain("</script><img");
  });
});

describe("visual layer", () => {
  it("drops the Omada stylesheet, logo and background images", () => {
    for (const asset of ["logo.png", "background.png", "background_mobile.png", "index.css", "favicon"]) {
      expect(generated.html).not.toContain(asset);
    }
    expect(generated.html).not.toMatch(/<img\b/i);
    expect(generated.html).not.toMatch(/<link\b[^>]*stylesheet/i);
  });

  it("only removes presentation, never mechanics", () => {
    const stripped = stripVisualLayer(INDEX_HTML);
    expect(stripped.html).toContain('action="/portal/auth"');
    expect(stripped.html).toContain('name="clientMac"');
    expect(stripped.removed.length).toBeGreaterThan(0);
  });

  it("stays mobile-safe and self-contained", () => {
    expect(generated.html).toMatch(/viewport/i);
    expect(generated.html).toMatch(/@media \(min-width:560px\)/);
    expect(generated.html).not.toMatch(/https?:\/\/(fonts|cdn|unpkg|cdnjs)\./i);
  });
});

describe("determinism, size and honesty", () => {
  it("produces identical bytes for identical inputs", () => {
    const again = generatePortalFromMaster(master, DEFAULT_TEMPLATE_FEATURES, binding);
    expect(again.html).toBe(generated.html);
    expect(again.checksum).toBe(generated.checksum);
  });

  it("changes when the configuration changes", () => {
    const other = generatePortalFromMaster(master, { ...DEFAULT_TEMPLATE_FEATURES, cashIn: true }, binding);
    expect(other.checksum).not.toBe(generated.checksum);
  });

  it("reports the real measured size", () => {
    expect(generated.bytes).toBe(new TextEncoder().encode(generated.html).length);
  });

  it("never claims the page was imported into the controller", () => {
    expect(generated.summary.join(" ").toLowerCase()).not.toContain("imported");
  });
});

describe("derivation report", () => {
  it("lists what was inlined and what presentation was removed", () => {
    const derived = deriveFromMaster(INDEX_HTML, FILES);
    expect(derived.inlined).toContain("index.js");
    expect(derived.removed.length).toBeGreaterThan(0);
    expect(derived.missing).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */

/** Minimal uncompressed zip, the shape a "stored" archive has. */
function storedZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [name, body] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(body);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 10, true);
    view.setUint16(8, 0, true); // stored
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    chunks.push(header, data);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

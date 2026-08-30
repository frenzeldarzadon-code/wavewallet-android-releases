import { describe, expect, it } from "vitest";
import {
  BASE_SCRIPT,
  BASE_TEMPLATE_VERSION,
  OMADA_ENDPOINTS,
  OMADA_QUERY_PARAMS,
  OMADA_RUNTIME_AUDIT,
  baseTemplateInfo,
  baseTemplateSource,
  checksumOf,
} from "../portal-base-template";
import { buildPortalPackage, type PortalBinding } from "../portal-package";
import { DEFAULT_TEMPLATE_FEATURES } from "../portal-template";

const binding: PortalBinding = {
  origin: "https://wallet.example.com/",
  mappingId: "11111111-1111-4111-8111-111111111111",
  shopName: "Sagada Wave",
  shopSlug: "sagada-wave",
  portalId: "portal-abc",
  portalName: "Sagada Wave",
  siteId: "site-1",
  siteName: "Sagada Wave V2",
};

const pkg = buildPortalPackage(DEFAULT_TEMPLATE_FEATURES, binding);

describe("canonical master stays the reference source", () => {
  it("never rewrites the master: the base template is derived, versioned and fingerprinted", () => {
    const info = baseTemplateInfo();
    expect(info.version).toBe(BASE_TEMPLATE_VERSION);
    expect(info.checksum).toBe(checksumOf(baseTemplateSource()));
    expect(info.bytes).toBeGreaterThan(0);
  });

  it("classifies every audited master function before anything is stripped", () => {
    for (const entry of OMADA_RUNTIME_AUDIT) {
      expect(["omada-core", "omada-auth-type", "ui-only", "safe-to-remove"]).toContain(
        entry.classification,
      );
    }
    const core = OMADA_RUNTIME_AUDIT.filter((a) => a.classification === "omada-core");
    expect(core.every((a) => a.preserved)).toBe(true);
    const authTypes = OMADA_RUNTIME_AUDIT.filter((a) => a.classification === "omada-auth-type");
    expect(authTypes.every((a) => a.preserved)).toBe(true);
  });
});

describe("Omada mechanics preserved in the generated portal", () => {
  it("reads every query parameter the master reads", () => {
    for (const param of OMADA_QUERY_PARAMS) expect(pkg.html).toContain(param);
  });

  it("keeps every endpoint the master calls", () => {
    for (const endpoint of Object.values(OMADA_ENDPOINTS)) expect(pkg.html).toContain(endpoint);
  });

  it("sends the Omada authentication payload fields", () => {
    for (const field of ["clientMac", "apMac", "gatewayMac", "ssidName", "radioId", "vid", "originUrl"]) {
      expect(BASE_SCRIPT).toContain(field);
    }
  });

  it("keeps the auth type ids the controller uses", () => {
    expect(pkg.html).toMatch(/externalRadius:2/);
    expect(pkg.html).toMatch(/voucher:3/);
    expect(pkg.html).toMatch(/localUser:5/);
    expect(pkg.html).toMatch(/sms:6/);
    expect(pkg.html).toMatch(/radius:8/);
    expect(pkg.html).toMatch(/formAuth:12/);
    expect(pkg.html).toMatch(/externalLdap:15/);
  });

  it("maps every controller error code from -41500 to -41538", () => {
    for (let code = -41538; code <= -41500; code += 1) {
      expect(pkg.html).toContain(`"${code}"`);
    }
  });

  it("still redirects to the landing url on success", () => {
    expect(pkg.html).toContain("landingUrl");
    expect(pkg.html).toContain("window.location.href");
  });
});

describe("manual voucher entry", () => {
  it("is present even when every optional feature is switched off", () => {
    const bare = buildPortalPackage(
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
    expect(bare.html).toContain('id="ww-voucher-form"');
    expect(bare.html).toContain('id="ww-voucher-code"');
    expect(bare.html).not.toContain('data-ww-link="buy"');
  });
});

describe("feature flags", () => {
  it("only renders the features the admin selected", () => {
    expect(pkg.html).toContain('data-ww-link="buy"');
    const noBuy = buildPortalPackage({ ...DEFAULT_TEMPLATE_FEATURES, buyVoucher: false }, binding);
    expect(noBuy.html).not.toContain('data-ww-link="buy"');
    const noSignup = buildPortalPackage({ ...DEFAULT_TEMPLATE_FEATURES, signUpLink: false }, binding);
    expect(noSignup.html).not.toContain('data-ww-link="signup"');
  });

  it("buys through the shop's own Voucher Shop, never a new Omada voucher", () => {
    expect(pkg.html).toContain("/portal?");
    expect(pkg.html).toContain("wwIntent=");
    expect(pkg.html).not.toContain("voucher-groups");
    expect(pkg.html).not.toContain("/openapi/");
  });
});

describe("tenant binding", () => {
  it("binds the page to the exact shop, site and portal with no hard-coded values", () => {
    expect(pkg.html).toContain(binding.mappingId);
    expect(pkg.html).toContain("Sagada Wave");
    expect(pkg.html).toContain("portal-abc");
    expect(pkg.html).toContain("site-1");
    expect(pkg.html).toContain("https://wallet.example.com");
    expect(pkg.html).not.toContain("https://wallet.example.com/portal/");
  });

  it("reports the site and portal it was generated for", () => {
    expect(pkg.summary.join(" ")).toContain("Sagada Wave V2");
  });
});

describe("visual output", () => {
  it("contains no Omada image or logo asset and no external request", () => {
    for (const asset of ["background.png", "background_mobile.png", "logo.png", "img/", "jquery"]) {
      expect(pkg.html).not.toContain(asset);
    }
    expect(pkg.html).not.toMatch(/<img\b/i);
    expect(pkg.html).not.toMatch(/<link\b[^>]*stylesheet/i);
    expect(pkg.html).not.toMatch(/<script[^>]+src=/i);
  });

  it("reports the real measured page size", () => {
    expect(pkg.bytes).toBe(new TextEncoder().encode(pkg.html).length);
  });
});

describe("determinism and honesty", () => {
  it("produces identical bytes for identical inputs", () => {
    const again = buildPortalPackage(DEFAULT_TEMPLATE_FEATURES, binding);
    expect(again.html).toBe(pkg.html);
    expect(again.checksum).toBe(pkg.checksum);
  });

  it("changes the checksum when the configuration changes", () => {
    const other = buildPortalPackage({ ...DEFAULT_TEMPLATE_FEATURES, cashIn: true }, binding);
    expect(other.checksum).not.toBe(pkg.checksum);
  });

  it("never claims the page was imported into the controller", () => {
    expect(pkg.summary.join(" ").toLowerCase()).not.toContain("imported");
  });
});

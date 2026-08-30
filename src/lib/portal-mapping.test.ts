import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORTAL_FLAGS,
  durationMinutesFromCalibration,
  formatAccessDuration,
  normalizeMac,
  normalizePortalFlags,
  parsePortalParams,
  portalUrlFor,
  resolveMapping,
  type MappingCandidate,
} from "./portal-mapping";

const base: MappingCandidate = {
  id: "m1",
  ecosystemId: "shop-a",
  siteId: "site-1",
  siteName: "Main",
  portalId: "p1",
  portalName: "Guest",
  ssidInfo: "Wave-Guest",
  enabled: true,
};

describe("portal parameters", () => {
  it("reads the identifiers Omada actually sends, under any alias", () => {
    const params = parsePortalParams({
      wwPortal: "m1",
      clientMac: "aa:bb:cc:dd:ee:ff",
      ap: "11-22-33-44-55-66",
      ssid: "Wave-Guest",
      radioId: "1",
      site: "site-1",
      redirectUrl: "https://example.test/",
    });
    expect(params.mappingId).toBe("m1");
    expect(params.clientMac).toBe("AA-BB-CC-DD-EE-FF");
    expect(params.apMac).toBe("11-22-33-44-55-66");
    expect(params.ssidName).toBe("Wave-Guest");
    expect(params.siteRef).toBe("site-1");
  });

  it("normalises MAC separators without inventing a value", () => {
    expect(normalizeMac("aabbccddeeff")).toBe("AA-BB-CC-DD-EE-FF");
    expect(normalizeMac(null)).toBeNull();
    expect(normalizeMac("not-a-mac")).toBe("NOT-A-MAC");
  });
});

describe("shop resolution", () => {
  it("uses the explicit portal id when present", () => {
    const out = resolveMapping([base], { mappingId: "m1", siteRef: null, ssidName: null });
    expect(out.ok && out.mapping.ecosystemId).toBe("shop-a");
  });

  it("refuses a disabled portal instead of falling through to another shop", () => {
    const out = resolveMapping(
      [{ ...base, enabled: false }, { ...base, id: "m2", ecosystemId: "shop-b", portalId: "p2" }],
      { mappingId: "m1", siteRef: "site-1", ssidName: null },
    );
    expect(out.ok).toBe(false);
  });

  it("never silently picks one of several portals on the same site", () => {
    const out = resolveMapping(
      [base, { ...base, id: "m2", portalId: "p2", ssidInfo: "Other", ecosystemId: "shop-b" }],
      { mappingId: null, siteRef: "site-1", ssidName: null },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/More than one portal/);
  });

  it("disambiguates by network name when Omada supplies one", () => {
    const out = resolveMapping(
      [base, { ...base, id: "m2", portalId: "p2", ssidInfo: "Other", ecosystemId: "shop-b" }],
      { mappingId: null, siteRef: "site-1", ssidName: "wave-guest" },
    );
    expect(out.ok && out.mapping.id).toBe("m1");
  });

  it("reports an unmapped site rather than guessing", () => {
    const out = resolveMapping([base], { mappingId: null, siteRef: "site-9", ssidName: null });
    expect(out.ok).toBe(false);
  });
});

describe("feature flags", () => {
  it("falls back to the defaults for anything unset", () => {
    expect(normalizePortalFlags(null)).toEqual(DEFAULT_PORTAL_FLAGS);
    expect(normalizePortalFlags({ allowPurchase: false }).allowPurchase).toBe(false);
    expect(normalizePortalFlags({ allowPurchase: false }).showCoins).toBe(true);
  });
});

describe("duration", () => {
  it("comes from the saved calibration only", () => {
    expect(durationMinutesFromCalibration({ duration: 480 })).toBe(480);
    expect(durationMinutesFromCalibration({})).toBeNull();
    expect(durationMinutesFromCalibration({ duration: 0 })).toBeNull();
    expect(durationMinutesFromCalibration(null)).toBeNull();
  });

  it("reads back in the largest whole unit", () => {
    expect(formatAccessDuration(45)).toBe("45 minutes");
    expect(formatAccessDuration(60)).toBe("1 hour");
    expect(formatAccessDuration(2880)).toBe("2 days");
  });
});

describe("portal url", () => {
  it("always carries the explicit mapping id", () => {
    expect(portalUrlFor("https://wallet.example.com/", "m1")).toBe(
      "https://wallet.example.com/portal?wwPortal=m1",
    );
  });
});

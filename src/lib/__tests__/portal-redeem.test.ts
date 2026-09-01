import { describe, expect, it } from "vitest";
import {
  buildPortalReturnUrl,
  portalPageUrlAllowed,
  sanitizePortalContext,
  type PortalSessionContext,
} from "../portal-redeem";

const session: PortalSessionContext = {
  clientMac: "AA-BB-CC-DD-EE-FF",
  apMac: "11-22-33-44-55-66",
  ssid: "Sagada Wave",
  radioId: "1",
  siteRef: "site-1",
  redirectUrl: "http://example.com/",
};

describe("sanitizePortalContext", () => {
  it("keeps only bounded string values", () => {
    const out = sanitizePortalContext({
      clientMac: "AA-BB",
      n: 5 as unknown as string,
      empty: "",
      long: "x".repeat(600),
    });
    expect(out).toEqual({ clientMac: "AA-BB" });
  });

  it("never keeps WaveWallet's own link parameters", () => {
    const out = sanitizePortalContext({
      clientMac: "AA-BB",
      wwRedeem: "ticket",
      wwSession: "s",
      wwPortal: "p",
      wwIntent: "buy",
    });
    expect(Object.keys(out)).toEqual(["clientMac"]);
  });

  it("caps the number of parameters", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 60; i++) big[`k${i}`] = "v";
    expect(Object.keys(sanitizePortalContext(big)).length).toBe(40);
  });
});

describe("portalPageUrlAllowed", () => {
  it("accepts the controller's own host on any port", () => {
    expect(
      portalPageUrlAllowed("https://portal.sagadawave.com:8843/portal", "https://portal.sagadawave.com"),
    ).toBe(true);
  });

  it("rejects a different host, a missing base, and non-http schemes", () => {
    expect(portalPageUrlAllowed("https://evil.example.com/portal", "https://portal.sagadawave.com")).toBe(false);
    expect(portalPageUrlAllowed("https://portal.sagadawave.com/portal", null)).toBe(false);
    // eslint-disable-next-line no-script-url
    expect(portalPageUrlAllowed("javascript:alert(1)", "https://portal.sagadawave.com")).toBe(false);
  });
});

describe("buildPortalReturnUrl", () => {
  it("returns to the reported portal page with the original context plus the ticket only", () => {
    const url = buildPortalReturnUrl({
      pageUrl: "https://portal.sagadawave.com/portal",
      baseUrl: "https://portal.sagadawave.com",
      rawQuery: { clientMac: "AA-BB", ssidName: "Sagada Wave", t: "123", wwSession: "leak" },
      session,
      token: "TICKET",
    });
    expect(url).toBeTruthy();
    const parsed = new URL(url!);
    expect(parsed.origin).toBe("https://portal.sagadawave.com");
    expect(parsed.searchParams.get("clientMac")).toBe("AA-BB");
    expect(parsed.searchParams.get("ssidName")).toBe("Sagada Wave");
    expect(parsed.searchParams.get("t")).toBe("123");
    expect(parsed.searchParams.get("wwRedeem")).toBe("TICKET");
    expect(parsed.searchParams.get("wwSession")).toBeNull();
  });

  it("ignores a reported page on a host the shop does not own", () => {
    const url = buildPortalReturnUrl({
      pageUrl: "https://evil.example.com/portal",
      baseUrl: "https://portal.sagadawave.com",
      rawQuery: { clientMac: "AA-BB" },
      session,
      token: "TICKET",
    });
    expect(url!.startsWith("https://portal.sagadawave.com/portal?")).toBe(true);
  });

  it("rebuilds Omada's own parameter names when no verbatim context was kept", () => {
    const url = buildPortalReturnUrl({
      pageUrl: null,
      baseUrl: "https://portal.sagadawave.com",
      rawQuery: null,
      session,
      token: "TICKET",
    });
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("clientMac")).toBe(session.clientMac);
    expect(parsed.searchParams.get("apMac")).toBe(session.apMac);
    expect(parsed.searchParams.get("ssidName")).toBe(session.ssid);
    expect(parsed.searchParams.get("radioId")).toBe("1");
    expect(parsed.searchParams.get("site")).toBe("site-1");
    expect(parsed.searchParams.get("originUrl")).toBe(session.redirectUrl);
    expect(parsed.searchParams.get("wwRedeem")).toBe("TICKET");
  });

  it("returns null when there is no safe destination at all", () => {
    expect(
      buildPortalReturnUrl({ pageUrl: null, baseUrl: null, rawQuery: null, session, token: "T" }),
    ).toBeNull();
  });

  it("never leaks anything beyond the ticket: the voucher code is not an input", () => {
    const url = buildPortalReturnUrl({
      pageUrl: null,
      baseUrl: "https://portal.sagadawave.com",
      rawQuery: { clientMac: "AA-BB" },
      session,
      token: "TICKET",
    });
    expect(url).not.toContain("code=");
    expect(url).not.toContain("voucher");
  });
});

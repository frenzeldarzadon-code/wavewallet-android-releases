import { describe, expect, it } from "vitest";
import { parsePortalParams } from "@/lib/portal-mapping";
import { portalAuthLinks, portalReturnPath } from "@/lib/portal-links";
import { safeReturnPath, shopSignInLink, shopSignupLink } from "@/lib/shop-directory";

describe("portal return path", () => {
  it("brings the customer back to the same hotspot session", () => {
    expect(portalReturnPath("abc-123")).toBe("/portal?wwSession=abc-123");
  });
});

describe("shop-specific auth links", () => {
  it("builds sign-in and sign-up links for THIS shop only", () => {
    const links = portalAuthLinks("1234567", "/portal?wwSession=s1");
    expect(links).not.toBeNull();
    expect(links!.signIn).toBe("/?shop=1234567&mode=signin&next=%2Fportal%3FwwSession%3Ds1");
    expect(links!.signUp).toBe("/?shop=1234567&next=%2Fportal%3FwwSession%3Ds1");
  });

  it("has no links when the shop has no public Shop ID", () => {
    expect(portalAuthLinks(null, "/portal?wwSession=s1")).toBeNull();
    expect(portalAuthLinks("  ", "/portal?wwSession=s1")).toBeNull();
  });

  it("keeps the historical parameterless sign-up link shape", () => {
    expect(shopSignupLink("https://wallet.example.com/", "1234567")).toBe(
      "https://wallet.example.com/?shop=1234567",
    );
    expect(shopSignInLink("https://wallet.example.com", "1234567")).toBe(
      "https://wallet.example.com/?shop=1234567&mode=signin",
    );
  });
});

describe("return path safety", () => {
  it("rejects anything that could leave this site", () => {
    expect(safeReturnPath("https://evil.example.com")).toBeNull();
    expect(safeReturnPath("//evil.example.com")).toBeNull();
    expect(safeReturnPath("/\\evil.example.com")).toBeNull();
    expect(safeReturnPath("portal")).toBeNull();
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });

  it("accepts in-app paths", () => {
    expect(safeReturnPath("/portal?wwSession=s1")).toBe("/portal?wwSession=s1");
  });
});

describe("omada redirect parameters", () => {
  it("never treats Omada's timestamp `t` as a redirect target", () => {
    const params = parsePortalParams({
      wwPortal: "map-1",
      clientMac: "AA-BB-CC-DD-EE-FF",
      t: "1756692000000",
    });
    expect(params.redirectUrl).toBeNull();
    expect(params.mappingId).toBe("map-1");
  });

  it("still honours the real redirect parameters", () => {
    expect(parsePortalParams({ redirectUrl: "http://a.example/x" }).redirectUrl).toBe(
      "http://a.example/x",
    );
    expect(parsePortalParams({ originUrl: "http://b.example/" }).redirectUrl).toBe(
      "http://b.example/",
    );
  });
});

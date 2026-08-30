import { describe, expect, it } from "vitest";
import {
  buildExternalPortalPatch,
  buildRestorePatch,
  externalPortalVariants,
  manualPortalSteps,
  readbackMatchesExternalPortal,
  splitPortalUrl,
  summarizeAutoConfig,
  EXTERNAL_PORTAL_AUTH_TYPE,
} from "./omada-auto-config";

const URL = "https://wallet.sagadawave.com/portal?wwPortal=abc";

describe("splitPortalUrl", () => {
  it("separates host and path without the scheme Omada rejects", () => {
    expect(splitPortalUrl(URL)).toEqual({
      scheme: "https",
      host: "wallet.sagadawave.com",
      path: "/portal?wwPortal=abc",
    });
  });
});

describe("buildExternalPortalPatch", () => {
  it("keeps the operator's own portal settings and only changes the auth type", () => {
    const current = {
      id: "p1",
      name: "Sagada Wave",
      enable: true,
      ssidList: ["s1"],
      networkList: ["n1"],
      authType: 11,
      landingPage: 2,
      landingUrl: "www.facebook.com/sagadawave",
      hotspot: { enabledTypes: [3] },
    };
    const patch = buildExternalPortalPatch(current, externalPortalVariants(URL)[0]!);
    expect(patch["name"]).toBe("Sagada Wave");
    expect(patch["ssidList"]).toEqual(["s1"]);
    expect(patch["landingUrl"]).toBe("www.facebook.com/sagadawave");
    expect(patch["authType"]).toBe(EXTERNAL_PORTAL_AUTH_TYPE);
    expect(patch["externalPortal"]).toMatchObject({ serverUrl: expect.stringContaining("wallet.sagadawave.com") });
    expect(patch["id"]).toBeUndefined();
  });
});

describe("buildRestorePatch", () => {
  it("puts every saved setting back and never sends the id", () => {
    const restore = buildRestorePatch({ id: "p1", name: "Sagada Wave", authType: 11, landingUrl: null });
    expect(restore).toEqual({ name: "Sagada Wave", authType: 11 });
  });
});

describe("readbackMatchesExternalPortal", () => {
  it("accepts only a real external-portal read-back pointing at this address", () => {
    expect(
      readbackMatchesExternalPortal(
        { authType: 4, externalPortal: { hostType: 2, serverUrl: "wallet.sagadawave.com/portal?wwPortal=abc" } },
        URL,
      ),
    ).toBe(true);
  });

  it("refuses a controller that answered success but stored no auth", () => {
    expect(readbackMatchesExternalPortal({ authType: 0, noAuth: {} }, URL)).toBe(false);
  });

  it("refuses an external portal pointing somewhere else", () => {
    expect(
      readbackMatchesExternalPortal({ authType: 4, externalPortal: { serverUrl: "other.example.com" } }, URL),
    ).toBe(false);
  });

  it("refuses a missing read-back", () => {
    expect(readbackMatchesExternalPortal(null, URL)).toBe(false);
  });
});

describe("operator guidance", () => {
  it("always shows the exact address to paste", () => {
    const steps = manualPortalSteps(URL, "Sagada Wave");
    expect(steps.some((s) => s.includes(URL))).toBe(true);
    expect(steps.some((s) => s.includes("External Portal Server"))).toBe(true);
  });

  it("never claims success for an unsupported controller", () => {
    expect(summarizeAutoConfig("unsupported")).toContain("manual steps");
    expect(summarizeAutoConfig("failed")).toContain("did not complete");
    expect(summarizeAutoConfig("configured")).toContain("automatically");
  });
});

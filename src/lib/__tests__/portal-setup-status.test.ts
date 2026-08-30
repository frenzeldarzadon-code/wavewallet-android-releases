import { describe, expect, it } from "vitest";
import {
  externalPortalStateFrom,
  portalSetupInstructions,
  portalSetupState,
  preAuthValueFor,
} from "../portal-setup-status";

describe("portal setup status", () => {
  it("only treats a read-back result as verified", () => {
    expect(externalPortalStateFrom("verified")).toBe("verified");
    expect(externalPortalStateFrom("configured")).toBe("verified");
    expect(externalPortalStateFrom("failed")).toBe("unknown");
    expect(externalPortalStateFrom(null)).toBe("unknown");
    expect(externalPortalStateFrom("unsupported")).toBe("not_exposed");
  });

  it("keeps controller reachability separate from external verification", () => {
    const s = portalSetupState({ lastTestStatus: "passed", externalStatus: "unsupported" });
    expect(s.controllerVerified).toBe(true);
    expect(s.external).toBe("not_exposed");
    expect(s.needsManualSetup).toBe(true);
  });

  it("clears the manual setup state only when verified", () => {
    expect(
      portalSetupState({ lastTestStatus: "passed", externalStatus: "verified" }).needsManualSetup,
    ).toBe(false);
  });

  it("derives the pre-auth host from the deployed origin", () => {
    expect(preAuthValueFor("https://example-host.test")).toBe("example-host.test");
    expect(preAuthValueFor("")).toBe("");
  });

  it("builds instructions from live values only", () => {
    const steps = portalSetupInstructions({
      shopName: "Shop A",
      siteName: "Site A",
      portalName: "Portal A",
      portalUrl: "https://example-host.test/portal/abc",
      origin: "https://example-host.test",
    });
    expect(steps.join("\n")).toContain("Site A");
    expect(steps.join("\n")).toContain("Portal A");
    expect(steps.join("\n")).toContain("https://example-host.test/portal/abc");
    expect(steps.join("\n")).toContain("example-host.test");
    expect(steps.join("\n")).not.toMatch(/sagada/i);
  });
});

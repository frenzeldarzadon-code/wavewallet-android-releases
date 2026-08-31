import { describe, expect, it } from "vitest";
import {
  HANDOFF_TTL_MS,
  MAX_HANDOFF_USES,
  handoffClaimsValid,
  handoffEntryUrl,
} from "@/lib/portal-handoff";
import { signHandoff, verifyHandoff } from "@/lib/portal-handoff.server";

const SECRET = "test-secret";
const claims = () => ({
  jti: "11111111-1111-4111-8111-111111111111",
  ecosystemId: "22222222-2222-4222-8222-222222222222",
  mappingId: "33333333-3333-4333-8333-333333333333",
  portalId: "portal-1",
  siteId: "site-1",
  expiresAt: Date.now() + HANDOFF_TTL_MS,
});

describe("captive-portal hand-off token", () => {
  it("round-trips the shop context it was signed with", () => {
    const c = claims();
    expect(verifyHandoff(signHandoff(c, SECRET), SECRET)).toEqual(c);
  });

  it("rejects a tampered shop id", () => {
    const token = signHandoff(claims(), SECRET);
    const forged = Buffer.from(
      JSON.stringify({ ...claims(), ecosystemId: "44444444-4444-4444-8444-444444444444" }),
      "utf8",
    ).toString("base64url");
    expect(verifyHandoff(`${forged}.${token.split(".")[1]}`, SECRET)).toBeNull();
  });

  it("rejects another signing secret and an expired token", () => {
    expect(verifyHandoff(signHandoff(claims(), SECRET), "other")).toBeNull();
    expect(
      verifyHandoff(signHandoff({ ...claims(), expiresAt: Date.now() - 1 }, SECRET), SECRET),
    ).toBeNull();
    expect(verifyHandoff("not-a-token", SECRET)).toBeNull();
  });

  it("keeps the entry link free of any shop name", () => {
    const url = handoffEntryUrl("https://wallet.sagadawave.com/", "abc.def");
    expect(url).toBe("https://wallet.sagadawave.com/wifi?h=abc.def");
  });

  it("guards replay with a small use budget", () => {
    expect(MAX_HANDOFF_USES).toBeGreaterThan(0);
    expect(MAX_HANDOFF_USES).toBeLessThanOrEqual(10);
  });

  it("refuses malformed claims", () => {
    expect(handoffClaimsValid(null)).toBe(false);
    expect(handoffClaimsValid({ ...claims(), mappingId: "" })).toBe(false);
  });
});

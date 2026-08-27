/**
 * Regression: the Omada controller reports an expired/revoked access token with
 * HTTP 200 and a negative envelope error code. Treating that as a successful
 * response made WaveWallet report a perfectly healthy controller as
 * "degraded / no site visible" (the false-offline report).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOmadaTokenError, probeOmadaHealth } from "./omada-health.server";

const base = "https://controller.example.com";

const input = {
  baseUrl: base,
  omadacId: "omadac",
  clientId: "client",
  clientSecret: "secret",
  siteName: "Site One",
  cachedToken: "stale-token",
  cachedTokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const info = { errorCode: 0, msg: "Success.", result: { controllerVer: "6.2.14.11" } };
const expired = {
  errorCode: -44112,
  msg: "The access token has expired.",
  result: null,
};
const sites = {
  errorCode: 0,
  msg: "Success.",
  result: { data: [{ siteId: "site-1", name: "Site One" }] },
};

afterEach(() => vi.unstubAllGlobals());

describe("Omada session recovery", () => {
  it("recognises controller token error codes", () => {
    expect(isOmadaTokenError(-44112)).toBe(true);
    expect(isOmadaTokenError(0)).toBe(false);
    expect(isOmadaTokenError(null)).toBe(false);
  });

  it("re-authenticates when the cached token is rejected with HTTP 200", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.includes("/api/info")) return json(info);
      if (url.includes("/authorize/token")) {
        return json({ errorCode: 0, result: { accessToken: "fresh-token", expiresIn: 7200 } });
      }
      // First sites read uses the stale token and is rejected at envelope level.
      const usedStale = calls.filter((c) => c.includes("/sites?")).length === 1;
      return json(usedStale ? expired : sites);
    });

    const out = await probeOmadaHealth(input);
    expect(out.state).toBe("healthy");
    expect(out.siteId).toBe("site-1");
    expect(out.token?.value).toBe("fresh-token");
    expect(calls.some((c) => c.includes("/authorize/token"))).toBe(true);
  });

  it("reports auth_failed, and caches nothing, when a fresh token is rejected", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/info")) return json(info);
      if (url.includes("/authorize/token")) {
        return json({ errorCode: 0, result: { accessToken: "fresh-token", expiresIn: 7200 } });
      }
      return json(expired);
    });

    const out = await probeOmadaHealth(input);
    expect(out.state).toBe("auth_failed");
    expect(out.token).toBeNull();
  });

  it("still reports degraded when the session is valid but the site is missing", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/info")) return json(info);
      if (url.includes("/authorize/token")) {
        return json({ errorCode: 0, result: { accessToken: "fresh-token", expiresIn: 7200 } });
      }
      return json({ errorCode: 0, msg: "Success.", result: { data: [] } });
    });

    const out = await probeOmadaHealth({ ...input, cachedToken: null, cachedTokenExpiresAt: null });
    expect(out.state).toBe("degraded");
  });
});

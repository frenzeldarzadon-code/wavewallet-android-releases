/**
 * Regression tests for the External Portal (Hotspot) authorization path.
 *
 * Guards the fixes for the "This client does not exist." bug:
 *  - the Open API `clients/authorize` false positive must never come back,
 *  - authorization goes through the documented Hotspot Operator flow
 *    (login -> cookie + CSRF -> extPortal/auth with authType 4),
 *  - clientIp is carried end to end and `t` is never a redirect target.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeExternalPortalClient,
  buildExtPortalBody,
  resetHotspotSessions,
  type HotspotCredentials,
} from "../omada-hotspot.server";
import { authorizePortalClient, type PortalCapabilities } from "../omada-portals.server";
import { parsePortalParams } from "../portal-mapping";

const CREDS: HotspotCredentials = {
  ecosystemId: "eco-1",
  base: "https://controller.example.com:443/",
  omadacId: "abc123",
  operatorUser: "wavewallet-operator",
  operatorPassword: "secret",
};

/* ------------------------------------------------------------------ *
 * Documented request body                                             *
 * ------------------------------------------------------------------ */

describe("buildExtPortalBody", () => {
  it("builds the documented wireless body with authType 4 and numeric radioId", () => {
    const body = buildExtPortalBody({
      clientMac: "AA-BB-CC-DD-EE-FF",
      clientIp: "65.181.9.57",
      apMac: "11-22-33-44-55-66",
      ssidName: "Sagada Wave",
      radioId: "1",
      timeMs: 3_600_000,
    });
    expect(body).toEqual({
      clientMac: "AA-BB-CC-DD-EE-FF",
      clientIp: "65.181.9.57",
      apMac: "11-22-33-44-55-66",
      ssidName: "Sagada Wave",
      radioId: 1,
      authType: 4,
      time: 3_600_000,
    });
  });

  it("propagates clientIp only when present", () => {
    const withIp = buildExtPortalBody({ clientMac: "AA", clientIp: "10.0.0.9", timeMs: 60_000 });
    expect(withIp["clientIp"]).toBe("10.0.0.9");
    const withoutIp = buildExtPortalBody({ clientMac: "AA", clientIp: null, timeMs: 60_000 });
    expect("clientIp" in withoutIp).toBe(false);
  });

  it("uses gatewayMac + vid for wired clients and drops AP fields", () => {
    const body = buildExtPortalBody({
      clientMac: "AA",
      gatewayMac: "GW-MAC",
      vid: "20",
      apMac: "should-not-appear",
      ssidName: "should-not-appear",
      radioId: "1",
      timeMs: 120_000,
    });
    expect(body["gatewayMac"]).toBe("GW-MAC");
    expect(body["vid"]).toBe(20);
    expect("apMac" in body).toBe(false);
    expect("ssidName" in body).toBe(false);
    expect("radioId" in body).toBe(false);
  });

  it("never authorizes for less than one minute", () => {
    expect(buildExtPortalBody({ clientMac: "AA", timeMs: 5 })["time"]).toBe(60_000);
  });
});

/* ------------------------------------------------------------------ *
 * Operator login, CSRF/session handling, retry-once semantics         *
 * ------------------------------------------------------------------ */

type MockCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, cookies: string[] = []) {
  return {
    status: 200,
    text: async () => JSON.stringify(body),
    headers: {
      get: (k: string) => (k.toLowerCase() === "set-cookie" ? (cookies[0] ?? null) : null),
      getSetCookie: () => cookies,
    },
  };
}

function htmlResponse() {
  return {
    status: 200,
    text: async () => "<!DOCTYPE html><html>controller web app</html>",
    headers: { get: () => null, getSetCookie: () => [] as string[] },
  };
}

describe("authorizeExternalPortalClient", () => {
  const calls: MockCall[] = [];

  beforeEach(() => {
    calls.length = 0;
    resetHotspotSessions();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (script: Array<(call: MockCall) => unknown>) => {
    let i = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      if (!step) throw new Error("fetch mock script exhausted");
      return step(call);
    });
  };


  it("logs in as the hotspot operator, then authorizes with cookie + Csrf-Token", async () => {
    stubFetch([
      () => jsonResponse({ errorCode: 0, result: { token: "csrf-token-1" } }, ["TPOMADA_SESSIONID=s1; Path=/"]),
      () => jsonResponse({ errorCode: 0 }),
    ]);

    const out = await authorizeExternalPortalClient(CREDS, {
      clientMac: "AA-BB-CC-DD-EE-FF",
      clientIp: "65.181.9.57",
      apMac: "11-22-33-44-55-66",
      ssidName: "Sagada Wave",
      radioId: "1",
      timeMs: 3_600_000,
    });
    expect(out.ok).toBe(true);

    expect(calls).toHaveLength(2);
    // Step 1: the documented operator login route — never the Open API token route.
    expect(calls[0]!.url).toBe("https://controller.example.com:443/abc123/api/v2/hotspot/login");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      name: "wavewallet-operator",
      password: "secret",
    });
    // Step 2: the documented external-portal auth route with session + CSRF.
    expect(calls[1]!.url).toBe(
      "https://controller.example.com:443/abc123/api/v2/hotspot/extPortal/auth",
    );
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(headers["Csrf-Token"]).toBe("csrf-token-1");
    expect(headers["cookie"]).toBe("TPOMADA_SESSIONID=s1");
    const body = JSON.parse(String(calls[1]!.init.body)) as Record<string, unknown>;
    expect(body["authType"]).toBe(4);
    expect(body["clientIp"]).toBe("65.181.9.57");
  });

  it("re-signs in exactly once when the operator session has expired", async () => {
    stubFetch([
      () => jsonResponse({ errorCode: 0, result: { token: "csrf-a" } }, ["sid=a"]),
      // Controller answers its web app (HTML) => the session is not valid.
      () => htmlResponse(),
      () => jsonResponse({ errorCode: 0, result: { token: "csrf-b" } }, ["sid=b"]),
      () => jsonResponse({ errorCode: 0 }),
    ]);

    const out = await authorizeExternalPortalClient(CREDS, { clientMac: "AA", timeMs: 60_000 });
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls[2]!.url).toContain("/api/v2/hotspot/login");
    expect((calls[3]!.init.headers as Record<string, string>)["Csrf-Token"]).toBe("csrf-b");
  });

  it("surfaces a real controller refusal without endless retries", async () => {
    stubFetch([
      () => jsonResponse({ errorCode: 0, result: { token: "csrf-1" } }, ["sid=1"]),
      () => jsonResponse({ errorCode: -41500, msg: "This client does not exist." }),
    ]);

    await expect(
      authorizeExternalPortalClient(CREDS, { clientMac: "AA", timeMs: 60_000 }),
    ).rejects.toThrow(/This client does not exist/);
    expect(calls).toHaveLength(2);
  });

  it("rejects a bad operator sign-in with a clear message", async () => {
    stubFetch([() => jsonResponse({ errorCode: -30109, msg: "Invalid username or password." })]);
    await expect(
      authorizeExternalPortalClient(CREDS, { clientMac: "AA", timeMs: 60_000 }),
    ).rejects.toThrow(/hotspot operator sign-in/i);
    expect(calls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Capability gating — the false positive must never return            *
 * ------------------------------------------------------------------ */

const baseCaps = (over: Partial<PortalCapabilities>): PortalCapabilities => ({
  controllerVersion: "6.2.14.11",
  apiVersion: "1",
  listSupported: true,
  listPath: "/portals",
  authorizeSupported: false,
  authorizePath: null,
  authorizeScope: null,
  authorizeMethod: null,
  limitation: null,
  notes: [],
  ...over,
});

describe("authorizePortalClient gating", () => {
  afterEach(() => vi.unstubAllGlobals());

  const session = {
    base: "https://controller.example.com",
    omadacId: "abc123",
    siteId: "site-1",
    token: "open-api-token",
  } as never;

  it("refuses to call ANY endpoint when authorization was not verified", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network call may happen for unverified capabilities");
    });
    await expect(
      authorizePortalClient(session, baseCaps({}), {
        clientMac: "AA",
        clientIp: null,
        apMac: null,
        ssidName: null,
        radioId: null,
        durationMs: 60_000,
      }),
    ).rejects.toThrow(/voucher is safe|cannot put the device online/i);
  });

  it("refuses without hotspot operator credentials even when the API exists", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network call may happen without credentials");
    });
    await expect(
      authorizePortalClient(
        session,
        baseCaps({ authorizeSupported: true, authorizeScope: "hotspot" }),
        { clientMac: "AA", clientIp: null, apMac: null, ssidName: null, radioId: null, durationMs: 60_000 },
        null,
      ),
    ).rejects.toThrow(/Hotspot Operator/i);
  });

  it("never probes or calls the Open API clients/authorize ghost route", () => {
    // `GET .../clients/authorize` matches the client-detail route with the
    // literal MAC "authorize", so it answers -41011 for every request. Treating
    // that as support is the exact bug behind "This client does not exist."
    // Comments may still explain the trap; executable code must not build it.
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const source = stripComments(
      readFileSync(join(__dirname, "..", "omada-portals.server.ts"), "utf8"),
    );
    expect(source.includes("clients/authorize")).toBe(false);
    const hotspot = readFileSync(join(__dirname, "..", "omada-hotspot.server.ts"), "utf8");
    expect(hotspot.includes("extPortal/auth")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Redirect parameters                                                 *
 * ------------------------------------------------------------------ */

describe("portal redirect parameter capture", () => {
  it("captures clientIp from the Omada redirect", () => {
    expect(parsePortalParams({ clientIp: "65.181.9.57" }).clientIp).toBe("65.181.9.57");
    expect(parsePortalParams({ ip: "10.1.2.3" }).clientIp).toBe("10.1.2.3");
    expect(parsePortalParams({}).clientIp).toBeNull();
  });

  it("keeps treating `t` as Omada's timestamp, never as a redirect", () => {
    const params = parsePortalParams({ t: "1730000000000", clientMac: "AA" });
    expect(params.redirectUrl).toBeNull();
  });
});

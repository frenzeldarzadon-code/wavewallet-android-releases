import { describe, expect, it } from "vitest";
import {
  assertSafeLocalUserRequest,
  authorizeShopAdmin,
  buildAddQuotaBody,
  buildCreateBody,
  buildExpiryBody,
  buildPasswordBody,
  nextExpiry,
  toLocalUserView,
  DAY_MS,
  MIB,
} from "@/lib/omada-local-users";

const now = Date.UTC(2026, 9, 16);
const user = () => ({
  id: "abc123",
  userName: "juan",
  password: "secret",
  enable: true,
  expirationTime: now + 5 * DAY_MS,
  bindingType: 0,
  maxUsers: 1,
  rateLimit: { mode: 0, customRateLimit: { downLimitEnable: true, downLimit: 10240, upLimitEnable: true, upLimit: 10240 } },
  trafficLimitEnable: true,
  trafficLimit: 10240, // 10 GB in MB
  trafficUsed: 4 * 1024 * MIB, // 4 GB used
  trafficLimitFrequency: 0,
  trafficLeft: true,
  used: 1,
  overtime: false,
  portals: ["p1"],
  portalNames: ["Main"],
  logout: false,
  applyToAllPortals: false,
  dailyLimitEnable: false,
});

describe("add GB", () => {
  it("adds on top of the current cap and keeps unused data", () => {
    const body = buildAddQuotaBody(user(), 5);
    expect(body["trafficLimit"]).toBe(15360);
    const v = toLocalUserView({ ...user(), trafficLimit: body["trafficLimit"] });
    expect(v.remainingBytes).toBe(11 * 1024 * MIB); // 6 GB left + 5 GB added
  });
  it("never sends the used counter or other computed fields", () => {
    const body = buildAddQuotaBody(user(), 1);
    for (const k of ["trafficUsed", "used", "trafficLeft", "overtime", "id", "portalNames"]) expect(k in body).toBe(false);
    expect(body["enable"]).toBe(true);
    expect(body["password"]).toBe("secret");
  });
  it("refuses unlimited users, zero and negative amounts", () => {
    expect(() => buildAddQuotaBody({ ...user(), trafficLimitEnable: false }, 5)).toThrow(/unlimited/);
    expect(() => buildAddQuotaBody(user(), 0)).toThrow();
    expect(() => buildAddQuotaBody(user(), -3)).toThrow();
  });
});

describe("expiry", () => {
  it("extends from the current expiry when still active", () => {
    expect(nextExpiry(now + 5 * DAY_MS, { mode: "extend", days: 30 }, now)).toBe(now + 35 * DAY_MS);
  });
  it("extends from now when already expired", () => {
    expect(nextExpiry(now - 10 * DAY_MS, { mode: "extend", days: 7 }, now)).toBe(now + 7 * DAY_MS);
  });
  it("set: refuses past dates and dates earlier than the current expiry", () => {
    expect(() => nextExpiry(now + 5 * DAY_MS, { mode: "set", at: now - 1 }, now)).toThrow();
    expect(() => nextExpiry(now + 5 * DAY_MS, { mode: "set", at: now + DAY_MS }, now)).toThrow(/earlier/);
    expect(nextExpiry(now + 5 * DAY_MS, { mode: "set", at: now + 9 * DAY_MS }, now)).toBe(now + 9 * DAY_MS);
  });
  it("only changes expirationTime", () => {
    const body = buildExpiryBody(user(), { mode: "extend", days: 1 }, now);
    expect(body["trafficLimit"]).toBe(10240);
    expect(body["enable"]).toBe(true);
  });
});

describe("forbidden operations", () => {
  const cur = user();
  it("blocks delete, put, patch and non-local-user paths", () => {
    expect(() => assertSafeLocalUserRequest("DELETE", "/hotspot/localusers/abc123")).toThrow();
    expect(() => assertSafeLocalUserRequest("PUT", "/hotspot/localusers/abc123", {}, cur)).toThrow();
    expect(() => assertSafeLocalUserRequest("PATCH", "/hotspot/localusers/abc123", {}, cur)).toThrow();
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/extPortal/auth", {})).toThrow();
    expect(() => assertSafeLocalUserRequest("POST", "/clients/aa/unauthorize", {})).toThrow();
    expect(() => assertSafeLocalUserRequest("GET", "/hotspot/localusers?page=1")).not.toThrow();
  });
  it("blocks disabling a user or resetting usage", () => {
    const off = { ...buildAddQuotaBody(cur, 1), enable: false };
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers/abc123", off, cur)).toThrow(/disables/);
    const reset = { ...buildAddQuotaBody(cur, 1), trafficUsed: 0 };
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers/abc123", reset, cur)).toThrow(/trafficUsed/);
  });
  it("blocks lowering the cap, shortening expiry, or changing other fields", () => {
    const lower = { ...buildAddQuotaBody(cur, 1), trafficLimit: 100 };
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers/abc123", lower, cur)).toThrow(/only go up/);
    const shorter = { ...buildAddQuotaBody(cur, 1), expirationTime: now };
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers/abc123", shorter, cur)).toThrow(/later/);
    const speed = { ...buildAddQuotaBody(cur, 1), maxUsers: 0 };
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers/abc123", speed, cur)).toThrow(/maxUsers/);
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers/abc123", buildAddQuotaBody(cur, 2), cur)).not.toThrow();
  });
  it("create bodies are enabled and carry only required fields", () => {
    const b = buildCreateBody({ userName: "new1", password: "pw", portals: ["p1"], expiresAt: now + DAY_MS, quotaGb: 2 }, now);
    expect(b["trafficLimit"]).toBe(2048);
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers", b)).not.toThrow();
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers", { ...b, enable: false })).toThrow();
  });
});

describe("authorization", () => {
  const rpc = (owner: boolean, admin: boolean) => async (fn: string) => ({
    data: fn === "is_super_admin" ? owner : admin,
    error: null,
  });
  it("allows the shop admin and the platform owner", async () => {
    await expect(authorizeShopAdmin(rpc(false, true), "u", "shop")).resolves.toBeUndefined();
    await expect(authorizeShopAdmin(rpc(true, false), "u", "shop")).resolves.toBeUndefined();
  });
  it("refuses anyone else", async () => {
    await expect(authorizeShopAdmin(rpc(false, false), "u", "shop")).rejects.toThrow(/Only this shop/);
    await expect(authorizeShopAdmin(rpc(false, true), "u", "")).rejects.toThrow();
  });
});

import { toLocalUserView as viewFor } from "./omada-local-users";
describe("password visibility", () => {
  it("shows the password only when Omada returns one", () => {
    expect(viewFor({ id: "a", password: "pw1" }).password).toBe("pw1");
    expect(viewFor({ id: "a" }).password).toBeNull();
    expect(viewFor({ id: "a", password: "" }).password).toBeNull();
  });
});

describe("password change", () => {
  it("changes only the password and keeps usage, cap, expiry and status", () => {
    const cur = user();
    const body = buildPasswordBody(cur, "newpass1");
    expect(body.password).toBe("newpass1");
    expect(body.trafficLimit).toBe(cur.trafficLimit);
    expect(body.expirationTime).toBe(cur.expirationTime);
    expect(body.enable).toBe(true);
    expect("trafficUsed" in body).toBe(false);
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers/abc123", body, cur)).not.toThrow();
  });
  it("rejects empty, too long, spaced or unchanged passwords", () => {
    expect(() => buildPasswordBody(user(), "")).toThrow();
    expect(() => buildPasswordBody(user(), "x".repeat(33))).toThrow();
    expect(() => buildPasswordBody(user(), "a b")).toThrow();
    expect(() => buildPasswordBody(user(), "secret")).toThrow();
  });
  it("still blocks disabling a user while changing the password", () => {
    const cur = user();
    const body = { ...buildPasswordBody(cur, "newpass1"), enable: false };
    expect(() => assertSafeLocalUserRequest("POST", "/hotspot/localusers/abc123", body, cur)).toThrow();
  });
});

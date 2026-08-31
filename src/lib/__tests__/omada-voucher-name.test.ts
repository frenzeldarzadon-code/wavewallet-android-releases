/**
 * Omada rejects any voucher group name outside 1~32 UTF-8 characters. These
 * tests pin the shared normalizer and prove every generation path goes through
 * it, so no outbound payload can carry an invalid name.
 */
import { describe, expect, it } from "vitest";
import {
  OMADA_NAME_MAX_CHARS,
  defaultGroupName,
  nameCharLength,
  normalizeVoucherGroupName,
  validateGenerationPayload,
  defaultGenerationValues,
} from "../omada-generation";
import { replenishmentPayload } from "../voucher-replenishment";
import { createVoucherGroupVerified } from "../omada-vouchers.server";

const chars = (s: string) => Array.from(s).length;

describe("voucher group name normalization", () => {
  it("keeps a 1-character name as is", () => {
    expect(normalizeVoucherGroupName("A")).toBe("A");
  });

  it("keeps a name of exactly 32 characters untouched", () => {
    const exact = "A".repeat(32);
    expect(normalizeVoucherGroupName(exact)).toBe(exact);
    expect(chars(normalizeVoucherGroupName(exact))).toBe(32);
  });

  it("shortens a longer name while keeping the date suffix meaningful", () => {
    const long = "Sagada Wave Unlimited Premium Daily Voucher 2026-08-31";
    const out = normalizeVoucherGroupName(long);
    expect(chars(out)).toBeLessThanOrEqual(OMADA_NAME_MAX_CHARS);
    expect(out.endsWith("2026-08-31")).toBe(true);
    expect(out.startsWith("Sagada Wave")).toBe(true);
  });

  it("is deterministic", () => {
    const long = "A".repeat(60);
    expect(normalizeVoucherGroupName(long)).toBe(normalizeVoucherGroupName(long));
  });

  it("counts code points, never bytes, for multibyte names", () => {
    const unicode = "日本語のバウチャー名前テストです長いですよ本当に長い";
    const out = normalizeVoucherGroupName(unicode);
    expect(chars(out)).toBeLessThanOrEqual(OMADA_NAME_MAX_CHARS);
    expect(unicode.startsWith(out)).toBe(true);
    const emoji = `${"🎟️".repeat(40)}`;
    const cut = normalizeVoucherGroupName(emoji);
    expect(chars(cut)).toBeLessThanOrEqual(OMADA_NAME_MAX_CHARS);
    expect(cut.includes("\uFFFD")).toBe(false);
  });

  it("replaces an empty or blank name with a safe fallback", () => {
    expect(nameCharLength(normalizeVoucherGroupName(""))).toBeGreaterThan(0);
    expect(nameCharLength(normalizeVoucherGroupName("   "))).toBeGreaterThan(0);
    expect(nameCharLength(normalizeVoucherGroupName(undefined))).toBeGreaterThan(0);
    expect(chars(normalizeVoucherGroupName("", "A".repeat(50)))).toBeLessThanOrEqual(
      OMADA_NAME_MAX_CHARS,
    );
  });
});

describe("generation paths cannot bypass the rule", () => {
  it("the default group name stays inside the limit for long product names", () => {
    const out = defaultGroupName("A".repeat(60), []);
    expect(chars(out)).toBeLessThanOrEqual(OMADA_NAME_MAX_CHARS);
    const dupe = defaultGroupName("A".repeat(60), [out]);
    expect(chars(dupe)).toBeLessThanOrEqual(OMADA_NAME_MAX_CHARS);
  });

  it("the replenishment payload normalizes the name and changes nothing else", () => {
    const calibration = { amount: 10, duration: 1440, codeLength: 8 } as never;
    const payload = replenishmentPayload(calibration, "B".repeat(80), 500);
    expect(chars(String(payload["name"]))).toBeLessThanOrEqual(OMADA_NAME_MAX_CHARS);
    expect(payload["amount"]).toBe(500);
    expect(payload["duration"]).toBe(1440);
    expect(payload["codeLength"]).toBe(8);
  });

  it("the outbound Omada request always carries a valid name", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ errorCode: 0, result: { id: "g1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as never;
    try {
      const session = {
        ecosystemId: "shop",
        base: "https://controller",
        omadacId: "cid",
        siteId: "sid",
        token: "tok",
      } as never;
      const created = await createVoucherGroupVerified(session, {
        name: "C".repeat(90),
        amount: 500,
        duration: 1440,
      });
      expect(chars(String(sent[0]?.["name"]))).toBeLessThanOrEqual(OMADA_NAME_MAX_CHARS);
      expect(sent[0]?.["amount"]).toBe(500);
      expect(sent[0]?.["duration"]).toBe(1440);
      expect(created.name).toBe(sent[0]?.["name"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validation flags an over-long name before anything is sent", () => {
    const payload = { ...defaultGenerationValues(), name: "D".repeat(40) };
    expect(validateGenerationPayload(payload).join(" ")).toMatch(/name must be 1 to 32/);
    expect(
      validateGenerationPayload({ ...defaultGenerationValues(), name: "D".repeat(32) }),
    ).toEqual([]);
  });
});

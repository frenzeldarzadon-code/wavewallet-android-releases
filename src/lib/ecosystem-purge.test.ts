import { describe, expect, it } from "vitest";
import {
  PURGE_DELETION_ITEMS,
  PURGE_WARNING,
  canSubmitPurge,
  purgeConfirmationMatches,
  summarizePurge,
} from "@/lib/ecosystem-purge";

const base = {
  step: "confirm" as const,
  ecosystemName: "Sagada Wave One-Stop-Shop",
  typed: "Sagada Wave One-Stop-Shop",
  reason: "Tenant offboarded",
  busy: false,
};

describe("purgeConfirmationMatches", () => {
  it("accepts the exact shop name", () => {
    expect(purgeConfirmationMatches("Coastal Net", "Coastal Net")).toBe(true);
    expect(purgeConfirmationMatches("Coastal Net", "  Coastal Net  ")).toBe(true);
  });

  it("rejects near misses, wrong case and empty input", () => {
    expect(purgeConfirmationMatches("Coastal Net", "coastal net")).toBe(false);
    expect(purgeConfirmationMatches("Coastal Net", "Coastal")).toBe(false);
    expect(purgeConfirmationMatches("Coastal Net", "")).toBe(false);
    expect(purgeConfirmationMatches("", "")).toBe(false);
  });
});

describe("canSubmitPurge", () => {
  it("unlocks only after both steps with an exact name and a reason", () => {
    expect(canSubmitPurge(base)).toBe(true);
  });

  it("stays locked on the first warning step", () => {
    expect(canSubmitPurge({ ...base, step: "warning" })).toBe(false);
  });

  it("stays locked when the typed name does not match exactly", () => {
    expect(canSubmitPurge({ ...base, typed: "sagada wave one-stop-shop" })).toBe(false);
    expect(canSubmitPurge({ ...base, typed: "" })).toBe(false);
  });

  it("requires a reason and blocks double submits", () => {
    expect(canSubmitPurge({ ...base, reason: "   " })).toBe(false);
    expect(canSubmitPurge({ ...base, busy: true })).toBe(false);
  });
});

describe("purge disclosure", () => {
  it("lists every data category the purge removes", () => {
    const text = PURGE_DELETION_ITEMS.join(" ").toLowerCase();
    for (const needle of [
      "member accounts",
      "relationships",
      "credit",
      "points",
      "voucher",
      "transaction",
      "reversal",
      "commission",
      "subscription",
      "facebook",
      "audit",
    ]) {
      expect(text).toContain(needle);
    }
  });

  it("states the action is irreversible and bypasses history protections", () => {
    expect(PURGE_WARNING.toLowerCase()).toContain("cannot be undone");
    expect(PURGE_WARNING.toLowerCase()).toContain("bypasses");
  });
});

describe("summarizePurge", () => {
  it("totals removed records", () => {
    expect(
      summarizePurge({ ecosystem_id: "e1", name: "Coastal Net", counts: { credit_ledger: 3, members: 2 } }),
    ).toBe("Coastal Net deleted — 5 records removed.");
  });

  it("handles an empty shop", () => {
    expect(summarizePurge({ ecosystem_id: "e1", name: "Coastal Net", counts: {} })).toBe(
      "Coastal Net deleted — 0 records removed.",
    );
  });
});

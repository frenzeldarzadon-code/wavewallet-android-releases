import { describe, expect, it } from "vitest";
import {
  diffProfile,
  digitsOf,
  isValidEmail,
  memberIdentityLine,
  memberMatches,
  normalizeEmail,
  validateProfileEdit,
  type MemberSearchResult,
} from "./member-admin";

const member = (over: Partial<MemberSearchResult> = {}): MemberSearchResult => ({
  id: "u1",
  full_name: "Maria Dela Cruz",
  handle: "maria",
  avatar_path: null,
  email: "Maria@Example.com",
  masked_email: "M***@Example.com",
  phone: "0917-555-1234",
  status: "active",
  role: "customer",
  ecosystem_id: "e1",
  ecosystem_name: "Sagada Wave",
  credit_balance: 250,
  points_balance: 40,
  ...over,
});

describe("email handling", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeEmail("  Maria@Example.COM ")).toBe("maria@example.com");
  });

  it("accepts valid addresses and rejects malformed ones", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("maria dela@example.com")).toBe(false);
    expect(isValidEmail("maria@example")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
  });

  it("treats case-different addresses as the same email (duplicate guard)", () => {
    const before = { fullName: "A", phone: "0917", email: "maria@example.com" };
    const after = { fullName: "A", phone: "0917", email: "MARIA@EXAMPLE.COM" };
    expect(diffProfile(before, after)).toEqual({});
  });
});

describe("member matching", () => {
  it("matches partial, case-insensitive name", () => {
    expect(memberMatches(member(), "dela")).toBe(true);
    expect(memberMatches(member(), "MARIA")).toBe(true);
  });

  it("matches partial email", () => {
    expect(memberMatches(member(), "example.com")).toBe(true);
  });

  it("matches a phone regardless of formatting", () => {
    expect(memberMatches(member(), "9175551234")).toBe(true);
    expect(memberMatches(member(), "555 1234")).toBe(true);
    expect(memberMatches(member(), "0000")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(memberMatches(member(), "zzz")).toBe(false);
  });

  it("strips non-digits when comparing phones", () => {
    expect(digitsOf("+63 (917) 555-1234")).toBe("639175551234");
  });
});

describe("identity line (wrong-recipient prevention)", () => {
  it("always shows email and phone", () => {
    expect(memberIdentityLine(member())).toBe("Maria@Example.com · 0917-555-1234");
  });

  it("adds the shop when searching across ecosystems", () => {
    expect(memberIdentityLine(member(), true)).toContain("Sagada Wave");
  });

  it("omits a missing shop name", () => {
    expect(memberIdentityLine(member({ ecosystem_name: null }), true)).not.toContain("·  ");
  });
});

describe("profile edit validation", () => {
  const base = { fullName: "Maria", phone: "09175551234", email: "maria@example.com" };

  it("accepts a well-formed edit", () => {
    expect(validateProfileEdit(base)).toBeNull();
  });

  it("requires a name", () => {
    expect(validateProfileEdit({ ...base, fullName: "  " })).toBe("A full name is required");
  });

  it("requires a phone number", () => {
    expect(validateProfileEdit({ ...base, phone: "" })).toBe("A phone number is required");
  });

  it("rejects an implausibly short phone", () => {
    expect(validateProfileEdit({ ...base, phone: "123" })).toBe("Enter a valid phone number");
  });

  it("rejects a malformed email", () => {
    expect(validateProfileEdit({ ...base, email: "nope" })).toBe("Enter a valid email address");
  });
});

describe("change detection for audit logging", () => {
  const before = { fullName: "Maria", phone: "09175551234", email: "maria@example.com" };

  it("reports nothing when nothing changed", () => {
    expect(diffProfile(before, { ...before })).toEqual({});
  });

  it("reports each changed field", () => {
    expect(
      diffProfile(before, { fullName: "Maria D", phone: "09990001111", email: "m2@example.com" }),
    ).toEqual({ fullName: "Maria D", phone: "09990001111", email: "m2@example.com" });
  });

  it("ignores surrounding whitespace", () => {
    expect(diffProfile(before, { ...before, fullName: "  Maria  " })).toEqual({});
  });
});

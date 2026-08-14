import { describe, expect, it } from "vitest";
import {
  isRealEmail,
  normalizePhone,
  resolveLoginEmail,
  signupAuthEmail,
  validateGlobalSignup,
} from "@/lib/account-identifiers";

const draft = (over: Partial<Parameters<typeof validateGlobalSignup>[0]> = {}) => ({
  name: "Juan Dela Cruz",
  email: "juan@example.com",
  phone: "0917 000 0000",
  password: "supersecret",
  confirm: "supersecret",
  ...over,
});

describe("global account identifiers", () => {
  it("normalises Philippine mobile numbers to one form", () => {
    expect(normalizePhone("+63 917 000 0000")).toBe("09170000000");
    expect(normalizePhone("0917-000-0000")).toBe("09170000000");
    expect(normalizePhone("9170000000")).toBe("09170000000");
  });

  it("accepts email only, phone only or both", () => {
    expect(validateGlobalSignup(draft())).toBeNull();
    expect(validateGlobalSignup(draft({ phone: "" }))).toBeNull();
    expect(validateGlobalSignup(draft({ email: "" }))).toBeNull();
  });

  it("blocks a signup with neither email nor phone", () => {
    expect(validateGlobalSignup(draft({ email: "", phone: "" }))).toMatch(/at least one/i);
  });

  it("still validates what was provided", () => {
    expect(validateGlobalSignup(draft({ email: "nope" }))).toMatch(/email/i);
    expect(validateGlobalSignup(draft({ phone: "12" }))).toMatch(/mobile/i);
    expect(validateGlobalSignup(draft({ name: "  " }))).toMatch(/name/i);
    expect(validateGlobalSignup(draft({ password: "short", confirm: "short" }))).toMatch(/8/);
    expect(validateGlobalSignup(draft({ confirm: "other-pass" }))).toMatch(/match/i);
  });

  it("uses a deterministic address for phone-only accounts", () => {
    const a = signupAuthEmail({ email: "", phone: "+63 917 000 0000" });
    const b = signupAuthEmail({ email: "", phone: "0917 000 0000" });
    expect(a).toBe(b);
    expect(isRealEmail(a)).toBe(false);
    expect(isRealEmail("juan@example.com")).toBe(true);
  });

  it("signs in with either identifier", () => {
    expect(resolveLoginEmail(" Juan@Example.com ")).toBe("juan@example.com");
    expect(resolveLoginEmail("0917 000 0000")).toBe(signupAuthEmail({ email: "", phone: "09170000000" }));
    expect(resolveLoginEmail("abc")).toBeNull();
    expect(resolveLoginEmail("")).toBeNull();
  });
});

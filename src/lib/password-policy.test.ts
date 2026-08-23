import { describe, expect, it } from "vitest";
import { isStrongPassword, newPasswordIssue, passwordIssue } from "@/lib/password-policy";

describe("password policy", () => {
  it("accepts any non-empty password of at least the provider minimum", () => {
    expect(isStrongPassword("Wave!2026")).toBe(true);
    expect(isStrongPassword("wavewallet")).toBe(true);
    expect(isStrongPassword("simple")).toBe(true);
    expect(passwordIssue("123456")).toBeNull();
  });

  it("adds no uppercase, number or special-character requirement", () => {
    expect(passwordIssue("aaaaaa")).toBeNull();
  });

  it("still requires a password", () => {
    expect(passwordIssue("")).toBe("Enter a password.");
  });

  it("surfaces the provider's own minimum length", () => {
    expect(passwordIssue("Aa1!")).toContain("6 characters");
  });

  it("requires the confirmation to match", () => {
    expect(newPasswordIssue("Wave!2026", "Wave!2027")).toBe("The two passwords do not match.");
    expect(newPasswordIssue("Wave!2026", "Wave!2026")).toBeNull();
    expect(newPasswordIssue("simple", "simple")).toBeNull();
  });
});

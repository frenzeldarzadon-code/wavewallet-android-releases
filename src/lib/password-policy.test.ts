import { describe, expect, it } from "vitest";
import {
  isStrongPassword,
  newPasswordIssue,
  passwordChecklist,
  passwordIssue,
} from "@/lib/password-policy";

describe("password policy", () => {
  it("accepts a password meeting every rule", () => {
    expect(isStrongPassword("Wave!2026")).toBe(true);
    expect(passwordIssue("Wave!2026")).toBeNull();
  });

  it("names exactly what is missing", () => {
    const issue = passwordIssue("wavewallet");
    expect(issue).toContain("uppercase");
    expect(issue).toContain("number");
    expect(issue).toContain("special");
    expect(issue).not.toContain("lowercase");
  });

  it("flags short passwords", () => {
    expect(passwordIssue("Aa1!")).toContain("8 characters");
  });

  it("marks each rule satisfied or not as the user types", () => {
    const list = passwordChecklist("Aa1");
    expect(list.find((c) => c.rule.id === "upper")?.ok).toBe(true);
    expect(list.find((c) => c.rule.id === "special")?.ok).toBe(false);
    expect(list.find((c) => c.rule.id === "length")?.ok).toBe(false);
  });

  it("requires the confirmation to match", () => {
    expect(newPasswordIssue("Wave!2026", "Wave!2027")).toBe("The two passwords do not match.");
    expect(newPasswordIssue("Wave!2026", "Wave!2026")).toBeNull();
  });
});

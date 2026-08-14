import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  hasAlternativeLogin,
  identityLabel,
  providerInfo,
  unlinkBlockedReason,
  type LinkedIdentity,
} from "@/lib/auth-providers";

const id = (provider: string): LinkedIdentity => ({ id: provider, provider, email: null });

describe("connected login providers", () => {
  it("offers Google and reports Facebook as not configured", () => {
    expect(providerInfo("google").available).toBe(true);
    const fb = providerInfo("facebook");
    expect(fb.available).toBe(false);
    expect(fb.unavailableReason).toMatch(/Facebook OAuth app/i);
    expect(PROVIDERS).toHaveLength(2);
  });

  it("never lets the last usable login be removed", () => {
    expect(unlinkBlockedReason([id("google")], "google")).toMatch(/only way to sign in/i);
    expect(unlinkBlockedReason([id("email")], "email")).toMatch(/only way to sign in/i);
  });

  it("allows unlinking when another login remains", () => {
    expect(unlinkBlockedReason([id("email"), id("google")], "google")).toBeNull();
    expect(hasAlternativeLogin([id("email"), id("google")], "google")).toBe(true);
  });

  it("refuses to unlink something that is not connected", () => {
    expect(unlinkBlockedReason([id("email")], "google")).toMatch(/not connected/i);
  });

  it("labels identities for humans", () => {
    expect(identityLabel("email")).toBe("Email & password");
    expect(identityLabel("google")).toBe("Google");
  });
});

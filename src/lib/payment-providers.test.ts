import { describe, expect, it } from "vitest";
import {
  parsePaymentNotification,
  providerName,
  resolvePaymentProvider,
} from "@/lib/payment-providers";

describe("payment provider registry", () => {
  it("recognises GCash by package name", () => {
    expect(resolvePaymentProvider("com.globe.gcash.android", null)?.id).toBe("gcash");
  });

  it("recognises GCash by wording when the app id is unfamiliar", () => {
    expect(resolvePaymentProvider("com.example.newshell", "You received PHP 100.00 in GCash")?.id).toBe(
      "gcash",
    );
  });

  it("leaves unrelated apps unrecognised", () => {
    expect(resolvePaymentProvider("com.whatsapp", "Mom: are you home?")).toBeNull();
    expect(parsePaymentNotification("com.whatsapp", "Mom: are you home?")).toBeNull();
  });

  it("reads an incoming GCash payment through the provider", () => {
    const read = parsePaymentNotification(
      "com.globe.gcash.android",
      "You have received PHP 500.00 from JUAN D. 09171234567. Ref. No. 1234567890123",
    );
    expect(read?.provider.id).toBe("gcash");
    expect(read?.parsed.incoming).toBe(true);
    expect(read?.parsed.amountPhp).toBe(500);
  });

  it("names providers for display", () => {
    expect(providerName("gcash")).toBe("GCash");
    expect(providerName(null)).toBe("Unknown app");
  });
});

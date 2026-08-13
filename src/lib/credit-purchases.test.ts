import { describe, expect, it } from "vitest";
import {
  RELEASE_WARNING,
  STATUS_LABEL,
  amountDue,
  creditGcashAccount,
  formatPhp,
  supportContact,
} from "@/lib/credit-purchases";

describe("amountDue", () => {
  it("charges the full list price with no discount", () => {
    expect(amountDue(10, 0)).toBe(10);
  });

  it("charges nothing at the default 100% admin benefit", () => {
    expect(amountDue(250, 100)).toBe(0);
  });

  it("applies a partial discount and rounds to centavos", () => {
    expect(amountDue(10, 33)).toBe(6.7);
    expect(amountDue(99.99, 50)).toBe(50);
  });

  it("clamps nonsense discounts instead of inventing negative prices", () => {
    expect(amountDue(10, 150)).toBe(0);
    expect(amountDue(10, -20)).toBe(10);
  });
});

describe("formatPhp", () => {
  it("always shows two decimals with the configured currency", () => {
    expect(formatPhp(0)).toBe("PHP 0.00");
    expect(formatPhp(1234.5, "PHP")).toBe("PHP 1,234.50");
  });
});

describe("status labels", () => {
  it("never presents a pending payment as released credits", () => {
    expect(STATUS_LABEL.pending).toMatch(/pending/i);
    expect(STATUS_LABEL.rejected).toMatch(/rejected/i);
    expect(STATUS_LABEL.frozen).toMatch(/frozen/i);
    expect(STATUS_LABEL.approved).toMatch(/released/i);
  });

  it("warns that released credits can still be frozen", () => {
    expect(RELEASE_WARNING).toMatch(/freeze or withhold/i);
  });
});

describe("support contact for the credit purchase flow", () => {
  const base = { support_page_name: "WaveWallet Support", support_page_url: "", support_message: "" };

  it("returns null when no contact URL is configured", () => {
    expect(supportContact(null)).toBeNull();
    expect(supportContact(base)).toBeNull();
    expect(supportContact({ ...base, support_page_url: "   " })).toBeNull();
  });

  it("returns the configured page name and URL", () => {
    const c = supportContact({
      ...base,
      support_page_url: "https://facebook.com/wavewallet",
      support_message: "Message us for payment concerns.",
    });
    expect(c?.href).toBe("https://facebook.com/wavewallet");
    expect(c?.label).toBe("WaveWallet Support");
    expect(c?.message).toBe("Message us for payment concerns.");
  });

  it("falls back to the host when no page name is set", () => {
    expect(
      supportContact({ ...base, support_page_name: "", support_page_url: "https://www.facebook.com/x" })
        ?.label,
    ).toBe("facebook.com");
  });

  it("rejects unsafe or malformed URLs", () => {
    expect(supportContact({ ...base, support_page_url: "javascript:alert(1)" })).toBeNull();
    expect(supportContact({ ...base, support_page_url: "not a url" })).toBeNull();
  });
});

describe("creditGcashAccount", () => {
  const base = {
    admin_credit_discount_percent: 100,
    admin_voucher_discount_percent: 100,
    credit_gcash_number: "",
    credit_gcash_account_name: "",
    credit_payment_instructions: "",
    credit_release_mode: "manual",
    default_admin_sale_commission_percent: 0,
    currency: "PHP",
  };

  it("falls back to the platform collection account", () => {
    expect(
      creditGcashAccount({
        ...base,
        gcash_number: "0917",
        gcash_account_name: "Owner",
        payment_instructions: "Send now",
      }),
    ).toEqual({ number: "0917", accountName: "Owner", instructions: "Send now" });
  });

  it("prefers the credit-specific account when published", () => {
    expect(
      creditGcashAccount({
        ...base,
        credit_gcash_number: "0918",
        credit_gcash_account_name: "Credits",
        gcash_number: "0917",
        gcash_account_name: "Owner",
      }),
    ).toEqual({ number: "0918", accountName: "Credits", instructions: "" });
  });

  it("returns null when nothing is configured", () => {
    expect(creditGcashAccount(base)).toBeNull();
    expect(creditGcashAccount(null)).toBeNull();
  });
});

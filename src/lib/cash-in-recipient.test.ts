import { describe, expect, it } from "vitest";
import { canDecideMoney, canRequestMoney, cashInDecisionError } from "./wallet-money";

/**
 * SUPER ADMIN APPROVES; THE REQUESTING MEMBER RECEIVES.
 *
 * The authoritative proof lives in supabase/tests/cash-in-recipient.sql, which
 * was run live against the project database with two distinct user ids:
 * approving a customer's 1,000 credit cash in moved the CUSTOMER from 10.00 to
 * 1010.00 while the approving super admin stayed at 1000.00, the lot carried
 * the member's ecosystem, the issuance recorded operator = super admin /
 * recipient = customer, a second approval was refused, and a super admin could
 * not submit a cash in for themselves. These tests lock the client contract.
 */

describe("recipient is never the approver", () => {
  it("keeps the platform owner out of the requesting roles", () => {
    expect(canRequestMoney("super_admin")).toBe(false);
    for (const role of ["customer", "subreseller", "reseller", "admin"]) {
      expect(canRequestMoney(role)).toBe(true);
      expect(canDecideMoney(role)).toBe(false);
    }
    expect(canDecideMoney("super_admin")).toBe(true);
  });

  it("explains a blocked recipient mismatch without leaking SQL", () => {
    expect(
      cashInDecisionError("Recipient mismatch: refusing to credit an account that is not the requesting member"),
    ).toMatch(/would not have gone to the member/i);
    expect(cashInDecisionError("Refusing to credit the approving platform owner")).toMatch(
      /would not have gone to the member/i,
    );
  });

  it("explains why a platform owner request cannot be approved", () => {
    expect(
      cashInDecisionError(
        "The platform owner does not hold a member credit balance, so this request cannot be approved",
      ),
    ).toMatch(/no member coin balance/i);
  });

  it("explains a request with no member attached", () => {
    expect(cashInDecisionError("This request has no member attached, so credits cannot be released")).toMatch(
      /no coins were issued/i,
    );
  });

  it("still explains duplicate approval and role boundaries", () => {
    expect(cashInDecisionError("This request was already approved")).toMatch(/already decided/);
    expect(cashInDecisionError("Only the platform owner can decide cash in requests")).toMatch(/platform owner/);
  });
});

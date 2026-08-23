import { describe, expect, it } from "vitest";
import {
  isShopPaymentMethod,
  paymentMethodScope,
  paymentMethodScopeLabel,
  selectableMethodsForShop,
  subscriptionPaymentMethods,
  subscriptionRequiresPaymentVerification,
} from "./payment-method-scope";

const m = (ecosystem_id: string | null, active = true) => ({ ecosystem_id, active });

const SHOP_A = "aaaaaaaa-0000-0000-0000-000000000001";
const SHOP_B = "bbbbbbbb-0000-0000-0000-000000000002";

describe("payment method scope", () => {
  it("marks platform-owned accounts as global", () => {
    expect(paymentMethodScope(m(null))).toBe("platform");
    expect(isShopPaymentMethod(m(null))).toBe(false);
    expect(paymentMethodScopeLabel(m(null))).toBe("WaveWallet payment method");
  });

  it("marks shop-owned accounts clearly", () => {
    expect(paymentMethodScope(m(SHOP_A))).toBe("shop");
    expect(paymentMethodScopeLabel(m(SHOP_A))).toBe("Shop payment method");
  });

  it("offers global + own shop accounts to a shop payer", () => {
    const list = [m(null), m(SHOP_A), m(SHOP_B)];
    expect(selectableMethodsForShop(list, SHOP_A)).toEqual([m(null), m(SHOP_A)]);
  });

  it("never offers another shop's account", () => {
    const list = [m(SHOP_A)];
    expect(selectableMethodsForShop(list, SHOP_B)).toEqual([]);
  });

  it("hides inactive accounts", () => {
    expect(selectableMethodsForShop([m(SHOP_A, false)], SHOP_A)).toEqual([]);
  });

  it("keeps subscription payments on platform accounts only", () => {
    expect(subscriptionPaymentMethods([m(null), m(SHOP_A)])).toEqual([m(null)]);
  });

  it("requires verification for every priced plan, and only skips zero price", () => {
    expect(subscriptionRequiresPaymentVerification(150, 1)).toBe(true);
    expect(subscriptionRequiresPaymentVerification(150, 12)).toBe(true);
    expect(subscriptionRequiresPaymentVerification(0, 12)).toBe(false);
  });
});

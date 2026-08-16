import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_SETTINGS,
  cartCount,
  cartLines,
  cartTotal,
  changeQuantity,
  checkoutProblem,
  enabledStores,
  orderTone,
  type Cart,
  type CheckoutDraft,
  type RetailProduct,
  type StoreSettings,
} from "@/lib/retail";

const product = (id: string, price: number, stock: number): RetailProduct => ({
  id,
  name: `Item ${id}`,
  description: null,
  image_path: null,
  price,
  stock,
  sold_count: 0,
  public_visible: true,
  rating_avg: 0,
  rating_count: 0,
});

const products = [product("a", 25, 10), product("b", 10.5, 2)];

const settings: StoreSettings = {
  ...DEFAULT_STORE_SETTINGS,
  retailEnabled: true,
};

const draft = (over: Partial<CheckoutDraft> = {}): CheckoutDraft => ({
  fulfillment: "pickup",
  payment: "cash",
  address: "",
  notes: "",
  ...over,
});

describe("cart", () => {
  const cart: Cart = { a: 2, b: 1 };

  it("prices multiple different products and quantities", () => {
    expect(cartCount(cart)).toBe(3);
    expect(cartTotal(cart, products)).toBe(60.5);
    expect(cartLines(cart, products).map((l) => l.lineTotal)).toEqual([50, 10.5]);
  });

  it("never lets a quantity exceed stock", () => {
    const capped = changeQuantity({ b: 2 }, products[1]!, 5);
    expect(capped["b"]).toBe(2);
  });

  it("drops a product when its quantity reaches zero", () => {
    expect(changeQuantity({ a: 1 }, products[0]!, -1)).toEqual({});
  });
});

describe("checkoutProblem", () => {
  const total = 60.5;

  it("accepts a valid pickup + cash order", () => {
    expect(checkoutProblem(draft(), total, settings, 0, 3)).toBeNull();
  });

  it("blocks an empty cart", () => {
    expect(checkoutProblem(draft(), 0, settings, 0, 0)).toMatch(/empty/i);
  });

  it("requires an address for delivery", () => {
    expect(checkoutProblem(draft({ fulfillment: "delivery" }), total, settings, 0, 1)).toMatch(
      /address/i,
    );
    expect(
      checkoutProblem(
        draft({ fulfillment: "delivery", address: "12 Main St" }),
        total,
        settings,
        0,
        1,
      ),
    ).toBeNull();
  });

  it("hides cash when the admin disabled it", () => {
    expect(
      checkoutProblem(draft(), total, { ...settings, cashEnabled: false }, 0, 1),
    ).toMatch(/cash/i);
  });

  it("requires enough shop credits for a credit order", () => {
    expect(checkoutProblem(draft({ payment: "credit" }), total, settings, 10, 1)).toMatch(
      /coins/i,
    );
    expect(checkoutProblem(draft({ payment: "credit" }), total, settings, 100, 1)).toBeNull();
  });

  it("refuses delivery when the shop only does pickup", () => {
    expect(
      checkoutProblem(
        draft({ fulfillment: "delivery", address: "x" }),
        total,
        { ...settings, deliveryEnabled: false },
        0,
        1,
      ),
    ).toMatch(/delivery/i);
  });
});

describe("enabledStores", () => {
  it("shows only the stores the admin turned on", () => {
    expect(enabledStores({ ...settings, retailEnabled: false })).toEqual(["voucher"]);
    expect(enabledStores({ ...settings, voucherEnabled: false })).toEqual(["retail"]);
    expect(enabledStores(settings)).toEqual(["voucher", "retail"]);
    expect(enabledStores({ ...settings, voucherEnabled: false, retailEnabled: false })).toEqual([]);
  });
});

describe("orderTone", () => {
  it("separates every order state", () => {
    expect(orderTone("pending")).toBe("warning");
    expect(orderTone("approved")).toBe("success");
    expect(orderTone("rejected")).toBe("danger");
    expect(orderTone("cancelled")).toBe("muted");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_SETTINGS,
  EMPTY_CATALOG_FILTER,
  cartCount,
  cartLines,
  cartTotal,
  changeQuantity,
  checkoutProblem,
  storefrontProblem,
  STOREFRONT_NOTE_MAX,
  enabledStores,
  filterProducts,
  isProductReady,
  orderTone,
  productCategories,
  type Cart,
  type CheckoutDraft,
  type RetailProduct,
  type RetailProductRow,
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
    expect(checkoutProblem(draft(), total, { ...settings, cashEnabled: false }, 0, 1)).toMatch(
      /cash/i,
    );
  });

  it("requires enough shop credits for a credit order", () => {
    expect(checkoutProblem(draft({ payment: "credit" }), total, settings, 10, 1)).toMatch(/coins/i);
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

describe("admin catalog filtering", () => {
  const row = (over: Partial<RetailProductRow>): RetailProductRow => ({
    ...product("x", 10, 5),
    active: true,
    archived: false,
    cashback_mode: "disabled",
    cashback_value: 0,
    category: "Instant Noodles",
    brand: "Lucky Me",
    variant: null,
    size_label: "55 g",
    unit: "piece",
    wholesale_price: 8,
    wholesale_min_qty: 12,
    sku: null,
    barcode: null,
    published: true,
    template_id: "t1",
    ...over,
  });

  const rows = [
    row({ id: "a", name: "Pancit Canton" }),
    row({
      id: "b",
      name: "Sagada Coffee",
      category: "Coffee",
      template_id: null,
      published: false,
    }),
    row({ id: "c", name: "Old Stock", archived: true, published: false }),
  ];

  it("hides archived products unless asked for", () => {
    expect(
      filterProducts(rows, { ...EMPTY_CATALOG_FILTER, status: "published" }).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      filterProducts(rows, { ...EMPTY_CATALOG_FILTER, status: "draft" }).map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      filterProducts(rows, { ...EMPTY_CATALOG_FILTER, status: "archived" }).map((r) => r.id),
    ).toEqual(["c"]);
  });

  it("separates starter-catalog products from manually added ones", () => {
    expect(
      filterProducts(rows, { ...EMPTY_CATALOG_FILTER, source: "manual" }).map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      filterProducts(rows, { ...EMPTY_CATALOG_FILTER, source: "catalog" }).map((r) => r.id),
    ).toEqual(["a", "c"]);
  });

  it("searches names, brands and sizes and filters by category", () => {
    expect(
      filterProducts(rows, { ...EMPTY_CATALOG_FILTER, search: "sagada" }).map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      filterProducts(rows, { ...EMPTY_CATALOG_FILTER, category: "Coffee" }).map((r) => r.id),
    ).toEqual(["b"]);
    expect(productCategories(rows)).toEqual(["Coffee", "Instant Noodles"]);
  });

  it("only calls a product ready when it has a price and stock", () => {
    expect(isProductReady(row({ price: 0 }))).toBe(false);
    expect(isProductReady(row({ stock: 0 }))).toBe(false);
    expect(isProductReady(row({}))).toBe(true);
  });
});

describe("storefront availability", () => {
  it("blocks new orders while the shop is paused", () => {
    const paused = { ...DEFAULT_STORE_SETTINGS, retailEnabled: true, acceptingOrders: false };
    expect(
      checkoutProblem(
        { fulfillment: "pickup", payment: "cash", address: "", notes: "" },
        10,
        paused,
        0,
        1,
      ),
    ).toMatch(/temporarily closed/);
    expect(
      checkoutProblem(
        { fulfillment: "pickup", payment: "cash", address: "", notes: "" },
        10,
        { ...paused, acceptingOrders: true },
        0,
        1,
      ),
    ).toBeNull();
  });
  it("limits the paused note length", () => {
    expect(storefrontProblem({ pausedNote: "x".repeat(STOREFRONT_NOTE_MAX) })).toBeNull();
    expect(storefrontProblem({ pausedNote: "x".repeat(STOREFRONT_NOTE_MAX + 1) })).toMatch(/160/);
  });
});

describe("seller workspace stages", () => {
  const base = { payment_method: "cash" as const, cod_settled_at: null, hold_held: false };
  it("maps the existing state machine onto workspace tabs", () => {
    expect(orderStage({ ...base, status: "pending", fulfillment_status: "awaiting" })).toBe("new");
    expect(orderStage({ ...base, status: "approved", fulfillment_status: "accepted" })).toBe("preparing");
    expect(orderStage({ ...base, status: "approved", fulfillment_status: "preparing" })).toBe("preparing");
    expect(orderStage({ ...base, status: "approved", fulfillment_status: "ready" })).toBe("ready");
    expect(orderStage({ ...base, status: "approved", fulfillment_status: "out_for_delivery" })).toBe("in_delivery");
    expect(orderStage({ ...base, status: "approved", fulfillment_status: "delivered" })).toBe("delivered");
    expect(orderStage({ ...base, status: "approved", fulfillment_status: "completed" })).toBe("completed");
    expect(orderStage({ ...base, status: "rejected", fulfillment_status: "closed" })).toBe("closed");
    expect(orderStage({ ...base, status: "cancelled", fulfillment_status: "closed" })).toBe("closed");
  });
  it("keeps a COD order out of Completed until its float is settled", () => {
    const cod = { ...base, payment_method: "cod" as const, status: "approved" as const, fulfillment_status: "completed" as const };
    expect(orderStage({ ...cod, hold_held: true })).toBe("delivered");
    expect(orderStage({ ...cod, cod_settled_at: "2026-09-03T00:00:00Z" })).toBe("completed");
  });
  it("builds a timeline from existing timestamps only", () => {
    const t = orderTimeline({
      created_at: "2026-09-01T00:00:00Z", status: "approved", fulfillment: "delivery", payment_method: "cod",
      delivered_at: "2026-09-02T00:00:00Z", completed_at: "2026-09-02T01:00:00Z",
      cod_cash_received_at: "2026-09-02T02:00:00Z", cod_settled_at: "2026-09-02T02:00:01Z",
    });
    expect(t.map((x) => x.label)).toEqual(["Order placed", "Delivered", "Buyer confirmed receipt", "Collector confirmed cash", "Settled"]);
  });
});

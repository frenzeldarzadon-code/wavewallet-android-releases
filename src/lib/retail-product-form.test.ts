import { describe, expect, it } from "vitest";
import {
  EMPTY_PRODUCT_DRAFT,
  duplicateDraft,
  normalizeStock,
  retailPriceOf,
  sellerCutOf,
  validateProductDraft,
} from "./retail-product-form";

const base = { ...EMPTY_PRODUCT_DRAFT, name: "Rice 1 kg", price: "100", stock: "10" };

describe("locked pricing model", () => {
  it("Seller's Cut ₱100 → Retail Price ₱101 at 1%", () => {
    expect(retailPriceOf("100", 1)).toBe(101);
    expect(retailPriceOf("100", 0)).toBe(100);
  });
  it("Retail Price ₱101 → Seller's Cut ₱100 (inverse is exact)", () => {
    expect(sellerCutOf("101", 1)).toBe("100");
    expect(retailPriceOf(sellerCutOf("101", 1), 1)).toBe(101);
  });
  it("blank or zero never produces a price", () => {
    expect(retailPriceOf("", 1)).toBe(0);
    expect(sellerCutOf("0", 1)).toBe("");
  });
});

describe("stock", () => {
  it("never goes negative and is whole units", () => {
    expect(normalizeStock("-4")).toBe(0);
    expect(normalizeStock("3.6")).toBe(4);
    expect(normalizeStock("")).toBe(0);
  });
  it("rejects negative or fractional stock in the form", () => {
    expect(validateProductDraft({ ...base, stock: "-1" }).map((p) => p.field)).toContain("stock");
    expect(validateProductDraft({ ...base, stock: "2.5" }).map((p) => p.field)).toContain("stock");
  });
});

describe("draft validation", () => {
  it("accepts a plain valid product", () => {
    expect(validateProductDraft(base)).toEqual([]);
  });
  it("requires a name", () => {
    expect(validateProductDraft({ ...base, name: " " })[0]?.field).toBe("name");
  });
  it("requires price and stock only when publishing", () => {
    const draft = { ...base, price: "", stock: "0" };
    expect(validateProductDraft(draft)).toEqual([]);
    const fields = validateProductDraft({ ...draft, published: true }).map((p) => p.field);
    expect(fields).toEqual(["price", "stock"]);
  });
  it("bulk price must be below regular price with a minimum of 2+", () => {
    expect(
      validateProductDraft({ ...base, wholesale_price: "120", wholesale_min_qty: "12" }).map(
        (p) => p.field,
      ),
    ).toEqual(["wholesale_price"]);
    expect(
      validateProductDraft({ ...base, wholesale_price: "90", wholesale_min_qty: "1" }).map(
        (p) => p.field,
      ),
    ).toEqual(["wholesale_min_qty"]);
    expect(validateProductDraft({ ...base, wholesale_price: "90", wholesale_min_qty: "12" })).toEqual(
      [],
    );
  });
  it("bounds seller cashback", () => {
    expect(
      validateProductDraft({ ...base, cashback_mode: "percent", cashback_value: "150" })[0]?.field,
    ).toBe("cashback_value");
    expect(
      validateProductDraft({ ...base, cashback_mode: "fixed", cashback_value: "101" })[0]?.field,
    ).toBe("cashback_value");
  });
});

describe("duplicate", () => {
  it("copies as an unpublished draft without id, SKU or barcode", () => {
    const copy = duplicateDraft({ ...base, id: "x", sku: "A1", barcode: "B", published: true });
    expect(copy.id).toBeUndefined();
    expect(copy.name).toBe("Rice 1 kg (copy)");
    expect(copy.sku).toBe("");
    expect(copy.published).toBe(false);
    expect(copy.price).toBe("100");
  });
});

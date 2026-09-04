import { describe, expect, it } from "vitest";
import { buildPurchaseShopLabels, purchaseShopFor } from "@/lib/customer-shops";

describe("purchase shop labels", () => {
  const labels = buildPurchaseShopLabels(
    [
      { id: "a", name: "Sagada Wave One-Stop Shop", slug: "sagadawave", logo_path: "l/a.jpg", public_storefront_enabled: true },
      { id: "b", name: "Closed Shop", slug: "closed", archived_at: "2026-01-01T00:00:00Z", public_storefront_enabled: true },
      { id: "c", name: "Private Shop", slug: "private", public_storefront_enabled: false },
    ],
    [{ id: "u1", full_name: "Juan Dela Cruz" }, { id: "u2", full_name: null }],
  );

  it("resolves the shop from the sale's recorded shop id", () => {
    expect(purchaseShopFor(labels, "a")).toMatchObject({ name: "Sagada Wave One-Stop Shop", slug: "sagadawave", logoPath: "l/a.jpg", storefrontOpen: true });
  });

  it("keeps the name of archived/closed shops but withholds the storefront link", () => {
    expect(purchaseShopFor(labels, "b")?.storefrontOpen).toBe(false);
    expect(purchaseShopFor(labels, "c")?.storefrontOpen).toBe(false);
    expect(purchaseShopFor(labels, "b")?.name).toBe("Closed Shop");
  });

  it("never guesses an unknown shop", () => {
    expect(purchaseShopFor(labels, "zzz")).toBeNull();
    expect(purchaseShopFor(null, "a")).toBeNull();
    expect(purchaseShopFor(labels, null)).toBeNull();
  });

  it("only maps sellers with a display name", () => {
    expect(labels.sellers).toEqual({ u1: "Juan Dela Cruz" });
  });
});

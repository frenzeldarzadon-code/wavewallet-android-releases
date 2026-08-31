import { describe, expect, it } from "vitest";
import {
  canSubmitProductDeletion,
  productDeleteConfirmationMatches,
  productDeletionWarning,
} from "../voucher-product-deletion";
import { decideReplenishment } from "../voucher-replenishment";
import { replenishProduct, type AdminClient } from "../voucher-replenishment.server";

describe("voucher product deletion confirmation", () => {
  it("requires an exact product-name confirmation", () => {
    expect(productDeleteConfirmationMatches("6 HOURS PHP20", " 6 HOURS PHP20 ")).toBe(true);
    expect(productDeleteConfirmationMatches("6 HOURS PHP20", "6 hours php20")).toBe(false);
    expect(productDeleteConfirmationMatches("", "")).toBe(false);
  });

  it("blocks double clicks while the delete is running", () => {
    const base = { name: "Product A", typed: "Product A" };
    expect(canSubmitProductDeletion({ ...base, busy: false })).toBe(true);
    expect(canSubmitProductDeletion({ ...base, busy: true })).toBe(false);
  });

  it("states plainly that Omada and history are untouched", () => {
    const text = productDeletionWarning("Product A", 500);
    expect(text).toContain("500");
    expect(text).toContain("Omada");
    expect(text).toContain("Coins");
  });
});

/** Minimal fake of the service-role client used by the replenishment job. */
function fakeAdmin(product: { archived: boolean } | null): {
  client: AdminClient;
  touched: string[];
} {
  const touched: string[] = [];
  const client = {
    from(table: string) {
      touched.push(table);
      const builder: Record<string, unknown> = {};
      const chain = new Proxy(builder, {
        get(_t, prop: string) {
          if (prop === "maybeSingle") {
            return async () => ({
              data:
                table === "voucher_products" && product
                  ? { id: "A", name: "Product A", archived: product.archived }
                  : null,
              error: null,
            });
          }
          if (prop === "then") return undefined;
          return () => chain;
        },
      });
      return chain;
    },
    async rpc() {
      throw new Error("no rpc expected");
    },
  } as unknown as AdminClient;
  return { client, touched };
}

describe("deleted products can never replenish", () => {
  it("skips a product that no longer exists instead of generating", async () => {
    const { client, touched } = fakeAdmin(null);
    const result = await replenishProduct(client, { ecosystemId: "e1", productId: "A" });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("product_deleted");
    expect(touched).toEqual(["voucher_products"]);
  });

  it("skips an archived product as well", async () => {
    const { client } = fakeAdmin({ archived: true });
    const result = await replenishProduct(client, { ecosystemId: "e1", productId: "A" });
    expect(result.reason).toBe("product_deleted");
  });

  it("leaves the low-stock rule for live products unchanged", () => {
    expect(
      decideReplenishment({ available: 40, hasCalibration: true, runInProgress: false }).amount,
    ).toBe(500);
  });
});

import { describe, expect, it } from "vitest";
import { sellerCardAction } from "./universe-shop-discovery";

describe("sellerCardAction", () => {
  it("labels every seller card as 'Buy from My Shop'", () => {
    expect(sellerCardAction()).toEqual({ text: "Buy from My Shop", icon: false });
  });
});

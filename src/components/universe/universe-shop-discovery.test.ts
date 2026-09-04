import { describe, expect, it } from "vitest";
import { sellerCardAction } from "./universe-shop-discovery";

describe("sellerCardAction", () => {
  it("labels the current user's own shop as 'Buy from My Shop'", () => {
    expect(sellerCardAction(true)).toEqual({ text: "Buy from My Shop", icon: false });
  });

  it("keeps an arrow action for other sellers", () => {
    expect(sellerCardAction(false)).toEqual({ text: "Buy", icon: true });
  });
});

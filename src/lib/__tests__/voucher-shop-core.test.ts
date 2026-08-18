import { describe, expect, it } from "vitest";
import { Wallet, ShoppingBag, User } from "lucide-react";
import {
  customerBottomNav,
  resellerBottomNav,
  withCoreDestinations,
  type NavItem,
} from "@/lib/navigation";
import { paymentLabel, voucherFileName } from "@/lib/voucher-image";

const core: NavItem[] = [
  { to: "/app", label: "Wallet", icon: Wallet },
  { to: "/app/shop", label: "Shop", icon: ShoppingBag },
];

describe("permanent bottom-nav destinations", () => {
  it("adds Wallet Center and Voucher Shop when a list forgets them", () => {
    const out = withCoreDestinations([{ to: "/app/profile", label: "Profile", icon: User }], core);
    expect(out.map((i) => i.to)).toEqual(["/app", "/app/shop", "/app/profile"]);
  });

  it("never drops them even when the list is already full", () => {
    const filler: NavItem[] = ["a", "b", "c", "d", "e"].map((k) => ({
      to: `/app/${k}` as NavItem["to"],
      label: k,
      icon: User,
    }));
    const out = withCoreDestinations(filler, core);
    expect(out).toHaveLength(5);
    expect(out.some((i) => i.to === "/app")).toBe(true);
    expect(out.some((i) => i.to === "/app/shop")).toBe(true);
  });

  it("keeps them in the shipped customer and reseller bars", () => {
    expect(customerBottomNav.map((i) => i.to)).toEqual(
      expect.arrayContaining(["/app", "/app/shop"]),
    );
    expect(resellerBottomNav.map((i) => i.to)).toEqual(
      expect.arrayContaining(["/reseller/wallet", "/reseller/shop"]),
    );
    expect(customerBottomNav.length).toBeLessThanOrEqual(5);
    expect(resellerBottomNav.length).toBeLessThanOrEqual(5);
  });
});

describe("voucher image files", () => {
  it("gives every voucher of one purchase its own file name", () => {
    const a = voucherFileName({ productName: "1 Day WiFi", code: "ABC-123", index: 1 });
    const b = voucherFileName({ productName: "1 Day WiFi", code: "XYZ-999", index: 2 });
    expect(a).not.toBe(b);
    expect(a).toMatch(/\.png$/);
    expect(a).toContain("1-day-wifi");
  });

  it("labels the informational payment status", () => {
    expect(paymentLabel("paid")).toBe("PAID");
    expect(paymentLabel("credited")).toBe("CREDITED");
    expect(paymentLabel(null)).toBeNull();
  });
});

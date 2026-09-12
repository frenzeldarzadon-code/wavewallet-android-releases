/**
 * Universe shops have no membership approval; New Generation shops keep it.
 * The database is authoritative — these tests only pin the console surfaces.
 */
import { describe, expect, it } from "vitest";
import {
  adminBottomNavFor,
  adminNav,
  navPaths,
  resellerBottomNavFor,
  resellerNav,
} from "@/lib/navigation";
import { usesMembershipApproval } from "@/lib/shop-type";

describe("membership approval is a New Generation rule", () => {
  it("only New Generation (or an unresolved shop type) uses approval", () => {
    expect(usesMembershipApproval("new_generation")).toBe(true);
    expect(usesMembershipApproval(null)).toBe(true);
    expect(usesMembershipApproval("universe_voucher")).toBe(false);
    expect(usesMembershipApproval("universe_retail")).toBe(false);
    expect(usesMembershipApproval("universe_mixed")).toBe(false);
    expect(usesMembershipApproval("universe_unset")).toBe(false);
  });

  it("hides the admin New Members review for Universe shops", () => {
    for (const t of ["universe_voucher", "universe_retail"] as const) {
      expect(navPaths(adminNav({ shopType: t }))).not.toContain("/admin/applications");
      expect(adminBottomNavFor(t).map((i) => i.to)).not.toContain("/admin/applications");
    }
  });

  it("keeps the admin New Members review for New Generation shops", () => {
    expect(navPaths(adminNav({ shopType: "new_generation" }))).toContain("/admin/applications");
    expect(adminBottomNavFor("new_generation").map((i) => i.to)).toContain("/admin/applications");
  });

  it("hides the seller New Members review for Universe shops only", () => {
    for (const role of ["reseller", "subreseller"] as const) {
      expect(navPaths(resellerNav(role, "universe_voucher"))).not.toContain(
        "/reseller/applications",
      );
      expect(navPaths(resellerNav(role, "new_generation"))).toContain("/reseller/applications");
    }
    expect(resellerBottomNavFor("universe_retail").map((i) => i.to)).not.toContain(
      "/reseller/applications",
    );
    expect(resellerBottomNavFor("new_generation").map((i) => i.to)).toContain(
      "/reseller/applications",
    );
  });

  it("keeps the seller selling tools when the review tab is hidden", () => {
    const paths = navPaths(resellerNav("reseller", "universe_voucher"));
    expect(paths).toEqual(
      expect.arrayContaining(["/reseller/shop", "/reseller/wallet", "/reseller/customers"]),
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  adminGatedPaths,
  adminNav,
  customerNav,
  flattenNav,
  navForRole,
  navPaths,
  resellerNav,
  restrictNav,
  superAdminNav,
  withBadges,
} from "@/lib/navigation";

describe("role sidebar visibility", () => {
  it("gives a customer the wallet center, shop, rewards and profile", () => {
    const paths = navPaths(customerNav());
    expect(paths).toEqual(
      expect.arrayContaining([
        "/app",
        "/app/shop",
        "/app/rewards",
        "/app/profile",
      ]),
    );
  });

  it("consolidates transfer and history into the wallet center", () => {
    const customer = navPaths(customerNav());
    expect(customer).not.toContain("/app/transfer");
    expect(customer).not.toContain("/app/history");
    const seller = navPaths(resellerNav("subreseller"));
    expect(seller).not.toContain("/reseller/transfer");
    expect(seller).not.toContain("/reseller/history");
    expect(navPaths(adminNav())).toContain("/admin/wallet");
  });

  it("never shows a customer any shop-staff or platform destination", () => {
    const paths = navPaths(customerNav());
    expect(paths.some((p) => p.startsWith("/admin"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/super"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/reseller"))).toBe(false);
  });

  it("gives a subreseller the selling tools plus member review only", () => {
    const paths = navPaths(resellerNav("subreseller"));
    expect(paths).toEqual(
      expect.arrayContaining([
        "/reseller/wallet",
        "/reseller/shop",
        "/reseller/profile",
        "/reseller/applications",
      ]),
    );
    expect(paths).not.toContain("/reseller/customers");
    expect(paths).not.toContain("/reseller/earnings");
    expect(paths).not.toContain("/reseller/redemptions");
    expect(paths).not.toContain("/reseller/reports");
  });

  it("keeps customer features out of the Shop Dashboard — Universe owns them", () => {
    for (const nav of [resellerNav("reseller"), adminNav(), superAdminNav()]) {
      const paths = navPaths(nav);
      expect(paths).not.toContain("/reseller/rewards");
      expect(paths).not.toContain("/universe");
      expect(paths).not.toContain("/universe/messages");
    }
    expect(navPaths(adminNav())).toContain("/admin/storefront");
  });

  it("adds downlines, redemptions, earnings and reports for a reseller", () => {
    const paths = navPaths(resellerNav("reseller"));
    expect(paths).toEqual(
      expect.arrayContaining([
        "/reseller/customers",
        "/reseller/redemptions",
        "/reseller/earnings",
        "/reseller/reports",
      ]),
    );
  });

  it("keeps the admin console complete but without the subscription tab", () => {
    const paths = navPaths(adminNav());
    expect(paths).toEqual(
      expect.arrayContaining([
        "/admin",
        "/admin/resellers",
        "/admin/customers",
        "/admin/applications",
        "/admin/products",
        "/admin/vouchers",
        "/admin/money",
        "/admin/wallets",
        "/admin/transactions",
        "/admin/reports",
        "/admin/settings",
        "/admin/profile",
      ]),
    );
    expect(paths).not.toContain("/admin/subscription");
    expect(paths).not.toContain("/admin/credits");
  });

  it("groups every super admin approval queue behind one destination", () => {
    const paths = navPaths(superAdminNav());
    expect(paths).toContain("/super/approvals");
    expect(paths).toContain("/super/members");
    expect(paths).not.toContain("/super/subscriptions");
  });

  it("resolves the sidebar for every role", () => {
    expect(navPaths(navForRole("customer"))).toContain("/app");
    expect(navPaths(navForRole("subreseller"))).toContain("/reseller/wallet");
    expect(navPaths(navForRole("reseller"))).toContain("/reseller/earnings");
    expect(navPaths(navForRole("admin"))).toContain("/admin");
    expect(navPaths(navForRole("super_admin"))).toContain("/super");
  });

  it("labels its groups so the sidebar can render section headers", () => {
    expect(adminNav().every((g) => !!g.label)).toBe(true);
    expect(flattenNav(adminNav()).length).toBeGreaterThan(10);
  });
});

describe("badges and lockout", () => {
  it("applies pending counts to matching destinations only", () => {
    const nav = withBadges(superAdminNav(), { "/super/approvals": 4 });
    const items = flattenNav(nav);
    expect(items.find((i) => i.to === "/super/approvals")?.badge).toBe(4);
    expect(items.find((i) => i.to === "/super/reports")?.badge).toBeUndefined();
  });

  it("ignores zero counts", () => {
    const nav = withBadges(superAdminNav(), { "/super/approvals": 0 });
    expect(flattenNav(nav).find((i) => i.to === "/super/approvals")?.badge).toBeUndefined();
  });

  it("keeps only read-only screens while a shop is locked out", () => {
    const restricted = navPaths(restrictNav(adminNav(), adminGatedPaths));
    expect(restricted).toEqual(expect.arrayContaining(["/admin", "/admin/reports"]));
    expect(restricted).not.toContain("/admin/subscription");
    expect(restricted).not.toContain("/admin/money");
    expect(restricted).not.toContain("/admin/wallets");
  });
});

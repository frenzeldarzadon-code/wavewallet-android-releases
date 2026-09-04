/**
 * Universe is the customer portal.
 *
 * The per-shop customer console under /app is obsolete for customers: every
 * customer-facing screen now has a Universe destination. This maps an old /app
 * URL onto the matching Universe (or public storefront) route so bookmarks,
 * notification links and old buttons keep working. Management consoles
 * (/admin, /reseller, /super) are untouched.
 */
export interface PortalContext {
  /** Active shop of the session, when the member has one. */
  shopId?: string | null;
  shopSlug?: string | null;
  /** Voucher code carried by /app/monitor?code=… */
  code?: string | null;
}

export interface UniverseDestination {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
}

/** True for every path under the old customer console. */
export function isLegacyCustomerPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export function universeDestinationFor(pathname: string, ctx: PortalContext = {}): UniverseDestination {
  const path = pathname.replace(/\/+$/, "") || "/app";
  const shopId = ctx.shopId ?? null;
  const shopSlug = ctx.shopSlug ?? null;
  switch (path) {
    case "/app":
    case "/app/money":
    case "/app/history":
    case "/app/transfer":
      return { to: "/universe/wallet" };
    case "/app/monitor":
      return shopId
        ? {
            to: "/universe/monitor/$shopId",
            params: { shopId },
            ...(ctx.code ? { search: { code: ctx.code } } : {}),
          }
        : { to: "/universe/monitor" };
    case "/app/rewards":
      return shopId ? { to: "/universe/rewards/$shopId", params: { shopId } } : { to: "/universe/rewards" };
    case "/app/shop":
    case "/app/store":
      return shopSlug ? { to: "/shop/$slug", params: { slug: shopSlug } } : { to: "/universe/shops" };
    case "/app/applications":
      return { to: "/universe/shops" };
    case "/app/profile":
      return { to: "/universe/profile" };
    case "/app/messages":
      return { to: "/universe/messages" };
    case "/app/social":
    case "/app/omada":
    default:
      return path === "/app/omada" && shopId
        ? { to: "/universe/monitor/$shopId", params: { shopId } }
        : { to: "/universe" };
  }
}

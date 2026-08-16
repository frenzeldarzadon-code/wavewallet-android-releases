/** Client-side check: is this the Lovable preview / local dev environment? */
export function isPreviewEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost")) return true;
  if (h.startsWith("id-preview--") && h.endsWith(".lovable.app")) return true;
  if (h.endsWith("-dev.lovable.app")) return true;
  if (h.endsWith(".lovableproject.com")) return true;
  return false;
}

export const DEMO_ECOSYSTEM_SLUG = "demo-preview";

export const DEMO_ROLES = [
  { role: "customer" as const, label: "Customer", hint: "Wallet, points, shop, rewards" },
  { role: "reseller" as const, label: "Reseller", hint: "Load coins, redemptions, earnings" },
  { role: "subreseller" as const, label: "Subreseller", hint: "Discounted vouchers, sale credit-back" },
  { role: "admin" as const, label: "Admin", hint: "Shop, vouchers, rewards, members" },
  { role: "super_admin" as const, label: "Super Admin", hint: "All ecosystems overview" },
];

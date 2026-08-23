/**
 * Where a receiving account may be used.
 *
 * A payment method is either platform-wide (`ecosystem_id` null, configured by
 * the platform owner) or shop-owned (`ecosystem_id` set, configured by that
 * shop's admin). Shop-owned accounts are an intentional per-shop exception:
 * they are isolated to their own shop and never offered to another shop.
 *
 * Owning the receiving account never implies trust: payments into a shop-owned
 * account go through exactly the same receipt extraction, listener matching and
 * review path as platform accounts. The only case that skips verification is
 * the existing zero-price subscription rule.
 */
import type { PaymentMethod } from "@/lib/wallet-money";

export type PaymentMethodScope = "platform" | "shop";

export const paymentMethodScope = (m: Pick<PaymentMethod, "ecosystem_id">): PaymentMethodScope =>
  m.ecosystem_id ? "shop" : "platform";

export const isShopPaymentMethod = (m: Pick<PaymentMethod, "ecosystem_id">): boolean =>
  paymentMethodScope(m) === "shop";

export const paymentMethodScopeLabel = (m: Pick<PaymentMethod, "ecosystem_id">): string =>
  isShopPaymentMethod(m) ? "Shop payment method" : "WaveWallet payment method";

/** Accounts a payer inside `ecosystemId` may use for cash in. */
export function selectableMethodsForShop<T extends Pick<PaymentMethod, "ecosystem_id" | "active">>(
  methods: T[],
  ecosystemId: string | null,
): T[] {
  return methods.filter(
    (m) => m.active !== false && (!m.ecosystem_id || m.ecosystem_id === ecosystemId),
  );
}

/**
 * Accounts a shop admin may pay WaveWallet's own subscription into.
 * Only platform-wide accounts: a shop can never pay itself.
 */
export function subscriptionPaymentMethods<T extends Pick<PaymentMethod, "ecosystem_id" | "active">>(
  methods: T[],
): T[] {
  return methods.filter((m) => m.active !== false && !m.ecosystem_id);
}

/**
 * Verification is required for every priced subscription payment, whichever
 * account it was paid into. Only the zero-price rule skips it.
 */
export const subscriptionRequiresPaymentVerification = (
  monthlyPrice: number,
  months = 1,
): boolean => Math.round(Number(monthlyPrice || 0) * Math.max(1, months) * 100) / 100 > 0;

/**
 * Legacy shop exception: "use the platform payment methods for customer cash in".
 *
 * Normal (Subscription) shops have exactly one customer-facing source of truth —
 * the receiving accounts attached to their own integrated Listener. Legacy shops
 * predate that model: their members always paid into the platform-wide account,
 * so those shops keep an explicit opt-in flag (`ecosystems.use_platform_payment_methods`).
 *
 * The flag only decides WHICH receiving accounts the cash in screen lists. It never
 * touches the shop's subscription payment to WaveWallet, and it never changes
 * matching: the >=2 independent signals rule, OCR corroboration and duplicate
 * reference protection all run unchanged server-side.
 *
 * Authorisation lives in the database: a shop admin may flip it only for a legacy
 * shop, the platform owner may flip it for any shop, and every change is audited.
 */
import { supabase } from "@/integrations/supabase/client";

export interface PlatformPaymentOption {
  /** True when members of this shop are shown the platform receiving accounts. */
  enabled: boolean;
  /** True for legacy (non-subscription) shops. */
  legacy: boolean;
  /** True when the signed-in operator is allowed to change the setting. */
  canChange: boolean;
}

export const DEFAULT_PLATFORM_PAYMENT_OPTION: PlatformPaymentOption = {
  enabled: false,
  legacy: false,
  canChange: false,
};

export async function fetchPlatformPaymentOption(
  ecosystemId: string | null,
): Promise<PlatformPaymentOption> {
  if (!ecosystemId) return DEFAULT_PLATFORM_PAYMENT_OPTION;
  const { data, error } = await supabase.rpc("ecosystem_platform_payment_option", {
    _ecosystem: ecosystemId,
  });
  if (error || !data) return DEFAULT_PLATFORM_PAYMENT_OPTION;
  const row = data as { enabled?: boolean; legacy?: boolean; can_change?: boolean };
  return {
    enabled: Boolean(row.enabled),
    legacy: Boolean(row.legacy),
    canChange: Boolean(row.can_change),
  };
}

export async function setPlatformPaymentOption(
  ecosystemId: string,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_ecosystem_platform_payment_methods", {
    _ecosystem: ecosystemId,
    _enabled: enabled,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

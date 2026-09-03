/**
 * Reads whether the active shop is a New Generation (subscription) shop and
 * whether it is still in Demo mode, so the Admin console can surface the
 * Go Live action instead of hiding it behind the /review page.
 *
 * Also exposes the shop type (New Generation / Universe Voucher / Universe
 * Retail) derived from the same shop record, so the console only shows the
 * tools that belong to that type.
 *
 * Read-only. Legacy shops report `isNewGeneration: false` and every Go Live
 * affordance stays hidden for them.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { deriveShopType, type ShopTypeState } from "@/lib/shop-type";

export interface ShopStatus {
  name: string;
  shopKind: string | null;
  shopType: ShopTypeState | null;
  isDemo: boolean;
  isNewGeneration: boolean;
  reviewEndsAt: string | null;
  subscriptionState: string | null;
  planName: string | null;
  loading: boolean;
}

const EMPTY: ShopStatus = {
  name: "",
  shopKind: null,
  shopType: null,
  isDemo: false,
  isNewGeneration: false,
  reviewEndsAt: null,
  subscriptionState: null,
  planName: null,
  loading: true,
};

export function useShopStatus(ecosystemId: string | null, refreshKey = 0): ShopStatus {
  const [status, setStatus] = useState<ShopStatus>(EMPTY);

  useEffect(() => {
    if (!ecosystemId) {
      setStatus({ ...EMPTY, loading: false });
      return;
    }
    let active = true;
    const load = () =>
      void supabase
        .from("ecosystems")
        .select(
          "name, shop_kind, is_review, review_ends_at, subscription_state, plan_name, store_voucher_enabled, store_retail_enabled",
        )
        .eq("id", ecosystemId)
        .maybeSingle()
        .then(({ data }) => {
          if (!active) return;
          if (!data) {
            setStatus({ ...EMPTY, loading: false });
            return;
          }
          const row = data as {
            name: string;
            shop_kind: string | null;
            is_review: boolean | null;
            review_ends_at: string | null;
            subscription_state: string | null;
            plan_name: string | null;
            store_voucher_enabled: boolean;
            store_retail_enabled: boolean;
          };
          setStatus({
            name: row.name,
            shopKind: row.shop_kind,
            shopType: deriveShopType({
              shop_kind: row.shop_kind ?? "universe",
              store_voucher_enabled: row.store_voucher_enabled,
              store_retail_enabled: row.store_retail_enabled,
            }),
            isNewGeneration: row.shop_kind === "subscription",
            isDemo: row.shop_kind === "subscription" && Boolean(row.is_review),
            reviewEndsAt: row.review_ends_at,
            subscriptionState: row.subscription_state,
            planName: row.plan_name,
            loading: false,
          });
        });
    load();
    // Shop type changes dispatch this event so the console re-reads its type.
    window.addEventListener("wavewallet:session", load);
    return () => {
      active = false;
      window.removeEventListener("wavewallet:session", load);
    };
  }, [ecosystemId, refreshKey]);

  return status;
}

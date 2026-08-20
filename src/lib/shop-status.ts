/**
 * Reads whether the active shop is a New Generation (subscription) shop and
 * whether it is still in Demo mode, so the Admin console can surface the
 * Go Live action instead of hiding it behind the /review page.
 *
 * Read-only. Legacy shops report `isNewGeneration: false` and every Go Live
 * affordance stays hidden for them.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ShopStatus {
  name: string;
  shopKind: string | null;
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
    void supabase
      .from("ecosystems")
      .select("name, shop_kind, is_review, review_ends_at, subscription_state, plan_name")
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
        };
        setStatus({
          name: row.name,
          shopKind: row.shop_kind,
          isNewGeneration: row.shop_kind === "subscription",
          isDemo: row.shop_kind === "subscription" && Boolean(row.is_review),
          reviewEndsAt: row.review_ends_at,
          subscriptionState: row.subscription_state,
          planName: row.plan_name,
          loading: false,
        });
      });
    return () => {
      active = false;
    };
  }, [ecosystemId, refreshKey]);

  return status;
}

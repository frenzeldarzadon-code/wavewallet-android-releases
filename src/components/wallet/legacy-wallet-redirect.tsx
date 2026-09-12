/**
 * Legacy personal-wallet routes (`/app`, `/app/money`, `/reseller/wallet`,
 * `/reseller/money`, `/admin/wallet`) now point at the single personal wallet
 * centre: Universe → My Wallet. The old links keep working — they redirect.
 *
 * New Generation shops are financially isolated and have no Universe wallet, so
 * members whose active shop is a New Generation shop keep the existing
 * shop-scoped screen instead of being redirected.
 */
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import { WalletCenter, type WalletCenterProps } from "@/components/wallet/wallet-center";
import { MoneyPage } from "@/components/money/money-page";

export function LegacyWalletRedirect({
  fallback,
  ...props
}: WalletCenterProps & { fallback?: "wallet" | "money" }) {
  const navigate = useNavigate();
  const { ecosystem, ready } = useSession();
  // Only Universe members have a global wallet; anything else (New Generation
  // or an unresolved shop) keeps its existing isolated screen.
  const isolated = ecosystem?.shopKind !== "universe";

  useEffect(() => {
    if (!ready || isolated) return;
    void navigate({ to: "/universe/wallet", replace: true });
  }, [ready, isolated, navigate]);

  if (!ready) return null;
  if (!isolated) return null;
  return fallback === "money" ? <MoneyPage /> : <WalletCenter {...props} />;
}

/**
 * Self-contained wrappers for content blocks a Super Admin may move to another
 * tab. Each one renders the SAME component with the same data source and rules
 * it uses on its original tab — only the location changes.
 */
import { WalletCenter } from "@/components/wallet/wallet-center";
import { AdminEarningsPanel } from "@/components/admin-earnings-panel";
import { useSession } from "@/lib/session";

export function MovableWalletCenter() {
  return <WalletCenter base="/app" />;
}

export function MovableAdminEarnings() {
  const { account, ecosystemDbId } = useSession();
  return <AdminEarningsPanel ecosystemId={ecosystemDbId} adminId={account?.id ?? null} />;
}

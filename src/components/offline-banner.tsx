/**
 * Connectivity strip.
 *
 * Real money movement (Coin transfers, WiFi voucher purchases, Cashback,
 * Points, cash in, cash out, subscriptions) is always authorized live by the
 * backend, so it simply cannot run while the device is offline. Anything still
 * on screen at that point is saved information, never current financial truth,
 * and nothing is queued to run later.
 */
import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/pwa";

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-center text-xs font-semibold text-destructive-foreground"
    >
      <WifiOff className="size-4 shrink-0" />
      <span>
        Offline — showing saved information. Balances may be out of date and transactions are
        unavailable until the connection is back.
      </span>
    </div>
  );
}

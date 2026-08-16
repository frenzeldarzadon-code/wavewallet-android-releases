/**
 * Connectivity strip. Real money movement (Coin transfers, WiFi voucher
 * purchases, cash in, cash out, subscription payments) is always authorized by
 * the backend, so it simply cannot run while the device is offline — this makes
 * that state obvious instead of leaving a request to fail silently.
 */
import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/pwa";

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-center text-xs font-semibold text-destructive-foreground"
    >
      <WifiOff className="size-4 shrink-0" />
      You are offline — transfers, voucher purchases, cash in and cash out are unavailable until
      the connection is back.
    </div>
  );
}

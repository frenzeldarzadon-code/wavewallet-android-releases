import { Suspense, lazy } from "react";

// The QR renderer is only pulled in when a code is actually shown.
const QRCodeSVG = lazy(() => import("qrcode.react").then((m) => ({ default: m.QRCodeSVG })));
import { cn } from "@/lib/utils";

/**
 * Renders the redemption code as a scannable QR locally — no external service.
 * The encoded payload is the human-readable code so staff can also key it in.
 */
export function RedemptionQr({
  code,
  size = 176,
  className,
}: {
  code: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-5",
        className,
      )}
    >
      <div className="rounded-lg bg-white p-3">
        <Suspense fallback={<div style={{ width: size, height: size }} />}>
          <QRCodeSVG value={code} size={size} level="M" />
        </Suspense>
      </div>
      <p className="font-mono text-base font-semibold tracking-widest">{code}</p>
    </div>
  );
}

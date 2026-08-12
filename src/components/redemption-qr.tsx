import { QRCodeSVG } from "qrcode.react";
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
        <QRCodeSVG value={code} size={size} level="M" />
      </div>
      <p className="font-mono text-base font-semibold tracking-widest">{code}</p>
    </div>
  );
}

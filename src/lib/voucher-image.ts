/**
 * Premium shareable voucher images.
 *
 * Every issued code gets its OWN image file — never a combined sheet — so a
 * seller can hand one voucher to one buyer. Rendering happens on a canvas in
 * the browser from the data the purchase RPC actually returned; nothing here
 * touches pricing, wallets or inventory.
 */

export type PaymentStatus = "paid" | "credited" | null;

export interface VoucherImageData {
  code: string;
  productName: string;
  description?: string | null;
  priceLabel: string;
  shopName: string;
  customerName?: string | null;
  paymentStatus: PaymentStatus;
  /** 1-based position inside this purchase. */
  index: number;
  total: number;
  txId: string;
  issuedAt: Date;
}

const W = 1080;
const H = 1350;

/** Safe, unique file name per voucher — no two files can overwrite each other. */
export function voucherFileName(data: Pick<VoucherImageData, "productName" | "code" | "index">) {
  const slug = data.productName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const code = data.code.replace(/[^A-Za-z0-9]+/g, "").slice(0, 24) || "voucher";
  return `wavewallet-${slug || "voucher"}-${String(data.index).padStart(2, "0")}-${code}.png`;
}

/** Human label for the informational payment marker. */
export function paymentLabel(status: PaymentStatus): string | null {
  if (status === "paid") return "PAID";
  if (status === "credited") return "CREDITED";
  return null;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, start: number) {
  let size = start;
  do {
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    if (ctx.measureText(text).width <= max) break;
    size -= 2;
  } while (size > 18);
  return size;
}

/** Draws one premium voucher and returns it as a PNG blob. */
export async function renderVoucherImage(data: VoucherImageData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device cannot generate the voucher image.");

  // Background: deep navy with a blue glow, matching the app's premium surface.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0b1b34");
  bg.addColorStop(0.55, "#0e2c56");
  bg.addColorStop(1, "#071324");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.85, H * 0.1, 20, W * 0.85, H * 0.1, W * 0.8);
  glow.addColorStop(0, "rgba(56,189,248,0.35)");
  glow.addColorStop(1, "rgba(56,189,248,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#7dd3fc";
  ctx.font = "600 34px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("WAVEWALLET VOUCHER", 80, 130);

  ctx.fillStyle = "#e2e8f0";
  const shopSize = fitText(ctx, data.shopName, W - 160, 54);
  ctx.font = `700 ${shopSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(data.shopName, 80, 200);

  // Card
  const cx = 70;
  const cy = 260;
  const cw = W - 140;
  const ch = 760;
  ctx.save();
  ctx.shadowColor = "rgba(2,6,23,0.55)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#f8fafc";
  roundRect(ctx, cx, cy, cw, ch, 48);
  ctx.fill();
  ctx.restore();

  // Product
  ctx.fillStyle = "#0f172a";
  const nameSize = fitText(ctx, data.productName, cw - 120, 64);
  ctx.font = `700 ${nameSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(data.productName, cx + 60, cy + 120);

  if (data.description) {
    ctx.fillStyle = "#475569";
    ctx.font = "400 30px ui-sans-serif, system-ui, sans-serif";
    const desc =
      data.description.length > 60 ? `${data.description.slice(0, 57)}…` : data.description;
    ctx.fillText(desc, cx + 60, cy + 170);
  }

  // Price + payment marker
  ctx.fillStyle = "#0369a1";
  ctx.font = "700 44px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(data.priceLabel, cx + 60, cy + 250);

  const marker = paymentLabel(data.paymentStatus);
  if (marker) {
    ctx.font = "700 30px ui-sans-serif, system-ui, sans-serif";
    const tw = ctx.measureText(marker).width + 56;
    const mx = cx + cw - 60 - tw;
    ctx.fillStyle = marker === "PAID" ? "#16a34a" : "#0284c7";
    roundRect(ctx, mx, cy + 210, tw, 56, 28);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(marker, mx + 28, cy + 249);
  }

  // Perforation
  ctx.strokeStyle = "#cbd5e1";
  ctx.setLineDash([14, 14]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + 40, cy + 310);
  ctx.lineTo(cx + cw - 40, cy + 310);
  ctx.stroke();
  ctx.setLineDash([]);

  // Code block
  ctx.fillStyle = "#0b1b34";
  roundRect(ctx, cx + 50, cy + 360, cw - 100, 220, 32);
  ctx.fill();

  ctx.fillStyle = "#7dd3fc";
  ctx.font = "600 26px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("WIFI VOUCHER CODE", cx + cw / 2, cy + 425);

  ctx.fillStyle = "#ffffff";
  let codeSize = 84;
  do {
    ctx.font = `700 ${codeSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    if (ctx.measureText(data.code).width <= cw - 160) break;
    codeSize -= 3;
  } while (codeSize > 28);
  ctx.fillText(data.code, cx + cw / 2, cy + 520);
  ctx.textAlign = "left";

  // Customer + numbering
  ctx.fillStyle = "#334155";
  ctx.font = "500 30px ui-sans-serif, system-ui, sans-serif";
  let line = cy + 645;
  if (data.customerName) {
    ctx.fillText(`Issued to: ${data.customerName}`, cx + 60, line);
    line += 46;
  }
  ctx.fillStyle = "#64748b";
  ctx.font = "400 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`Voucher ${data.index} of ${data.total}`, cx + 60, line);
  ctx.fillText(
    `${data.issuedAt.toLocaleString()} · Ref ${data.txId.slice(0, 12)}`,
    cx + 60,
    line + 42,
  );

  // Footer
  ctx.fillStyle = "rgba(226,232,240,0.75)";
  ctx.font = "400 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Connect to the hotspot and enter this code to start browsing.", 80, H - 120);
  ctx.fillStyle = "rgba(125,211,252,0.9)";
  ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Powered by WaveWallet", 80, H - 70);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image."))),
      "image/png",
    ),
  );
}

/** Saves one blob to the device as its own file. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** True when the device can share image files natively. */
export function canShareFiles(files: File[]): boolean {
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  return typeof nav.share === "function" && !!nav.canShare?.({ files });
}

/** Shares a single voucher image; falls back to a download when sharing is unavailable. */
export async function shareVoucherImage(blob: Blob, fileName: string, title: string) {
  const file = new File([blob], fileName, { type: "image/png" });
  if (canShareFiles([file])) {
    await navigator.share({ files: [file], title });
    return "shared" as const;
  }
  downloadBlob(blob, fileName);
  return "downloaded" as const;
}

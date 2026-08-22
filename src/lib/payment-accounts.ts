/**
 * Receiving / payment accounts — provider-agnostic.
 *
 * A receiving account is where a member actually sends real money (GCash today,
 * any bank or wallet later). Each account may carry a QR code image so a payer
 * scans instead of typing account details.
 *
 * Rules that matter here:
 *  - The uploaded QR image is authoritative. Decoding it is a convenience for
 *    prefilling metadata only; a QR that cannot be read is still accepted.
 *  - QR objects live in the PRIVATE `payment-qr` bucket at
 *    `{ecosystem_id|global}/{uuid}.webp`, so storage RLS keeps a shop's QR
 *    codes inside that shop. Platform-wide accounts use the `global` folder.
 *  - Nothing here decides anything financial: matching, approval and duplicate
 *    protection stay in the database.
 */
import jsQR from "jsqr";
import { supabase } from "@/integrations/supabase/client";

export const PAYMENT_QR_BUCKET = "payment-qr";
export const MAX_QR_BYTES = 8 * 1024 * 1024;
const QR_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
/** QR codes must stay crisp enough to scan, so we only cap the longest side. */
const QR_MAX_SIDE = 1000;

export interface PaymentProviderRow {
  id: string;
  name: string;
  active: boolean | null;
}

export function validateQrImage(file: { type: string; size: number }): string | null {
  if (!QR_TYPES.includes((file.type || "").toLowerCase())) return "Use a JPG, PNG or WEBP image.";
  if (file.size > MAX_QR_BYTES) return "That image is larger than 8 MB.";
  return null;
}

function loadBitmapImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    img.src = url;
  });
}

function drawToCanvas(img: HTMLImageElement, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/**
 * Best-effort read of the QR payload. Never throws: an unreadable QR simply
 * returns null and the uploaded image is still used as-is.
 */
export async function decodeQrImage(file: File): Promise<string | null> {
  try {
    const img = await loadBitmapImage(file);
    const { canvas, ctx } = drawToCanvas(img, 1400);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(data.data, canvas.width, canvas.height);
    return found?.data?.trim() || null;
  } catch {
    return null;
  }
}

/** Uploads a QR image and returns its storage path. Never overwrites. */
export async function uploadPaymentQr(
  ecosystemId: string | null,
  file: File,
): Promise<{ path: string; content: string | null }> {
  const problem = validateQrImage(file);
  if (problem) throw new Error(problem);
  const content = await decodeQrImage(file);
  const img = await loadBitmapImage(file);
  const { canvas } = drawToCanvas(img, QR_MAX_SIDE);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/webp", 0.92),
  );
  if (!blob) throw new Error("Could not process that image.");
  const path = `${ecosystemId ?? "global"}/${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage
    .from(PAYMENT_QR_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw new Error(error.message);
  return { path, content };
}

export async function deletePaymentQr(path?: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage.from(PAYMENT_QR_BUCKET).remove([path]);
}

const urlCache = new Map<string, { url: string; expires: number }>();

/** Short-lived signed URL — QR images are never served from a public URL. */
export async function paymentQrUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(PAYMENT_QR_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

/** Saves the QR image to the payer's device. */
export async function downloadPaymentQr(path: string, fileName: string): Promise<void> {
  const { data, error } = await supabase.storage.from(PAYMENT_QR_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Could not download that QR code.");
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "payment"}-qr.webp`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Supported providers, for the receiving-account form. */
export async function fetchPaymentProviders(): Promise<PaymentProviderRow[]> {
  const { data, error } = await supabase
    .from("payment_provider_registry")
    .select("id, name, active")
    .order("name");
  if (error) return [];
  return (data ?? []).filter((p) => p.active !== false) as PaymentProviderRow[];
}

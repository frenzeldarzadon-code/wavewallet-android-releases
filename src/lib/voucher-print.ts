/**
 * Voucher printing (presentation only).
 *
 * Loads the EXACT vouchers already issued for one voucher-sale transaction and
 * describes the print templates. Nothing here issues, prices, consumes or
 * modifies a voucher — every query is a read.
 */
import { supabase } from "@/integrations/supabase/client";

/** Physical size of one printed voucher. Never scaled. */
export const VOUCHER_PRINT_WIDTH_IN = 2;
export const VOUCHER_PRINT_HEIGHT_IN = 2;

export type VoucherTemplateId =
  | "classic"
  | "minimal"
  | "modern"
  | "geometric"
  | "futuristic"
  | "pastel"
  | "luxury"
  | "aurora"
  | "pop"
  | "organic"
  | "neon"
  | "mono";

export interface VoucherTemplate {
  id: VoucherTemplateId;
  name: string;
  description: string;
}

/** Visual styling only — all templates render identical voucher data. */
export const voucherTemplates: VoucherTemplate[] = [
  { id: "classic", name: "Classic Premium", description: "Timeless framed ticket with a refined cut line." },
  { id: "minimal", name: "Minimal", description: "Quiet Swiss card, maximum code legibility." },
  { id: "modern", name: "Very Modern", description: "Editorial product card with a bold accent edge." },
  { id: "geometric", name: "Geometric", description: "Precise shapes and a premium retail composition." },
  { id: "futuristic", name: "Futuristic", description: "Sleek dark tech surface with a fine grid." },
  { id: "pastel", name: "Pastel", description: "Soft refined pastels, elegant and youthful." },
  { id: "luxury", name: "Luxury", description: "Black-tie card with restrained gold accents." },
  { id: "aurora", name: "Aurora Glass", description: "Translucent gradient panel with a clear code plate." },
  { id: "pop", name: "Bold Pop", description: "Confident shapes and heavyweight typography." },
  { id: "organic", name: "Organic", description: "Earthy palette with soft natural curves." },
  { id: "neon", name: "Neon Night", description: "Dark nightlife card with controlled neon accents." },
  { id: "mono", name: "Mono Press", description: "Inked editorial press stub in monospace." },
];

export function isVoucherTemplate(v: string): v is VoucherTemplateId {
  return voucherTemplates.some((t) => t.id === v);
}

export interface PrintableVoucherSale {
  saleId: string;
  txId: string;
  productName: string;
  description: string | null;
  /** Customer-facing retail price of the product at sale time. */
  listPrice: number;
  quantity: number;
  createdAt: string;
  shopName: string;
  codes: string[];
}

/**
 * Reads one transaction and every voucher code that belongs to it.
 * RLS decides visibility; this never widens access.
 */
export async function fetchPrintableSale(saleId: string): Promise<PrintableVoucherSale | null> {
  const { data: sale } = await supabase
    .from("voucher_sales")
    .select("id, tx_id, product_name, list_price, quantity, created_at, ecosystem_id, product_id")
    .eq("id", saleId)
    .maybeSingle();
  if (!sale) return null;

  const [{ data: codes }, { data: shop }, { data: product }] = await Promise.all([
    supabase.from("voucher_codes").select("code").eq("sale_id", saleId).order("code"),
    supabase.from("ecosystems").select("name").eq("id", sale.ecosystem_id).maybeSingle(),
    supabase.from("voucher_products").select("description").eq("id", sale.product_id).maybeSingle(),
  ]);

  return {
    saleId: sale.id,
    txId: sale.tx_id,
    productName: sale.product_name,
    description: product?.description ?? null,
    listPrice: Number(sale.list_price),
    quantity: Number(sale.quantity ?? 0),
    createdAt: sale.created_at,
    shopName: shop?.name ?? "WaveWallet",
    codes: (codes ?? []).map((c) => c.code),
  };
}

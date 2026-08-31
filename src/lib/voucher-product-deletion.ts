/**
 * Permanent deletion of ONE Voucher Shop product.
 *
 * WaveWallet-side only: the product, its own WaveWallet voucher codes, its own
 * import records and its own calibration go away. Nothing is ever sent to
 * Omada, and no sale, wallet, points or other product is touched — sales keep
 * their stored product snapshot and simply lose the link to the deleted row.
 *
 * The database function `delete_voucher_product` re-checks the admin, the typed
 * name and the scope inside one transaction; everything here is presentation.
 */
import { supabase } from "@/integrations/supabase/client";

export interface DeleteProductResult {
  deleted: boolean;
  already_deleted: boolean;
  name?: string;
  codes_removed: number;
  runs_cancelled?: number;
}

/** The typed confirmation must match the product name exactly (trimmed). */
export function productDeleteConfirmationMatches(name: string, typed: string): boolean {
  return name.trim().length > 0 && typed.trim() === name.trim();
}

/** Guard against double clicks and half-typed confirmations. */
export function canSubmitProductDeletion(input: {
  name: string;
  typed: string;
  busy: boolean;
}): boolean {
  if (input.busy) return false;
  return productDeleteConfirmationMatches(input.name, input.typed);
}

/** Plain-language summary shown in the confirmation dialog. */
export function productDeletionWarning(name: string, unusedCodes: number): string {
  return (
    `Deleting “${name}” removes the product and its ${unusedCodes.toLocaleString()} WaveWallet ` +
    "voucher code(s) from WaveWallet only. Nothing is deleted or changed in Omada, and past " +
    "sales, Coins, Points and reports stay exactly as they are."
  );
}

export async function deleteVoucherProduct(input: {
  productId: string;
  confirmName: string;
}): Promise<DeleteProductResult> {
  const { data, error } = await supabase.rpc("delete_voucher_product", {
    _product_id: input.productId,
    _confirm_name: input.confirmName,
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as Partial<DeleteProductResult>;
  return {
    deleted: Boolean(raw.deleted),
    already_deleted: Boolean(raw.already_deleted),
    name: raw.name,
    codes_removed: Number(raw.codes_removed ?? 0),
    runs_cancelled: Number(raw.runs_cancelled ?? 0),
  };
}

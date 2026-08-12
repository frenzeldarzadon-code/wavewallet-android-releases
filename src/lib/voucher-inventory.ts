/**
 * Voucher inventory deletion rules.
 *
 * Deletion is only ever allowed for inventory that has never been financially
 * committed. A code that has been sold, assigned to a buyer, or referenced by
 * a sale is permanent: nothing here can remove it, and no sale, balance,
 * commission, point or ledger row is ever touched by these rules.
 */

export interface VoucherCodeLike {
  status: string;
  sold_to: string | null;
  sale_id?: string | null;
}

export interface VoucherBatch {
  batch_id: string;
  product_id: string;
  product_name: string;
  actor_name: string;
  source: string;
  created_at: string;
  total_codes: number;
  unused_count: number;
  sold_count: number;
  deletable: boolean;
}

/** A code may be deleted only while it is completely unused. */
export function canDeleteCode(code: VoucherCodeLike): boolean {
  return code.status === "unused" && !code.sold_to && !code.sale_id;
}

/**
 * Whole-batch deletion is all-or-nothing: a single committed code blocks it.
 * Returns null when the batch may be deleted, otherwise the reason to show.
 */
export function batchDeleteBlockReason(batch: VoucherBatch): string | null {
  if (batch.total_codes === 0) return "This batch has no codes left to delete.";
  if (batch.sold_count > 0) {
    return `${batch.sold_count} of ${batch.total_codes} codes in this batch have been sold or assigned. Sold inventory can never be deleted — delete the remaining unused codes individually instead.`;
  }
  return null;
}

/** Convenience for the UI: eligibility derived purely from the batch counts. */
export function isBatchDeletable(batch: VoucherBatch): boolean {
  return batchDeleteBlockReason(batch) === null;
}

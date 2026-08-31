/**
 * Automatic Voucher Shop stock replenishment rules (pure logic).
 *
 * The Voucher Shop sells a product's *unused* voucher codes. When that pool
 * falls below the low-stock threshold, and ONLY when the exact product has its
 * own saved Omada calibration, one batch of new codes is generated using that
 * product's calibration and imported into the same shop's voucher stock.
 *
 * Nothing here talks to Omada or the database: these are the decision rules,
 * so they can be proven in isolation and reused by the server job.
 */
import type { GenValue } from "./omada-generation";

/** Below this many available codes a product is replenished. */
export const LOW_STOCK_THRESHOLD = 100;

/** How many codes one automatic replenishment creates. */
export const REPLENISH_BATCH_SIZE = 500;

/** A run older than this is treated as abandoned and never blocks forever. */
export const RUN_STALE_MINUTES = 30;

export interface StockCodeLike {
  status: string;
  sold_to: string | null;
  sale_id?: string | null;
}

/**
 * Voucher Shop availability: a code counts only while it is completely
 * uncommitted. Sold, assigned or sale-linked codes are never available stock.
 */
export function availableStock(codes: StockCodeLike[]): number {
  return codes.filter((c) => c.status === "unused" && !c.sold_to && !c.sale_id).length;
}

export type ReplenishSkipReason =
  | "no_calibration"
  | "stocked"
  | "in_progress";

export interface ReplenishDecision {
  replenish: boolean;
  amount: number;
  reason: ReplenishSkipReason | "low_stock";
  message: string;
}

export function decideReplenishment(input: {
  available: number;
  hasCalibration: boolean;
  runInProgress: boolean;
}): ReplenishDecision {
  if (!input.hasCalibration) {
    return {
      replenish: false,
      amount: 0,
      reason: "no_calibration",
      message: "This product has no saved calibration, so nothing is generated for it.",
    };
  }
  if (input.available >= LOW_STOCK_THRESHOLD) {
    return {
      replenish: false,
      amount: 0,
      reason: "stocked",
      message: `Stock is ${input.available} codes — at or above ${LOW_STOCK_THRESHOLD}, so nothing is generated.`,
    };
  }
  if (input.runInProgress) {
    return {
      replenish: false,
      amount: 0,
      reason: "in_progress",
      message: "A replenishment for this product is already running.",
    };
  }
  return {
    replenish: true,
    amount: REPLENISH_BATCH_SIZE,
    reason: "low_stock",
    message: `Stock is ${input.available} codes — below ${LOW_STOCK_THRESHOLD}, so ${REPLENISH_BATCH_SIZE} codes are generated.`,
  };
}

/**
 * The request sent to Omada for an automatic top-up: the product's own saved
 * calibration, unchanged, apart from the batch size and the group name. No
 * voucher rule (duration, limits, code rules, price) is invented here.
 */
export function replenishmentPayload(
  calibrationPayload: Record<string, GenValue>,
  groupName: string,
  amount: number = REPLENISH_BATCH_SIZE,
): Record<string, GenValue> {
  return { ...calibrationPayload, name: groupName, amount };
}

/** A run is abandoned when it stayed "running" past the stale window. */
export function isStaleRun(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > RUN_STALE_MINUTES * 60_000;
}

/**
 * Voucher purchase quantity input.
 *
 * The quantity is a stepper AND a directly editable field, so a buyer can type
 * "50" instead of clicking + fifty times. Typing is deliberately forgiving
 * while the field is focused (an empty box is allowed mid-edit), but the value
 * that reaches the purchase is always a whole number between 1 and the
 * existing limit — no zero, no negatives, no decimals, no text.
 */

/** Digits only; anything else the buyer types is simply ignored. */
export function sanitizeQuantityInput(raw: string): string {
  return raw.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * The quantity a partially typed value represents, or null while the field is
 * still empty. Values above the limit are clamped to the limit.
 */
export function quantityFromInput(raw: string, max: number): number | null {
  const digits = sanitizeQuantityInput(raw);
  if (digits === "") return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(1, Math.floor(n)), Math.max(1, Math.floor(max)));
}

/** Final value when the buyer leaves the field: never empty, never invalid. */
export function commitQuantity(raw: string, max: number): number {
  return quantityFromInput(raw, max) ?? 1;
}

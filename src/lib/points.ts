/**
 * Points formatting.
 *
 * Points are fractional: a purchase earns `coins actually spent / credits_per_point`
 * with two decimals kept, so 7 coins at 10:1 earns 0.70 pt. Balances are stored as
 * numeric(14,2), so every display must keep those two decimals — never round or
 * truncate, or a member appears to lose the fraction they earned.
 */

/** Points earned by spending `coins` at a `credits_per_point` ratio. */
export function pointsForSpend(coins: number, creditsPerPoint: number): number {
  if (!Number.isFinite(coins) || !Number.isFinite(creditsPerPoint) || creditsPerPoint <= 0) return 0;
  if (coins <= 0) return 0;
  return Math.round((coins / creditsPerPoint) * 100) / 100;
}

/** "0.70", "2.00", "1,234.50" — always two decimals. */
export function formatPoints(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Same as `formatPoints` with the unit appended. */
export const pts = (value: number | string | null | undefined): string => `${formatPoints(value)} pts`;

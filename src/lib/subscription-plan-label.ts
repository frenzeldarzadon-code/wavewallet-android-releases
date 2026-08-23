/**
 * Plan + price wording for the platform owner's screens.
 *
 * A shop's selected plan is persisted with its payment/subscription request and
 * is what activation uses. These helpers make sure the owner always sees that
 * real plan and its configured price — never a made-up "₱0.00/mo" fallback for
 * a record whose price simply is not set. Zero is only shown as free when the
 * price genuinely is zero.
 */
import { peso } from "@/lib/wavewallet";

export type PlanPriceInput = number | string | null | undefined;

/** null when the price is genuinely unknown (legacy record), else the number. */
export function planPriceValue(price: PlanPriceInput): number | null {
  if (price === null || price === undefined || price === "") return null;
  const n = Number(price);
  return Number.isFinite(n) ? n : null;
}

export function planPriceLabel(price: PlanPriceInput): string {
  const n = planPriceValue(price);
  if (n === null) return "price not set";
  if (n <= 0) return "Free plan";
  return `${peso(n)}/mo`;
}

/** "Starter · ₱499.00/mo" — falls back only when there truly is no plan. */
export function planLabel(name: string | null | undefined, price: PlanPriceInput): string {
  const plan = name?.trim();
  if (!plan) return "No plan selected";
  return `${plan} · ${planPriceLabel(price)}`;
}

/**
 * The monthly rate to show for a payment request: what was persisted with the
 * request wins, and the plan price recorded on the same request is the only
 * fallback. Nothing is inferred from a default plan.
 */
export function requestMonthlyRate(r: {
  monthly_rate?: PlanPriceInput;
  plan_price?: PlanPriceInput;
}): number | null {
  return planPriceValue(r.monthly_rate) ?? planPriceValue(r.plan_price);
}

export function requestRateLabel(r: {
  monthly_rate?: PlanPriceInput;
  plan_price?: PlanPriceInput;
}): string {
  const rate = requestMonthlyRate(r);
  if (rate === null) return "";
  return rate <= 0 ? " @ free plan" : ` @ ${peso(rate)}/month`;
}

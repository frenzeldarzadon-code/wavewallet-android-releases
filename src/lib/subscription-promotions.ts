/**
 * SUBSCRIPTION DURATION & PROMOTION OPTIONS — platform owner only.
 *
 * A promotion never invents a new billing engine: it only says how many
 * months are CHARGED versus how many months of SERVICE the shop receives.
 * The service period is what `apply_subscription_plan` extends (fixed
 * 30-day months), and the charged months are what `superadmin_set_shop_plan`
 * turns into the recorded amount.
 */
import { planTotalPhp, monthsToDays, addMonths } from "@/lib/subscription-duration";

export interface PlanDurationOption {
  /** Stable value for the selector. */
  value: string;
  label: string;
  /** Months of service the shop receives. */
  serviceMonths: number;
  /** Months actually charged (fewer than service = promotion). */
  paidMonths: number;
}

export const PLAN_DURATION_OPTIONS: PlanDurationOption[] = [
  { value: "1", label: "1 Month", serviceMonths: 1, paidMonths: 1 },
  { value: "3", label: "3 Months", serviceMonths: 3, paidMonths: 3 },
  { value: "6", label: "6 Months", serviceMonths: 6, paidMonths: 6 },
  {
    value: "12-promo",
    label: "1 Year — 2 Months Free Promotion (pay 10, get 12)",
    serviceMonths: 12,
    paidMonths: 10,
  },
];

export const DEFAULT_PLAN_DURATION = PLAN_DURATION_OPTIONS[0]!;

export function planDurationOption(value: string): PlanDurationOption {
  return PLAN_DURATION_OPTIONS.find((o) => o.value === value) ?? DEFAULT_PLAN_DURATION;
}

export function isPromotion(o: PlanDurationOption): boolean {
  return o.paidMonths < o.serviceMonths;
}

export function freeMonths(o: PlanDurationOption): number {
  return Math.max(0, o.serviceMonths - o.paidMonths);
}

export interface DurationQuote {
  /** Monthly price × charged months, before any extra discount. */
  baseAmount: number;
  /** Monthly price × service months — what the same period normally costs. */
  listAmount: number;
  /** Value of the free months plus any extra discount. */
  savings: number;
  /** Final amount charged after the extra discount percentage. */
  total: number;
  serviceMonths: number;
  paidMonths: number;
  /** Fixed 30-day months, exactly as the database extends the period. */
  serviceDays: number;
}

/** Automatic price for a duration/promotion, plus an optional extra discount. */
export function durationQuote(input: {
  monthlyPrice: number | string | null | undefined;
  option: PlanDurationOption;
  discountPercent?: number;
}): DurationQuote {
  const { option } = input;
  const pct = Math.max(0, Math.min(100, Number(input.discountPercent) || 0));
  const baseAmount = planTotalPhp(input.monthlyPrice, option.paidMonths);
  const listAmount = planTotalPhp(input.monthlyPrice, option.serviceMonths);
  const total = Math.round(baseAmount * (100 - pct)) / 100;
  return {
    baseAmount,
    listAmount,
    savings: Math.round((listAmount - total) * 100) / 100,
    total,
    serviceMonths: option.serviceMonths,
    paidMonths: option.paidMonths,
    serviceDays: monthsToDays(option.serviceMonths),
  };
}

/**
 * When the shop's service period ends. The full service duration counts —
 * the free promotional months are service, not a discount on time.
 */
export function serviceEndsAt(
  currentPeriodEnd: string | Date | null | undefined,
  option: PlanDurationOption,
  now: Date = new Date(),
): Date {
  const cur = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  const start = cur && !Number.isNaN(cur.getTime()) && cur.getTime() > now.getTime() ? cur : now;
  return addMonths(start, option.serviceMonths);
}

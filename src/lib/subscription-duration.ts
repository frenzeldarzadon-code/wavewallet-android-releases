/**
 * SUBSCRIPTION DURATION, PRICE AND COUNTDOWN — pure presentation maths.
 *
 * Nothing here invents a price, a discount or a grace rule. It mirrors what the
 * database already does:
 *   • price  — `subscription_plans.monthly_price` × the months purchased
 *              (plans are all `billing_period = 'monthly'`; plan CHANGES keep
 *              using the server's `subscription_quote.amount_due` instead).
 *   • period — `apply_subscription_plan` extends from `period_end` when the
 *              current period is still in the future, otherwise from now.
 *   • freeze — `subscription_ok`: active until
 *              `current_period_end + grace_period_days`.
 */

/** Durations the existing RPCs accept (`months between 1 and 24`). */
export const MIN_MONTHS = 1;
export const MAX_MONTHS = 24;

export const DURATION_OPTIONS: number[] = Array.from(
  { length: MAX_MONTHS - MIN_MONTHS + 1 },
  (_, i) => i + MIN_MONTHS,
);

const DAY_MS = 86_400_000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Clamps any user-typed duration onto what the server accepts. */
export function normalizeMonths(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return MIN_MONTHS;
  return Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, n));
}

/** Straight multiplication — monthly price × months, no invented discounts. */
export function planTotalPhp(monthlyPrice: number | string | null | undefined, months: number): number {
  const price = Number(monthlyPrice ?? 0);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return round2(price * normalizeMonths(months));
}

export function monthsLabel(months: number): string {
  const m = normalizeMonths(months);
  return m === 1 ? "1 month" : `${m} months`;
}

/** Adds whole months the same way Postgres `+ interval 'n months'` does. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + normalizeMonths(months));
  // Postgres clamps 31 Jan + 1 month to 28/29 Feb; JS rolls over — clamp back.
  if (d.getDate() < day) d.setDate(0);
  return d;
}

/**
 * The period a payment buys. An early renewal never overwrites a still-active
 * period: it is appended to it, exactly like `apply_subscription_plan`.
 */
export function coveragePeriod(
  currentPeriodEnd: string | Date | null | undefined,
  months: number,
  now: Date = new Date(),
): { start: Date; end: Date; extendsExisting: boolean } {
  const cur = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  const extendsExisting = Boolean(cur && !Number.isNaN(cur.getTime()) && cur.getTime() > now.getTime());
  const start = extendsExisting ? (cur as Date) : now;
  return { start, end: addMonths(start, months), extendsExisting };
}

export type CountdownTone = "success" | "warning" | "danger" | "muted";

export interface SubscriptionCountdown {
  /** Short human sentence — never a fractional month. */
  label: string;
  tone: CountdownTone;
  /** Whole days left before the paid period ends (0 once it has ended). */
  daysRemaining: number;
  /** Whole days left before the account freezes (0 once it has frozen). */
  daysUntilFreeze: number;
  /** The configured moment operations stop: period end + grace days. */
  freezeAt: Date | null;
  expired: boolean;
  frozen: boolean;
  /** Longer sentence naming the actual configured deadline. */
  detail: string;
}

const wholeDays = (ms: number): number => Math.max(0, Math.floor(ms / DAY_MS));

function remainingLabel(days: number): string {
  if (days >= 60) return `${Math.floor(days / 30)} months remaining`;
  if (days >= 15) return `${days} days remaining`;
  if (days > 1) return `Expires in ${days} days`;
  if (days === 1) return "Expires in 1 day";
  return "Expires today";
}

/**
 * Countdown to the REAL configured freeze moment. `graceDays` is the shop's own
 * `grace_period_days`; no grace period is assumed or invented here.
 */
export function subscriptionCountdown(input: {
  periodEnd: string | Date | null | undefined;
  graceDays: number;
  /** `ecosystems.subscription_state`. */
  state?: string | null;
  now?: Date;
}): SubscriptionCountdown {
  const now = input.now ?? new Date();
  const end = input.periodEnd ? new Date(input.periodEnd) : null;
  const grace = Math.max(0, Math.floor(Number(input.graceDays) || 0));

  if (!end || Number.isNaN(end.getTime())) {
    return {
      label: "No renewal date set",
      tone: "muted",
      daysRemaining: 0,
      daysUntilFreeze: 0,
      freezeAt: null,
      expired: false,
      frozen: false,
      detail: "This shop has no subscription end date recorded yet.",
    };
  }

  const freezeAt = new Date(end.getTime() + grace * DAY_MS);
  const msLeft = end.getTime() - now.getTime();
  const msToFreeze = freezeAt.getTime() - now.getTime();
  const daysRemaining = wholeDays(msLeft);
  const daysUntilFreeze = wholeDays(msToFreeze);
  const graceText =
    grace > 0
      ? `After it ends you have a ${grace}-day grace period; the account is frozen on ${freezeAt.toLocaleDateString()} if no qualifying payment is recognised.`
      : `There is no grace period configured — the account is frozen on ${freezeAt.toLocaleDateString()} if no qualifying payment is recognised.`;

  if (msToFreeze <= 0) {
    return {
      label: "Frozen — payment required",
      tone: "danger",
      daysRemaining: 0,
      daysUntilFreeze: 0,
      freezeAt,
      expired: true,
      frozen: true,
      detail: `The subscription ended on ${end.toLocaleDateString()} and the grace period is over, so shop operations are frozen until a payment is recognised.`,
    };
  }

  if (msLeft <= 0) {
    return {
      label:
        daysUntilFreeze === 0
          ? "Expired — account freezes today"
          : daysUntilFreeze === 1
            ? "Expired — account freezes in 1 day"
            : `Expired — account freezes in ${daysUntilFreeze} days`,
      tone: "danger",
      daysRemaining: 0,
      daysUntilFreeze,
      freezeAt,
      expired: true,
      frozen: false,
      detail: `The subscription ended on ${end.toLocaleDateString()}. ${graceText}`,
    };
  }

  return {
    label: remainingLabel(daysRemaining),
    tone: daysRemaining <= 7 ? "warning" : "success",
    daysRemaining,
    daysUntilFreeze,
    freezeAt,
    expired: false,
    frozen: false,
    detail: `Paid until ${end.toLocaleDateString()}. ${graceText}`,
  };
}

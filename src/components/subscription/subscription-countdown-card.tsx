/**
 * SUBSCRIPTION COUNTDOWN — how long this shop stays live before it is frozen.
 *
 * Presentation only. It reads the shop's own `current_period_end` and
 * `grace_period_days` (the rule `subscription_ok` already enforces) and never
 * changes any subscription state.
 */
import { CalendarClock, Rocket } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui-kit";
import { subscriptionCountdown } from "@/lib/subscription-duration";

export function SubscriptionCountdownCard({
  planName,
  periodEnd,
  graceDays,
  state,
  monthlyPrice,
}: {
  planName?: string | null;
  periodEnd: string | null | undefined;
  graceDays: number;
  state?: string | null;
  /** `ecosystems.plan_price`. Zero = free shop: no countdown at all. */
  monthlyPrice?: number | string | null;
}) {
  const c = subscriptionCountdown({ periodEnd, graceDays, state, monthlyPrice });
  // A zero-priced shop has nothing to renew, so no timer is shown at all.
  if (c.free) return null;
  const border =
    c.tone === "danger"
      ? "border-destructive/50 bg-destructive/5"
      : c.tone === "warning"
        ? "border-warning/50 bg-warning/10"
        : "border-border";

  return (
    <Card className={`mb-4 shadow-[var(--shadow-card)] ${border}`}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="min-w-0">
          <StatusBadge tone={c.tone === "success" ? "success" : c.tone === "muted" ? "muted" : c.tone === "warning" ? "warning" : "danger"}>
            <CalendarClock className="mr-1 inline size-3.5" /> {c.label}
          </StatusBadge>
          <p className="mt-1.5 text-sm font-semibold">
            {planName ? `${planName} subscription` : "Subscription"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{c.detail}</p>
        </div>
        <Button asChild variant={c.tone === "success" ? "outline" : "default"}>
          <Link to="/admin/go-live">
            <Rocket className="mr-1 size-4" /> {c.expired ? "Pay now" : "Renew or change plan"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

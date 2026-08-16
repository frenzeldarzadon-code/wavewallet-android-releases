/**
 * Persistent banner for members running a 5-day review shop.
 *
 * Read-only: it only reports how much of the review window is left and links to
 * the simulation. It never unlocks or blocks anything — the database decides
 * what a review shop may do.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, FlaskConical } from "lucide-react";
import { fetchMyReviewShop, reviewCountdown, type ReviewShop } from "@/lib/review-demo";

export function ReviewBanner() {
  const [shop, setShop] = useState<ReviewShop | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchMyReviewShop()
      .then((s) => {
        if (alive) setShop(s);
      })
      .catch(() => {
        /* the banner is informational; a failed read simply hides it */
      });
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (!shop) return null;

  return (
    <div
      className={
        shop.ended
          ? "flex flex-wrap items-center justify-center gap-2 bg-destructive px-4 py-1.5 text-center text-[11px] font-semibold text-destructive-foreground sm:text-xs"
          : "flex flex-wrap items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-[11px] font-semibold text-warning-foreground sm:text-xs"
      }
    >
      <FlaskConical className="size-3.5 shrink-0" />
      <span>
        Review shop &ldquo;{shop.name}&rdquo; — simulated Demo Coins only, no real money.
      </span>
      <span className="flex items-center gap-1">
        <Clock className="size-3.5 shrink-0" />
        {reviewCountdown(shop.review_ends_at)}
      </span>
      <Link to="/review" className="underline underline-offset-2">
        Open simulation
      </Link>
    </div>
  );
}

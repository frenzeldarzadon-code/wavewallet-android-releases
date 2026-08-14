import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ratingLabel } from "@/lib/ratings";

/**
 * Read-only rating display. Renders nothing when an item has no ratings yet —
 * an empty row of stars would read as "rated zero" instead of "not rated".
 */
export function RatingStars({
  avg,
  count,
  className,
}: {
  avg: number | null | undefined;
  count: number | null | undefined;
  className?: string;
}) {
  const total = Number(count ?? 0);
  const label = ratingLabel(avg, total);
  if (!label) {
    return <p className={cn("text-xs text-muted-foreground", className)}>No ratings yet</p>;
  }
  const value = Number(label);
  return (
    <div className={cn("flex items-center gap-1", className)} aria-label={`${label} out of 5`}>
      <div className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(
              "size-3.5",
              i <= Math.round(value) ? "fill-warning text-warning" : "text-muted-foreground/40",
            )}
          />
        ))}
      </div>
      <span className="text-xs font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">
        ({total.toLocaleString()} {total === 1 ? "rating" : "ratings"})
      </span>
    </div>
  );
}

/** Interactive 1–5 picker used where a completed transaction can be rated. */
export function RatingPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          aria-label={`Rate ${i} star${i === 1 ? "" : "s"}`}
          onClick={() => onChange(i)}
          className="rounded p-1 transition hover:bg-muted disabled:opacity-50"
        >
          <Star
            className={cn(
              "size-6",
              i <= value ? "fill-warning text-warning" : "text-muted-foreground/40",
            )}
          />
        </button>
      ))}
    </div>
  );
}

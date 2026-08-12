import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function PageSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-6", className)}>
      {title ? (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: "neutral" | "positive" | "negative" | "brand";
}) {
  const toneClass =
    tone === "positive"
      ? "text-success"
      : tone === "negative"
        ? "text-destructive"
        : tone === "brand"
          ? "text-primary"
          : "text-foreground";
  return (
    <Card className="gap-0 py-4 shadow-[var(--shadow-card)]">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {Icon ? <Icon className={cn("size-4", toneClass)} /> : null}
        </div>
        <p className={cn("mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl", toneClass)}>
          {value}
        </p>
        {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

type Tone = "brand" | "success" | "danger" | "warning" | "muted" | "points";

const toneClasses: Record<Tone, string> = {
  brand: "bg-brand-soft text-accent-foreground border-transparent",
  success: "bg-success-soft text-success border-transparent",
  danger: "bg-danger-soft text-destructive border-transparent",
  warning: "bg-warning/15 text-warning-foreground border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
  points: "bg-points/12 text-points border-transparent",
};

export function StatusBadge({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("font-medium", toneClasses[tone], className)}>
      {children}
    </Badge>
  );
}

export function subscriptionTone(status: string): Tone {
  switch (status) {
    case "active":
      return "success";
    case "awaiting_approval":
    case "pending":
      return "warning";
    case "rejected":
    case "suspended":
    case "expired":
      return "danger";
    default:
      return "muted";
  }
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

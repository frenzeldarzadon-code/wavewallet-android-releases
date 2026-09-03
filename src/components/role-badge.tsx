import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Role badges shown across the authenticated management interface and on
 * public activity.
 *
 * The platform owner gets a deliberately distinct treatment — a filled,
 * shielded "Super Admin" badge — so it can never be confused with a shop
 * admin or reseller badge. The badge carries no personal information: it is
 * the platform identity, not the person behind it.
 */
export const PLATFORM_IDENTITY_NAME = "ONE WAVE Super Admin";

const LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Shop admin",
  reseller: "Reseller",
  subreseller: "Subreseller",
  customer: "Customer",
};

export function SuperAdminBadge({ className }: { className?: string | undefined }) {
  return (
    <Badge
      className={cn(
        "gap-1 border-0 bg-gradient-to-r from-primary to-success text-primary-foreground shadow-sm",
        className,
      )}
    >
      <ShieldCheck className="size-3" aria-hidden /> Super Admin
    </Badge>
  );
}

export function RoleBadge({
  role,
  className,
  showCustomer = false,
}: {
  role: string | null | undefined;
  className?: string;
  showCustomer?: boolean;
}) {
  if (role === "super_admin") return <SuperAdminBadge className={className} />;
  if (!role || (role === "customer" && !showCustomer)) return null;
  return (
    <Badge variant="secondary" className={className}>
      {LABELS[role] ?? role}
    </Badge>
  );
}

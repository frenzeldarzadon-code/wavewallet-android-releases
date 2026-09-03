/**
 * Guards a management page against the wrong shop type (e.g. voucher
 * inventory inside a Universe Retail shop). Renders the page while the type
 * is still loading so nothing flashes; otherwise shows a short, non-technical
 * notice with a link to the Shop type setting.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection } from "@/components/ui-kit";
import { useShopStatus } from "@/lib/shop-status";
import { showsRetailTools, showsVoucherTools, shopTypeLabel } from "@/lib/shop-type";
import { ShopTypeBadge } from "./shop-type-card";

export function ShopTypeGate({
  ecosystemId,
  requires,
  children,
}: {
  ecosystemId: string | null;
  requires: "voucher" | "retail";
  children: ReactNode;
}) {
  const status = useShopStatus(ecosystemId);
  if (status.loading || !status.shopType) return <>{children}</>;
  const ok = requires === "voucher" ? showsVoucherTools(status.shopType) : showsRetailTools(status.shopType);
  if (ok) return <>{children}</>;
  return (
    <PageSection title={requires === "voucher" ? "Voucher tools" : "Retail tools"}>
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">This shop is</span>
            <ShopTypeBadge type={status.shopType} />
          </div>
          <p className="text-sm text-muted-foreground">
            {requires === "voucher"
              ? `Voucher products and code inventory are not part of a ${shopTypeLabel(status.shopType)} shop.`
              : status.shopType === "new_generation"
                ? "New Generation shops stay isolated from Universe commerce, so Retail (products, cash-on-delivery, delivery) is not available here. Create a separate Universe Retail shop to sell goods."
                : `Retail products and orders are not part of a ${shopTypeLabel(status.shopType)} shop.`}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/settings">Open Shop type setting</Link>
          </Button>
        </CardContent>
      </Card>
    </PageSection>
  );
}

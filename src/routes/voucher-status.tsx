/**
 * Public voucher Status Checker.
 *
 * Anyone holding a voucher code may check it and label the devices using it —
 * no account, membership or role required. Shop operations, controller details
 * and credentials are never exposed here.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageSection } from "@/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { OmadaVoucherStatusPanel } from "@/components/omada/omada-voucher-status-panel";
import { listVoucherStatusShops } from "@/lib/omada-vouchers.functions";

export const Route = createFileRoute("/voucher-status")({
  head: () => ({
    meta: [
      { title: "Wi-Fi voucher status checker — WaveWallet" },
      {
        name: "description",
        content:
          "Check whether a Wi-Fi voucher is unused, in-use or expired, see the devices using it and label them.",
      },
      { property: "og:title", content: "Wi-Fi voucher status checker — WaveWallet" },
      {
        property: "og:description",
        content: "Check a Wi-Fi voucher code and label the devices using it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicStatusChecker,
});

type Shop = { name: string; slug: string };

function PublicStatusChecker() {
  const [shops, setShops] = useState<Shop[] | null>(null);
  const [slug, setSlug] = useState<string>("");

  useEffect(() => {
    void listVoucherStatusShops()
      .then((rows) => {
        setShops(rows);
        if (rows.length === 1 && rows[0]) setSlug(rows[0].slug);
      })
      .catch(() => setShops([]));
  }, []);

  return (
    <PageSection
      title="Voucher status checker"
      description="Enter a voucher code to see whether it is unused, in-use or expired."
    >
      {shops === null ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : shops.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No shop has connected a hotspot controller yet, so there is nothing to check here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {shops.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="voucherShop">Shop</Label>
              <select
                id="voucherShop"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              >
                <option value="">Choose a shop…</option>
                {shops.map((shop) => (
                  <option key={shop.slug} value={shop.slug}>
                    {shop.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {slug ? <OmadaVoucherStatusPanel shopSlug={slug} /> : null}
        </div>
      )}
    </PageSection>
  );
}

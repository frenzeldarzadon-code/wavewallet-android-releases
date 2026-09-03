import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchMyVoucherDiscount } from "@/lib/wallet";
import { useSession } from "@/lib/session";
import { VoucherShopView } from "./app.shop";

export const Route = createFileRoute("/admin/shop")({
  head: () => ({
    meta: [
      { title: "Shop Vouchers — ONE WAVE Admin" },
      {
        name: "description",
        content:
          "Use your shop wallet balance to take voucher codes from your own uploaded inventory batches — no new codes are ever generated.",
      },
      { property: "og:title", content: "Shop Vouchers — ONE WAVE Admin" },
      {
        property: "og:description",
        content: "Spend your admin shop wallet on codes from the uploaded voucher inventory.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminShop,
});

/**
 * The admin shops from exactly the same uploaded voucher inventory as every
 * downstream tier: codes come from imported batches and nothing here can mint
 * a voucher. The purchase is paid from the admin's own shop wallet.
 */
function AdminShop() {
  const { account, ecosystemDbId } = useSession("admin");
  // The admin voucher shop discount is configured by the platform owner
  // (default 100% off) and resolved server-side for the shop being viewed, so
  // the price shown here is exactly what checkout charges.
  const [discount, setDiscount] = useState(0);
  useEffect(() => {
    if (!account?.id) return;
    void fetchMyVoucherDiscount(account.id, ecosystemDbId).then(setDiscount);
  }, [account?.id, ecosystemDbId]);
  return <VoucherShopView role="admin" discountPercent={discount} />;
}

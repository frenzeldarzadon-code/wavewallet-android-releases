import { createFileRoute } from "@tanstack/react-router";
import { VoucherShopView } from "./app.shop";

export const Route = createFileRoute("/admin/shop")({
  head: () => ({
    meta: [
      { title: "Shop Vouchers — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Use your shop wallet balance to take voucher codes from your own uploaded inventory batches — no new codes are ever generated.",
      },
      { property: "og:title", content: "Shop Vouchers — WaveWallet Admin" },
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
  return <VoucherShopView role="admin" />;
}

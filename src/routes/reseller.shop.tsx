import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import { VoucherShopView } from "./app.shop";

export const Route = createFileRoute("/reseller/shop")({
  head: () => ({
    meta: [
      { title: "Buy Vouchers — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Buy voucher codes at your reseller discount. The exact sale price, cost and discount are captured at purchase time.",
      },
      { property: "og:title", content: "Buy Vouchers — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Reseller voucher purchases with your configured discount applied automatically.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerShop,
});

function ResellerShop() {
  const { account } = useSession("reseller");
  return <VoucherShopView role="reseller" discountPercent={account?.discountPercent ?? 0} />;
}

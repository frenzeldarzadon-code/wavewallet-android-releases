import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchMyVoucherDiscount } from "@/lib/wallet";
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
  // The wholesale discount is resolved server-side (personal rate, else the
  // shop default for the role) so the preview matches what checkout charges.
  const [discount, setDiscount] = useState(account?.discountPercent ?? 0);
  useEffect(() => {
    if (!account?.id) return;
    void fetchMyVoucherDiscount(account.id).then(setDiscount);
  }, [account?.id]);
  return (
    <VoucherShopView
      role={account?.role === "subreseller" ? "subreseller" : "reseller"}
      discountPercent={discount}
    />
  );
}


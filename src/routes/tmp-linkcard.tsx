import { createFileRoute } from "@tanstack/react-router";
import { PostLinkCard } from "@/components/social/post-link-card";
import type { LinkCard } from "@/lib/social";

export const Route = createFileRoute("/tmp-linkcard")({ component: Tmp });

const shop: LinkCard = {
  kind: "shop",
  shop_id: "13bc5a60-3964-4317-a29c-257473db05d1",
  shop_name: "Guesang GigaFlex",
  shop_slug: "guesanggigaflex",
  shop_type: "voucher",
  logo_path: null,
  cover_path: null,
  product_id: null,
  product_kind: null,
  product_name: null,
  image_path: null,
  price: null,
};
const product: LinkCard = {
  ...shop,
  kind: "product",
  product_id: "1278100c-6bfe-4cab-8842-92cce42f9992",
  product_kind: "voucher",
  product_name: "1GB for 3 Hours",
  price: 10,
  available: 498,
};

function Tmp() {
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <PostLinkCard card={product} />
      <PostLinkCard card={shop} />
      <PostLinkCard card={product} compact onChange={() => undefined} onRemove={() => undefined} />
    </div>
  );
}

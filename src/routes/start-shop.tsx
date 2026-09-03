import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Sparkles, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui-kit";
import { ShopTypeOptions } from "@/components/shop/shop-type-card";
import { supabase } from "@/integrations/supabase/client";
import { createReviewShop } from "@/lib/subscription-shops";
import {
  SHOP_TYPE_INFO,
  createUniverseShop,
  homeRouteFor,
  switchToShop,
  type ShopType,
} from "@/lib/shop-type";

const TITLE = "Create a WaveWallet shop";
const DESCRIPTION =
  "Create a WaveWallet shop for free — choose New Generation, Universe Voucher or Universe Retail. You can run more than one shop from the same login.";

export const Route = createFileRoute("/start-shop")({
  ssr: false,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StartShopPage,
});

function StartShopPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [type, setType] = useState<ShopType | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setSignedIn(Boolean(data.user));
      setChecking(false);
    });
  }, []);

  const create = async () => {
    if (!type) return;
    setBusy(true);
    try {
      if (type === "new_generation") {
        // Existing New Generation flow: 5-day review shop with simulated coins.
        const shop = await createReviewShop(name.trim(), description.trim() || undefined);
        await switchToShop(shop.id).catch(() => undefined);
        toast.success("Your New Generation shop is ready — 1,000 Demo Coins are waiting.");
      } else {
        const shop = await createUniverseShop({
          name: name.trim(),
          type,
          ...(description.trim() ? { description: description.trim() } : {}),
        });
        await switchToShop(shop.id);
        toast.success(`${SHOP_TYPE_INFO[type].label} shop created`, {
          description:
            type === "universe_retail"
              ? "Starter products were added as drafts — set prices and stock, then publish."
              : "Add your voucher products next.",
        });
      }
      window.dispatchEvent(new Event("wavewallet:session"));
      void navigate({ to: homeRouteFor(type) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the shop");
    } finally {
      setBusy(false);
    }
  };

  const placeholder =
    type === "universe_retail"
      ? "Sari-sari goods, snacks and drinks for the barangay"
      : "WiFi vouchers for our hotspot in the town centre";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link to="/guide" className="text-xs font-medium text-primary">
        ← Back to the guide
      </Link>
      <StatusBadge tone="brand" className="mt-4">
        Free to create · run as many shops as you need
      </StatusBadge>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Create your shop</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Pick what kind of shop this is first. You become its Shop Admin straight away, and one login
        can manage several shops — switch between them from Universe → Shops.
      </p>

      <Card className="mt-6 shadow-[var(--shadow-card)]">
        <CardContent className="space-y-4 px-4">
          {checking ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking your account…
            </p>
          ) : signedIn ? (
            <>
              <div className="space-y-2">
                <Label>Shop type</Label>
                <ShopTypeOptions value={type} onChange={setType} />
                {type === "new_generation" ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Starts in Demo mode with 1,000 simulated Demo Coins. Go Live from inside the
                    shop when you are ready. One unconverted review shop at a time.
                  </p>
                ) : type ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Live on the Universe immediately. Sales use members&apos; Universe wallets and the
                    platform fee is included in customer prices.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-name">Shop name</Label>
                <Input
                  id="shop-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your shop name"
                  maxLength={60}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-desc">What you sell (optional)</Label>
                <Textarea
                  id="shop-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={placeholder}
                  rows={3}
                  maxLength={280}
                />
              </div>
              <Button
                className="w-full"
                onClick={create}
                disabled={busy || !type || name.trim().length < 3}
              >
                {busy ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 size-4" />
                )}
                {type ? `Create ${SHOP_TYPE_INFO[type].label} shop` : "Choose a shop type"}
              </Button>
            </>
          ) : (
            <>
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Store className="mt-0.5 size-4 shrink-0 text-primary" />
                Creating a shop needs a WaveWallet account. Sign up or sign in first — it takes a
                minute, and the guide stays open to everyone.
              </p>
              <Button asChild className="w-full">
                <Link to="/">Sign in or create an account</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

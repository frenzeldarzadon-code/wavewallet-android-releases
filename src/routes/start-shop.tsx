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
import { supabase } from "@/integrations/supabase/client";
import { createReviewShop } from "@/lib/subscription-shops";

const TITLE = "Start a 5-day review shop — WaveWallet";
const DESCRIPTION =
  "Create one WaveWallet review shop and explore Coins, resellers, WiFi vouchers and rewards for 5 days with 1,000 simulated Demo Coins.";

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
    setBusy(true);
    try {
      await createReviewShop(name.trim(), description.trim() || undefined);
      toast.success("Your review shop is ready — 1,000 Demo Coins are waiting.");
      void navigate({ to: "/admin" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the review shop");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Link to="/guide" className="text-xs font-medium text-primary">
        ← Back to the guide
      </Link>
      <StatusBadge tone="brand" className="mt-4">
        5 days · simulated Demo Coins
      </StatusBadge>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Start your review shop</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        You get one review shop with 1,000 Demo Coins so you can try the full WaveWallet flow:
        loading Coins to resellers, selling WiFi vouchers, points and rewards. Demo Coins are
        simulated and never touch real balances. After 5 days the review shop freezes until you
        subscribe — your WaveWallet account stays yours.
      </p>

      <Card className="mt-6 shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3 px-4">
          {checking ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking your account…
            </p>
          ) : signedIn ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="shop-name">Shop name</Label>
                <Input
                  id="shop-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sagada Wave WiFi"
                  maxLength={60}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-desc">What you sell (optional)</Label>
                <Textarea
                  id="shop-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="WiFi vouchers for our hotspot in the town centre"
                  rows={3}
                  maxLength={280}
                />
              </div>
              <Button
                className="w-full"
                onClick={create}
                disabled={busy || name.trim().length < 3}
              >
                {busy ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 size-4" />
                )}
                Create review shop
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

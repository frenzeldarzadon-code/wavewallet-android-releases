/**
 * ADMIN → Go Live.
 *
 * The single, visible destination that takes a New Generation shop from Demo
 * mode to a live subscription. It reuses the existing Go Live payment card and
 * the existing subscription/payment process untouched; the page only makes the
 * state obvious and tells the operator what is still missing.
 *
 * Legacy shops never reach this page — they keep their own workflow.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, Rocket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { GoLiveCard } from "@/components/subscription/go-live-card";
import { useSession } from "@/lib/session";
import { useShopStatus } from "@/lib/shop-status";
import { reviewCountdown } from "@/lib/review-demo";

const TITLE = "Go Live — WaveWallet shop subscription";
const DESCRIPTION =
  "Turn your free Demo shop into a live WaveWallet shop: pick a plan, pay it with GCash and keep the same login, name and settings.";

export const Route = createFileRoute("/admin/go-live")({
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
  component: AdminGoLivePage,
});

function AdminGoLivePage() {
  const { ecosystemDbId } = useSession("admin");
  const [refresh, setRefresh] = useState(0);
  const status = useShopStatus(ecosystemDbId, refresh);

  if (status.loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading your shop status…
      </p>
    );
  }

  if (!status.isNewGeneration) {
    return (
      <PageSection devSlot="go-live.go-live" title="Go Live" description="This page is for New Generation shops.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="px-4 text-sm text-muted-foreground">
            This shop keeps its existing WaveWallet subscription arrangement, so there is nothing to
            do here.
          </CardContent>
        </Card>
      </PageSection>
    );
  }

  if (!status.isDemo) {
    return (
      <>
        <PageSection devSlot="go-live.your-shop-is-live"
          title="Your shop is live"
          description="Demo mode is finished — everything in this console now moves real Coins."
        >
          <Card className="border-success/40 shadow-[var(--shadow-card)]">
            <CardContent className="space-y-2 px-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <CheckCircle2 className="size-4" /> Live on the {status.planName ?? "current"} plan
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your Demo Coins were removed and your plan&apos;s real Coin allocation was issued
                once. You can change plan or renew below at any time.
              </p>
              <Button asChild size="sm">
                <Link to="/admin">Open my shop dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        </PageSection>
        {ecosystemDbId ? (
          <GoLiveCard
            ecosystemId={ecosystemDbId}
            shopName={status.name}
            isLive
            onLive={() => setRefresh((n) => n + 1)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageSection devSlot="go-live.demo-shop-not-live-yet"
        title="Demo shop — not live yet"
        description="Everything you have done so far used simulated Demo Coins. Subscribing keeps the same shop, login, name and settings."
      >
        <Card className="border-warning/50 shadow-[var(--shadow-card)]">
          <CardContent className="space-y-2 px-4">
            <StatusBadge tone="warning">
              <FlaskConical className="mr-1 inline size-3.5" /> Demo mode ·{" "}
              {reviewCountdown(status.reviewEndsAt)}
            </StatusBadge>
            <p className="text-xs leading-relaxed text-muted-foreground">
              What happens when your payment is verified: the Demo label and Demo Coins disappear,
              your plan&apos;s real Coin allocation is issued once to your admin wallet, customer
              sign-ups open, and you continue in this same Admin console.
            </p>
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Rocket className="size-3.5 text-primary" /> Choose your plan and confirm your GCash
              payment below.
            </p>
          </CardContent>
        </Card>
      </PageSection>

      {ecosystemDbId ? (
        <GoLiveCard
          ecosystemId={ecosystemDbId}
          shopName={status.name}
          isLive={false}
          onLive={() => {
            // A verified payment changes role, plan and wallet context — reload
            // straight into the live Admin console so no Demo state lingers.
            if (typeof window !== "undefined") window.location.assign("/admin");
          }}
        />
      ) : null}
    </>
  );
}

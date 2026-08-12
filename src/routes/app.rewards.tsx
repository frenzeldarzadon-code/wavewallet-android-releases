import { createFileRoute } from "@tanstack/react-router";
import { QrCode } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { redemptionsIn, rewardsIn, shortDateTime, type RewardProduct } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/app/rewards")({
  head: () => ({
    meta: [
      { title: "Rewards — WaveWallet" },
      { name: "description", content: "Redeem points for physical rewards and show your redemption code for release." },
      { property: "og:title", content: "Rewards — WaveWallet" },
      { property: "og:description", content: "Redeem points for physical rewards and show your redemption code for release." },
    ],
  }),
  component: CustomerRewards,
});

function CustomerRewards() {
  const { account, ecosystem } = useSession("customer");
  const [redeeming, setRedeeming] = useState<RewardProduct | null>(null);
  if (!account || !ecosystem) return null;

  const rewards = rewardsIn(ecosystem.id).filter((r) => r.active);
  const mine = redemptionsIn(ecosystem.id).filter((r) => r.accountId === account.id);
  const available = account.pointsBalance;

  return (
    <>
      <PageSection title="Rewards shop" description={`You have ${available} points available.`}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rewards.map((r) => {
            const soldOut = r.stock === 0;
            const affordable = available >= r.pointsPrice;
            return (
              <Card key={r.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                    <StatusBadge tone={soldOut ? "danger" : r.stock <= 5 ? "warning" : "success"}>
                      {soldOut ? "Out of stock" : `${r.stock} left`}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center justify-between">
                    <StatusBadge tone="points">{r.pointsPrice} pts</StatusBadge>
                    <Button size="sm" disabled={soldOut || !affordable} onClick={() => setRedeeming(r)}>
                      {soldOut ? "Unavailable" : affordable ? "Redeem" : "Not enough points"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </PageSection>

      <PageSection title="My redemptions" description="Pending redemptions hold your points until released.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {mine.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                You have no redemptions yet.
              </p>
            ) : (
              mine.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.rewardName}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {r.code} · {shortDateTime(r.createdAt)}
                    </p>
                  </div>
                  <StatusBadge tone={r.status === "pending" ? "warning" : r.status === "approved" ? "success" : "danger"}>
                    {r.status}
                  </StatusBadge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>

      <Dialog open={!!redeeming} onOpenChange={(o) => !o && setRedeeming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Redeem {redeeming?.name}</DialogTitle>
            <DialogDescription>
              {redeeming?.pointsPrice} points will be held now and deducted only when a reseller or the
              admin approves the release.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-6">
            <QrCode className="size-16 text-primary" />
            <p className="text-xs text-muted-foreground">A unique code and QR are generated on confirm.</p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setRedeeming(null);
                toast.success("Redemption created", {
                  description: "Show your code at any partner reseller to claim.",
                });
              }}
            >
              Confirm redemption
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

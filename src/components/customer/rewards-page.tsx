/**
 * Points + rewards shop, shared by the member and reseller consoles.
 *
 * Redemption behaviour is unchanged: `requestRedemption` holds points and only
 * an authorized approver releases them.
 */
import { Gift, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { RedemptionQr } from "@/components/redemption-qr";
import { RatingStars } from "@/components/rating-stars";
import { RewardImage } from "@/components/reward-image";
import { useSession } from "@/lib/session";
import { shortDateTime } from "@/lib/wavewallet";
import {
  fetchMyRedemptions,
  fetchPointsAccount,
  fetchRewards,
  redemptionTone,
  requestRedemption,
  reviewRedemption,
  statusLabel,
  type PointsAccount,
  type RedemptionRow,
  type RewardListing,
} from "@/lib/rewards";
import { toast } from "sonner";

export function RewardsPage() {
  const { account, ecosystem, ecosystemDbId } = useSession();
  const [points, setPoints] = useState<PointsAccount>({ balance: 0, held: 0, available: 0 });
  const [rewards, setRewards] = useState<RewardListing[]>([]);
  const [mine, setMine] = useState<RedemptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState<RewardListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [showing, setShowing] = useState<{
    code: string;
    name: string;
    points: number;
    imagePath: string | null;
  } | null>(null);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [p, r, m] = await Promise.all([
        fetchPointsAccount(userId, ecosystemDbId),
        fetchRewards(),
        fetchMyRedemptions(userId),
      ]);
      setPoints(p);
      setRewards(r);
      setMine(m);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystem) return null;

  const confirm = async () => {
    if (!redeeming) return;
    setBusy(true);
    try {
      const res = await requestRedemption(redeeming.id);
      setRedeeming(null);
      setShowing({
        code: res.code,
        name: res.reward_name,
        points: res.points_price,
        imagePath: redeeming.image_path,
      });
      toast.success("Redemption created", { description: "Show the QR code to claim your reward." });
      await load();
    } catch (e) {
      toast.error("Redemption failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (r: RedemptionRow) => {
    try {
      await reviewRedemption(r.id, "cancel");
      toast("Request cancelled — held points released");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageSection title="My points" description={`Earned from voucher purchases inside ${ecosystem.name}.`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Points available" value={String(points.available)} icon={Sparkles} tone="brand" />
          <StatCard label="On hold" value={String(points.held)} hint="Reserved by pending redemptions" />
          <StatCard label="Total balance" value={String(points.balance)} tone="positive" />
        </div>
      </PageSection>

      <PageSection title="Rewards shop" description="Physical rewards released by your shop or a partner reseller.">
        {loading ? (
          <EmptyState title="Loading rewards…" />
        ) : rewards.length === 0 ? (
          <EmptyState
            title="No rewards yet"
            description="Your shop admin has not published any physical rewards."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rewards.map((r) => {
              const soldOut = r.available === 0;
              const affordable = points.available >= r.points_price;
              return (
                <Card key={r.id} className="shadow-[var(--shadow-card)]">
                  <CardContent className="space-y-3">
                    <RewardImage path={r.image_path} alt={r.name} />
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.description}</p>
                        <RatingStars avg={r.rating_avg} count={r.rating_count} className="mt-1" />
                      </div>
                      <StatusBadge tone={soldOut ? "danger" : r.available <= 5 ? "warning" : "success"}>
                        {soldOut ? "Out of stock" : `${r.available} left`}
                      </StatusBadge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge tone="points">{r.points_price} pts</StatusBadge>
                      <Button size="sm" disabled={soldOut || !affordable} onClick={() => setRedeeming(r)}>
                        <Gift className="size-4" />
                        {soldOut ? "Unavailable" : affordable ? "Redeem" : "Not enough points"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageSection>

      <PageSection title="My redemptions" description="Pending requests hold your points until released.">
        {loading ? null : mine.length === 0 ? (
          <EmptyState title="No redemptions yet" description="Redeem a reward to see it here." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {mine.map((r) => (
              <Card key={r.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-3">
                  {r.reward_image_path ? (
                    <RewardImage path={r.reward_image_path} alt={r.reward_name} />
                  ) : null}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.reward_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {shortDateTime(r.created_at)} · {r.points_price} pts
                      </p>
                    </div>
                    <StatusBadge tone={redemptionTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                    <span className="font-mono text-xs">{r.code}</span>
                    {r.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setShowing({
                              code: r.code,
                              name: r.reward_name,
                              points: r.points_price,
                              imagePath: r.reward_image_path,
                            })
                          }
                        >
                          Show QR
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => void cancel(r)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {r.handled_by_name ? `by ${r.handled_by_name}` : "—"}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <Dialog open={!!redeeming} onOpenChange={(o) => !o && setRedeeming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Redeem {redeeming?.name}</DialogTitle>
            <DialogDescription>
              {redeeming?.points_price} points are held now and only deducted when your shop or a
              reseller approves the release.
            </DialogDescription>
          </DialogHeader>
          {redeeming?.image_path ? (
            <RewardImage path={redeeming.image_path} alt={redeeming.name} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedeeming(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirm()} disabled={busy}>
              {busy ? "Reserving…" : "Confirm redemption"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showing} onOpenChange={(o) => !o && setShowing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{showing?.name}</DialogTitle>
            <DialogDescription>
              Show this screen at the counter · {showing?.points} points held
            </DialogDescription>
          </DialogHeader>
          {showing?.imagePath ? (
            <RewardImage path={showing.imagePath} alt={showing.name} />
          ) : null}
          {showing ? <RedemptionQr code={showing.code} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

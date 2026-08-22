import { createFileRoute } from "@tanstack/react-router";
import { Check, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { shortDateTime } from "@/lib/wavewallet";
import {
  fetchEcosystemRedemptions,
  lookupRedemption,
  redemptionTone,
  reviewRedemption,
  statusLabel,
  type RedemptionLookup,
  type RedemptionRow,
} from "@/lib/rewards";
import { toast } from "sonner";

export const Route = createFileRoute("/reseller/redemptions")({
  head: () => ({
    meta: [
      { title: "Reward Redemptions — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Verify redemption codes from customers and approve or reject physical reward releases at your store.",
      },
      { property: "og:title", content: "Reward Redemptions — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Look up a redemption code, confirm the reward and release it in one tap.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerRedemptions,
});

function ResellerRedemptions() {
  const { account, ecosystemDbId } = useSession("reseller");
  const [code, setCode] = useState("");
  const [found, setFound] = useState<RedemptionLookup | null>(null);
  const [reds, setReds] = useState<RedemptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    try {
      setReds(await fetchEcosystemRedemptions(ecosystemDbId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystemDbId) return null;

  const verify = async () => {
    setBusy(true);
    try {
      const r = await lookupRedemption(code.trim());
      if (!r) {
        setFound(null);
        toast.error("Code not found in your shop");
        return;
      }
      setFound(r);
      if (r.status !== "pending")
        toast.error(`Already ${statusLabel(r.status)} — cannot be claimed twice`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await reviewRedemption(id, decision);
      toast.success(
        decision === "approve" ? "Released — points deducted and stock updated" : "Rejected — points released",
      );
      setFound(null);
      setCode("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pending = reds.filter((r) => r.status === "pending");

  return (
    <>
      <PageSection devSlot="redemptions.verify-redemption" title="Verify redemption" description="Key in or scan the customer's redemption code.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="RDM-0000AAAA"
                className="font-mono"
              />
              <Button onClick={() => void verify()} disabled={busy || code.trim().length < 4}>
                <Search className="size-4" /> Verify
              </Button>
            </div>
            {found ? (
              <div className="space-y-3 rounded-xl border border-border px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{found.reward_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {found.user_name} · {found.ecosystem_name} · {shortDateTime(found.created_at)}
                    </p>
                  </div>
                  <StatusBadge tone={redemptionTone(found.status)}>{statusLabel(found.status)}</StatusBadge>
                </div>
                <StatusBadge tone="points">{found.points_price} pts held</StatusBadge>
                {found.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy}
                      onClick={() => void decide(found.id, "approve")}
                    >
                      <Check className="size-4" /> Approve release
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-destructive"
                      disabled={busy}
                      onClick={() => void decide(found.id, "reject")}
                    >
                      <X className="size-4" /> Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection devSlot="redemptions.redemption-queue"
        title="Redemption queue"
        description={`Approving deducts the held points and decrements stock. ${pending.length} pending.`}
      >
        {loading ? (
          <EmptyState title="Loading redemptions…" />
        ) : reds.length === 0 ? (
          <EmptyState title="No redemptions yet" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {reds.map((r) => (
              <Card key={r.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.reward_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.user_name} · {shortDateTime(r.created_at)}
                      </p>
                    </div>
                    <StatusBadge tone={redemptionTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                    <span className="font-mono text-xs">{r.code}</span>
                    <StatusBadge tone="points">{r.points_price} pts</StatusBadge>
                  </div>
                  {r.status === "pending" ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busy}
                        onClick={() => void decide(r.id, "approve")}
                      >
                        <Check className="size-4" /> Approve release
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-destructive"
                        disabled={busy}
                        onClick={() => void decide(r.id, "reject")}
                      >
                        <X className="size-4" /> Reject
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Handled by {r.handled_by_name || "—"} ·{" "}
                      {r.handled_at ? shortDateTime(r.handled_at) : "—"}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>
    </>
  );
}

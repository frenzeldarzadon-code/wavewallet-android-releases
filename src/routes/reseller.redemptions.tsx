import { createFileRoute } from "@tanstack/react-router";
import { Check, QrCode, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { redemptionsIn, shortDateTime } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/reseller/redemptions")({
  head: () => ({
    meta: [
      { title: "Reward Redemptions — WaveWallet Reseller" },
      { name: "description", content: "Verify redemption codes and approve or reject physical reward releases at your store." },
      { property: "og:title", content: "Reward Redemptions — WaveWallet Reseller" },
      { property: "og:description", content: "Verify redemption codes and approve or reject physical reward releases at your store." },
    ],
  }),
  component: ResellerRedemptions,
});

function ResellerRedemptions() {
  const { account, ecosystem } = useSession("reseller");
  const [code, setCode] = useState("");
  if (!account || !ecosystem) return null;
  const reds = redemptionsIn(ecosystem.id);

  return (
    <>
      <PageSection title="Verify redemption" description="Scan the customer's QR or key in their redemption code.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="RDM-0000-XX"
              className="font-mono"
            />
            <Button variant="outline" onClick={() => toast("Camera scanning arrives with the mobile build")}>
              <QrCode className="size-4" /> Scan QR
            </Button>
            <Button
              onClick={() => {
                const found = reds.find((r) => r.code.toLowerCase() === code.trim().toLowerCase());
                if (!found) toast.error("Code not found in this ecosystem");
                else if (found.status !== "pending") toast.error(`Already ${found.status} — cannot be claimed twice`);
                else toast.success(`Valid: ${found.rewardName} for ${found.accountName}`);
              }}
            >
              Verify
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Redemption queue" description="Approving deducts the held points and decrements stock.">
        <div className="grid gap-3 md:grid-cols-2">
          {reds.map((r) => (
            <Card key={r.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{r.rewardName}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.accountName} · {shortDateTime(r.createdAt)}
                    </p>
                  </div>
                  <StatusBadge tone={r.status === "pending" ? "warning" : r.status === "approved" ? "success" : "danger"}>
                    {r.status}
                  </StatusBadge>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <span className="font-mono text-xs">{r.code}</span>
                  <StatusBadge tone="points">{r.pointsHeld} pts held</StatusBadge>
                </div>
                {r.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => toast.success(`Released by ${account.name}`)}>
                      <Check className="size-4" /> Approve release
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-destructive"
                      onClick={() => toast("Rejected — points released back")}
                    >
                      <X className="size-4" /> Reject
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Handled by {r.approvedBy} · {r.location ?? "—"}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </PageSection>
    </>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { Check, Gift, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { redemptionsIn, rewardsIn, shortDateTime } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/rewards")({
  head: () => ({
    meta: [
      { title: "Physical Rewards — WaveWallet Admin" },
      { name: "description", content: "Manage points-priced physical rewards and approve or reject pending redemptions by code." },
      { property: "og:title", content: "Physical Rewards — WaveWallet Admin" },
      { property: "og:description", content: "Manage points-priced physical rewards and approve or reject pending redemptions by code." },
    ],
  }),
  component: AdminRewards,
});

function AdminRewards() {
  const { ecosystem } = useSession("admin");
  const [open, setOpen] = useState(false);
  const [verify, setVerify] = useState("");
  if (!ecosystem) return null;

  const rewards = rewardsIn(ecosystem.id);
  const reds = redemptionsIn(ecosystem.id);

  return (
    <Tabs defaultValue="catalog">
      <TabsList className="mb-4">
        <TabsTrigger value="catalog">Catalog</TabsTrigger>
        <TabsTrigger value="redemptions">
          Redemptions
          {reds.filter((r) => r.status === "pending").length ? (
            <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
              {reds.filter((r) => r.status === "pending").length}
            </span>
          ) : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="catalog">
        <PageSection
          title="Physical rewards"
          description="Name, description, points price and stock only — no images."
          action={
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="size-4" /> New reward
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>New physical reward</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rname">Name</Label>
                    <Input id="rname" placeholder="e.g. Branded Cap" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rdesc">Description</Label>
                    <Textarea id="rdesc" rows={2} placeholder="Claim instructions" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="rpts">Points price</Label>
                      <Input id="rpts" type="number" placeholder="0" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rstock">Stock</Label>
                      <Input id="rstock" type="number" placeholder="0" />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      setOpen(false);
                      toast.success("Reward created (demo)");
                    }}
                  >
                    Create reward
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rewards.map((r) => (
              <Card key={r.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                    <Gift className="size-4 shrink-0 text-primary" />
                  </div>
                  <div className="flex items-center justify-between">
                    <StatusBadge tone="points">{r.pointsPrice} pts</StatusBadge>
                    <StatusBadge tone={r.stock === 0 ? "danger" : r.stock <= 5 ? "warning" : "success"}>
                      {r.stock === 0 ? "Out of stock" : `${r.stock} in stock`}
                    </StatusBadge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </PageSection>
      </TabsContent>

      <TabsContent value="redemptions">
        <PageSection title="Verify a redemption" description="Enter or scan the redemption code presented by the customer.">
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={verify}
                onChange={(e) => setVerify(e.target.value)}
                placeholder="RDM-0000-XX"
                className="font-mono"
              />
              <Button
                onClick={() => {
                  const found = reds.find((r) => r.code.toLowerCase() === verify.trim().toLowerCase());
                  if (!found) toast.error("Redemption code not found in this ecosystem");
                  else if (found.status !== "pending")
                    toast.error(`Already ${found.status} — cannot be claimed twice`);
                  else toast.success(`Valid: ${found.rewardName} for ${found.accountName}`);
                }}
              >
                Verify
              </Button>
            </CardContent>
          </Card>
        </PageSection>

        <PageSection title="Redemption queue" description="Points stay on hold until approval; rejection releases them.">
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
                    <StatusBadge
                      tone={r.status === "pending" ? "warning" : r.status === "approved" ? "success" : "danger"}
                    >
                      {r.status}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                    <span className="font-mono text-xs">{r.code}</span>
                    <StatusBadge tone="points">{r.pointsHeld} pts</StatusBadge>
                  </div>
                  {r.status === "pending" ? (
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => toast.success("Approved — points deducted, stock decremented")}>
                        <Check className="size-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-destructive"
                        onClick={() => toast("Rejected — held points released")}
                      >
                        <X className="size-4" /> Reject
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {r.status === "approved" ? "Released" : "Rejected"} by {r.approvedBy} ·{" "}
                      {r.location ?? "—"}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </PageSection>
      </TabsContent>
    </Tabs>
  );
}

/**
 * Shop admin — permanently delete this shop.
 *
 * The rule shown here is enforced by the database: no member may still hold
 * Coins. The admin sees exactly who still holds Coins and what must happen
 * before the action unlocks.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageSection } from "@/components/ui-kit";
import {
  canSubmitShopDeletion,
  deletionBlockedReason,
  deleteOwnShop,
  fetchShopDeletionCheck,
  type ShopDeletionCheck,
} from "@/lib/shop-deletion";

export function DeleteShopCard({
  ecosystemId,
  shopName,
}: {
  ecosystemId: string;
  shopName: string;
}) {
  const [check, setCheck] = useState<ShopDeletionCheck | null>(null);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCheck(await fetchShopDeletionCheck(ecosystemId));
    } catch (e) {
      toast.error("Could not check member Coin balances", {
        description: (e as Error).message,
      });
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const blocked = deletionBlockedReason(check);
  const ready = canSubmitShopDeletion({ check, shopName, typed, reason, busy });

  const remove = async () => {
    setBusy(true);
    try {
      await deleteOwnShop({ ecosystemId, confirmName: typed, reason });
      toast.success(`${shopName} has been permanently deleted.`);
      window.location.assign("/");
    } catch (e) {
      toast.error("Could not delete this shop", { description: (e as Error).message });
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      devSlot="settings.delete-shop"
      title="Delete this shop"
      description="Permanently deletes your shop and everything in it. Only possible when no member still holds Coins."
    >
      <Card className="border-destructive/40 shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4" /> Permanent shop deletion
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A shop can only be deleted once every member's Coin balance is zero — either members
            spend their Coins or they return them to you. Coins held by you, the shop admin, never
            block deletion. This cannot be undone; a deletion record is kept for the platform owner.
          </p>

          {blocked ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs font-medium text-destructive">{blocked}</p>
              {check && check.holders.length > 0 ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {check.holders.slice(0, 20).map((h) => (
                    <li key={h.user_id} className="flex justify-between gap-3">
                      <span>
                        {h.name}
                        {h.handle ? ` (@${h.handle})` : ""}
                      </span>
                      <span className="font-medium text-foreground">
                        {h.balance.toLocaleString()} Coins
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Re-check balances
              </Button>
            </div>
          ) : (
            <p className="text-xs text-success">
              All member Coin balances are zero — this shop can be deleted.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="delshopname">Type the shop name to confirm</Label>
              <Input
                id="delshopname"
                value={typed}
                placeholder={shopName}
                onChange={(e) => setTyped(e.target.value)}
                disabled={Boolean(blocked)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delreason">Reason</Label>
              <Textarea
                id="delreason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={Boolean(blocked)}
              />
            </div>
          </div>

          <Button variant="destructive" disabled={!ready} onClick={() => void remove()}>
            <Trash2 className="mr-1 size-4" />
            {busy ? "Deleting…" : "Delete shop permanently"}
          </Button>
        </CardContent>
      </Card>
    </PageSection>
  );
}

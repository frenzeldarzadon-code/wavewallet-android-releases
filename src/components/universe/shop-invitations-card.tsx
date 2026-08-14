/**
 * Invitations waiting for the signed-in member.
 *
 * Accepting creates a membership in that ONE shop with the shop's normal
 * customer role; declining creates nothing. Nothing is ever auto-accepted.
 */
import { Check, Loader2, Mailbox, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui-kit";
import {
  daysLeft,
  fetchMyInvitations,
  respondToInvitation,
  type MyInvitation,
} from "@/lib/shop-invitations";

export function ShopInvitationsCard({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<MyInvitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await fetchMyInvitations());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows.length === 0) return null;

  const respond = async (inv: MyInvitation, accept: boolean) => {
    setBusy(inv.id);
    try {
      await respondToInvitation(inv.id, accept);
      toast.success(
        accept
          ? `You are now a member of ${inv.ecosystem_name}.`
          : `Invitation from ${inv.ecosystem_name} declined.`,
      );
      await load();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-4 border-primary/30 shadow-[var(--shadow-card)]">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <Mailbox className="size-4 text-primary" />
          <p className="text-sm font-semibold">Shop invitations</p>
          <StatusBadge tone="warning">{rows.length} pending</StatusBadge>
        </div>
        {rows.map((inv) => {
          const left = daysLeft(inv.expires_at);
          return (
            <div key={inv.id} className="rounded-xl border border-border px-3 py-3">
              <p className="text-sm font-semibold">{inv.ecosystem_name}</p>
              <p className="text-xs text-muted-foreground">
                Invited by {inv.inviter_name}
                {inv.inviter_role ? ` (${inv.inviter_role})` : ""}
                {left !== null ? ` · expires in ${left} day(s)` : ""}
              </p>
              {inv.message ? <p className="mt-1.5 text-sm">{inv.message}</p> : null}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Accepting adds a membership in this shop only. Your other shops, wallets and
                history are untouched.
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={busy === inv.id}
                  onClick={() => void respond(inv, true)}
                >
                  {busy === inv.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={busy === inv.id}
                  onClick={() => void respond(inv, false)}
                >
                  <X className="size-4" /> Decline
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

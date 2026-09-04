/**
 * "Invites" — the member's own inbox inside a Shop Dashboard.
 *
 * Universe is the customer portal, so there is no join list here any more:
 * the only thing a shop can ask of a member is an invitation into its team,
 * shown with Accept and Decline.
 *
 * Accepting joins that ONE shop with the role the shop assigns; nothing moves
 * between shops — wallets, points, cashback and history stay shop-scoped. The
 * database re-checks every action, so this screen can only ever ask.
 */
import { Check, Loader2, Mailbox, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import {
  actionableInvitations,
  dedupeByShop,
  emptyInbox,
  fetchMemberInbox,
  inboxPendingCount,
  redundantInvitations,
  type MemberInbox,
} from "@/lib/member-inbox";
import { MemberInviteCard } from "@/components/universe/member-invite-card";
import { useSession } from "@/lib/session";
import { daysLeft, respondToInvitation, type MyInvitation } from "@/lib/shop-invitations";
import { roleLabel, shortDateTime } from "@/lib/wavewallet";

/** Loads the inbox and exposes the pending badge count. */
export function useMemberInbox() {
  const [inbox, setInbox] = useState<MemberInbox>(emptyInbox);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setInbox(await fetchMemberInbox());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { inbox, loading, reload, pending: inboxPendingCount(inbox) };
}

export function MemberInboxPanel() {
  const session = useSession();
  const { inbox, loading, reload, pending } = useMemberInbox();
  const [busy, setBusy] = useState<string | null>(null);

  const invites = dedupeByShop(actionableInvitations(inbox.invitations, inbox.memberships));
  const alreadyJoined = redundantInvitations(inbox.invitations, inbox.memberships);

  const respond = async (invitation: MyInvitation, accept: boolean) => {
    setBusy(invitation.id);
    try {
      await respondToInvitation(invitation.id, accept);
      toast.success(
        accept
          ? `You joined ${invitation.ecosystem_name}. Your other shops are untouched.`
          : `Invitation from ${invitation.ecosystem_name} declined.`,
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not answer this invitation.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Invites</h1>
          <p className="text-xs text-muted-foreground">
            Shops that invited you to their team, and people you invite.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 ? <StatusBadge tone="warning">{pending} to answer</StatusBadge> : null}
          <Button size="sm" variant="outline" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Every approved member of a shop may invite someone from the Universe. */}
      <MemberInviteCard
        memberships={inbox.memberships}
        myId={session.account?.id ?? null}
        onSent={() => void reload()}
      />

      {/* ---------------- Invites ---------------- */}
      <PageSection
        devSlot="member-inbox-panel.invites"
        title="Invites"
        description="Invitations from shop admins, resellers or the platform owner."
      >
        {invites.length === 0 && alreadyJoined.length === 0 ? (
          <EmptyState
            title="No invitations right now"
            description="When a shop invites you, it appears here and you get a notification."
          />
        ) : null}

        <div className="space-y-3">
          {invites.map((inv) => {
            const left = daysLeft(inv.expires_at);
            return (
              <Card key={inv.id} className="border-primary/30 shadow-[var(--shadow-card)]">
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <Mailbox className="size-4 shrink-0 text-primary" />
                        <span className="truncate">{inv.ecosystem_name}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Invited by {inv.inviter_name}
                        {inv.inviter_role ? ` · ${roleLabel(inv.inviter_role)}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {shortDateTime(inv.created_at)}
                        {left !== null ? ` · expires in ${left} day(s)` : ""}
                      </p>
                    </div>
                    <StatusBadge tone="warning">Pending</StatusBadge>
                  </div>

                  {inv.message ? (
                    <p className="rounded-lg bg-muted px-3 py-2 text-sm">{inv.message}</p>
                  ) : null}

                  <p className="text-[11px] text-muted-foreground">
                    Joining adds a membership in this shop only. No coins, points, cashback or
                    history move between shops.
                  </p>

                  <div className="flex flex-col gap-2 pt-1 sm:flex-row">
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
                      Join shop
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
                </CardContent>
              </Card>
            );
          })}

          {alreadyJoined.map((inv) => (
            <Card key={inv.id}>
              <CardContent className="flex items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{inv.ecosystem_name}</p>
                  <p className="text-xs text-muted-foreground">
                    You are already a member of this shop.
                  </p>
                </div>
                <StatusBadge tone="success">Member</StatusBadge>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageSection>
    </div>
  );
}

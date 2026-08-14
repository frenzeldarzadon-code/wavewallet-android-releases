/**
 * Invite an existing Universe member into ONE shop.
 *
 * Search the global directory → pick a member → confirm. Sending an invitation
 * creates no membership, wallet or role: the invited person must accept first.
 * The database re-checks that the operator may manage this shop, so this card
 * is only a launcher with friendlier messages.
 */
import { Loader2, Search, Send, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { useSession } from "@/lib/session";
import { shortDateTime } from "@/lib/wavewallet";
import {
  MIN_INVITE_QUERY,
  candidateIdentityLine,
  cancelInvitation,
  daysLeft,
  fetchShopInvitations,
  invitationTone,
  inviteBlockedReason,
  inviteUniverseMember,
  searchUniverseMembers,
  type InvitationStatus,
  type ShopInvitation,
  type UniverseCandidate,
} from "@/lib/shop-invitations";

export function InviteMemberCard({ ecosystemId }: { ecosystemId: string | null }) {
  const session = useSession();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UniverseCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UniverseCandidate | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ShopInvitation[]>([]);
  const [status, setStatus] = useState<InvitationStatus | "all">("pending");
  const [loading, setLoading] = useState(true);
  const myId = session.account?.id ?? null;

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      setRows(await fetchShopInvitations(ecosystemId, status));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!ecosystemId) return;
    const term = query.trim();
    if (term.length < MIN_INVITE_QUERY) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchUniverseMembers(ecosystemId, term)
        .then((r) => !cancelled && setResults(r))
        .catch((e: Error) => !cancelled && toast.error(e.message))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, ecosystemId]);

  if (!ecosystemId) return null;

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await inviteUniverseMember(ecosystemId, selected.user_id, note);
      toast.success(`Invitation sent to ${selected.full_name}. They must accept it to join.`);
      setSelected(null);
      setNote("");
      setQuery("");
      setResults(null);
      setStatus("pending");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (inv: ShopInvitation) => {
    setBusy(true);
    try {
      await cancelInvitation(inv.id);
      toast.success("Invitation cancelled.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Invite a member from Universe"
        description="Search the global directory by @handle, name, email or phone. The invitation only creates a membership once the person accepts it."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 pl-9"
                placeholder="@handle, name, email or phone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search Universe members"
              />
            </div>

            {searching ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Searching Universe…
              </p>
            ) : null}

            {results && results.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No Universe member matches that search.
              </p>
            ) : null}

            {results?.map((c) => {
              const blocked = inviteBlockedReason(c, myId);
              return (
                <div
                  key={c.user_id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5"
                >
                  <MemberAvatar name={c.full_name} path={c.avatar_path} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {candidateIdentityLine(c) || "Universe member"}
                    </p>
                  </div>
                  {blocked ? (
                    <StatusBadge tone="muted">{blocked}</StatusBadge>
                  ) : (
                    <Button
                      size="sm"
                      className="h-9"
                      onClick={() => {
                        setSelected(c);
                        setNote("");
                      }}
                    >
                      <UserPlus className="size-4" /> Invite
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Invitations"
        description="Who was invited, by whom, and whether they accepted."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as InvitationStatus | "all")}
            >
              <SelectTrigger className="h-11" aria-label="Filter invitations">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>

            {loading ? (
              <p className="text-xs text-muted-foreground">Loading invitations…</p>
            ) : rows.length === 0 ? (
              <EmptyState title="No invitations here yet" />
            ) : (
              <div className="space-y-2">
                {rows.map((inv) => {
                  const left = daysLeft(inv.expires_at);
                  return (
                    <div
                      key={inv.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5"
                    >
                      <MemberAvatar
                        name={inv.full_name}
                        path={inv.avatar_path}
                        className="size-9"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {inv.full_name}
                          {inv.handle ? (
                            <span className="ml-1 font-normal text-muted-foreground">
                              @{inv.handle}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Invited by {inv.inviter_name}
                          {inv.inviter_role ? ` (${inv.inviter_role})` : ""} ·{" "}
                          {shortDateTime(inv.created_at)}
                          {inv.status === "pending" && left !== null
                            ? ` · expires in ${left} day(s)`
                            : ""}
                        </p>
                      </div>
                      <StatusBadge tone={invitationTone(inv.status)}>{inv.status}</StatusBadge>
                      {inv.status === "pending" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          disabled={busy}
                          onClick={() => void cancel(inv)}
                        >
                          <X className="size-4" /> Cancel
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite {selected?.full_name} to this shop</DialogTitle>
            <DialogDescription>
              They join only after accepting. Nothing changes in any other shop, and no wallet,
              points or history moves because of an invitation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="invite-note">Message (optional)</Label>
            <Textarea
              id="invite-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tell them why you are inviting them."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void confirm()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Confirm invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

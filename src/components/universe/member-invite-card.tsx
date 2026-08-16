/**
 * "Invite a member" for EVERY approved member of a shop — customers included.
 *
 * Search the global Universe directory, pick a person, send a shop-specific
 * invitation. Sending creates no membership, role, wallet or credit movement:
 * the recipient must accept it in their own Applications & Invites inbox.
 * The database re-checks that the caller is an active member of the chosen
 * shop, so this card can only ever ask.
 */
import { Loader2, Search, Send, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import type { Membership } from "@/lib/memberships";
import {
  MIN_INVITE_QUERY,
  candidateIdentityLine,
  cancelInvitation,
  daysLeft,
  fetchMySentInvitations,
  invitationTone,
  inviteBlockedReason,
  inviteUniverseMember,
  searchUniverseMembers,
  type ShopInvitation,
  type UniverseCandidate,
} from "@/lib/shop-invitations";
import { shortDateTime } from "@/lib/wavewallet";

export function MemberInviteCard({
  memberships,
  myId,
  onSent,
}: {
  memberships: Membership[];
  myId?: string | null;
  onSent?: () => void;
}) {
  const shops = useMemo(
    () => memberships.filter((m) => m.membershipState === "active" && m.status === "active"),
    [memberships],
  );
  const [shopId, setShopId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UniverseCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UniverseCandidate | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<ShopInvitation[]>([]);

  // Default to the currently active shop; a member may pick any shop they
  // actually belong to — never one they don't.
  useEffect(() => {
    if (shops.length === 0) {
      setShopId(null);
      return;
    }
    setShopId((cur) =>
      cur && shops.some((s) => s.ecosystemId === cur)
        ? cur
        : (shops.find((s) => s.isActive) ?? shops[0]!).ecosystemId,
    );
  }, [shops]);

  const loadSent = useCallback(async () => {
    if (!shopId) return;
    try {
      setSent(await fetchMySentInvitations(shopId));
    } catch {
      setSent([]);
    }
  }, [shopId]);

  useEffect(() => {
    void loadSent();
  }, [loadSent]);

  useEffect(() => {
    setResults(null);
    setQuery("");
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    const term = query.trim();
    if (term.length < MIN_INVITE_QUERY) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchUniverseMembers(shopId, term)
        .then((r) => !cancelled && setResults(r))
        .catch((e: Error) => !cancelled && toast.error(e.message))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, shopId]);

  if (shops.length === 0 || !shopId) return null;
  const shopName = shops.find((s) => s.ecosystemId === shopId)?.ecosystemName ?? "this shop";

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await inviteUniverseMember(shopId, selected.user_id, note);
      toast.success(
        `Invitation sent to ${selected.full_name}. They must accept it to join ${shopName}.`,
      );
      setSelected(null);
      setNote("");
      setQuery("");
      setResults(null);
      await loadSent();
      onSent?.();
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
      await loadSent();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Invite a member"
        description="Search the Universe by @handle, name, email or phone and invite someone to join your shop. They only become a member if they accept."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3 py-4">
            {shops.length > 1 ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Invite into</Label>
                <Select value={shopId} onValueChange={setShopId}>
                  <SelectTrigger className="h-11" aria-label="Choose the shop to invite into">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {shops.map((s) => (
                      <SelectItem key={s.ecosystemId} value={s.ecosystemId}>
                        {s.ecosystemName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Inviting into <span className="font-semibold text-foreground">{shopName}</span>.
              </p>
            )}

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
              const blocked = inviteBlockedReason(c, myId ?? null);
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

            <p className="text-[11px] text-muted-foreground">
              You cannot approve anyone yourself. The person you invite decides, and nothing moves
              between shops — no coins, points, cashback or history.
            </p>
          </CardContent>
        </Card>
      </PageSection>

      {sent.length > 0 ? (
        <PageSection title="Invitations you sent" description={`For ${shopName}.`}>
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-2 py-4">
              {sent.map((inv) => {
                const left = daysLeft(inv.expires_at);
                return (
                  <div
                    key={inv.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5"
                  >
                    <MemberAvatar name={inv.full_name} path={inv.avatar_path} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{inv.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
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
            </CardContent>
          </Card>
        </PageSection>
      ) : null}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite {selected?.full_name}</DialogTitle>
            <DialogDescription>
              They receive a notification and can accept or decline. Nothing is created in{" "}
              {shopName} until they accept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="invite-note" className="text-xs">
              Message (optional)
            </Label>
            <Textarea
              id="invite-note"
              rows={3}
              maxLength={280}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Say why you are inviting them."
            />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="sm:flex-1" onClick={() => setSelected(null)}>
              Cancel
            </Button>
            <Button className="sm:flex-1" disabled={busy} onClick={() => void confirm()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

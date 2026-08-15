/**
 * Assign or replace the admin of one shop (platform owner only).
 *
 * The platform owner searches the global Universe directory and appoints an
 * existing account as this shop's admin. The assignment is the approval: the
 * person is active as admin immediately, with no application and no invitation
 * to accept, and can manage the shop right away.
 *
 * Assigning moves the admin role, not the money: the outgoing admin keeps their
 * membership, wallet and history and simply steps down, the new admin's roles
 * in other shops are untouched, and every wallet stays with its own shop. The
 * database records who was replaced, who took over, which operator did it and
 * when, and notifies both people.
 */
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemberAvatar } from "@/components/member-avatar";
import { StatusBadge } from "@/components/ui-kit";
import { shortDateTime } from "@/lib/wavewallet";
import { adminNotice, assignShopAdmin, fetchShopAdmin, type ShopAdminInfo } from "@/lib/shop-admin";
import {
  candidateIdentityLine,
  searchUniverseMembers,
  MIN_INVITE_QUERY,
  type UniverseCandidate,
} from "@/lib/shop-invitations";

export function ShopAdminCard({
  ecosystemId,
  onChanged,
}: {
  ecosystemId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const [admin, setAdmin] = useState<ShopAdminInfo | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<UniverseCandidate[] | null>(null);
  const [picked, setPicked] = useState<UniverseCandidate | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAdmin(await fetchShopAdmin(ecosystemId));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = async () => {
    setBusy(true);
    try {
      const res = await searchUniverseMembers(ecosystemId, query);
      setMatches(res);
      setPicked(res[0] ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const assign = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await assignShopAdmin(ecosystemId, picked.user_id);
      toast.success(`${picked.full_name} is now the Shop Admin`, {
        description: admin?.userId
          ? "They can manage the shop right away. The previous admin keeps their membership, wallet and history."
          : "No approval needed — they can open the shop console now.",
      });
      setQuery("");
      setMatches(null);
      setPicked(null);
      await load();
      await onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const notice = admin ? adminNotice(admin) : null;
  const assigned = Boolean(admin?.userId);

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Shop Admin</p>
        <StatusBadge tone={assigned ? "success" : "warning"}>
          {assigned ? "active" : "unassigned"}
        </StatusBadge>
      </div>

      {assigned && admin ? (
        <div className="flex items-center gap-2 rounded-xl bg-brand-soft p-2">
          <MemberAvatar path={admin.avatarPath} name={admin.name ?? "Shop Admin"} className="size-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              Shop Admin: {admin.name ?? "Unnamed"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {admin.handle ? `@${admin.handle} · ` : ""}
              {admin.email ?? "no email"}
              {admin.assignedAt ? ` · assigned ${shortDateTime(admin.assignedAt)}` : ""}
            </p>
          </div>
        </div>
      ) : null}
      {notice ? <p className="text-xs text-warning-foreground">{notice}</p> : null}

      <div className="space-y-1.5">
        <Label htmlFor="sa-q">
          {assigned ? "Replace the Shop Admin with" : "Assign Shop Admin"}
        </Label>
        <p className="text-[11px] text-muted-foreground">
          Search an existing Universe account by name, @handle, email or mobile. They keep their
          Universe profile and their roles and wallets in other shops.
        </p>
        <div className="flex gap-2">
          <Input
            id="sa-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, @handle, email or mobile"
            onKeyDown={(e) => e.key === "Enter" && void search()}
          />
          <Button
            variant="outline"
            onClick={() => void search()}
            disabled={busy || query.trim().length < MIN_INVITE_QUERY}
          >
            <Search className="size-4" /> Find
          </Button>
        </div>
        {matches?.length === 0 ? (
          <p className="text-xs text-destructive">No Universe member matches that.</p>
        ) : null}
      </div>

      {matches && matches.length > 0
        ? matches.map((m) => (
            <button
              key={m.user_id}
              type="button"
              onClick={() => setPicked(m)}
              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left ${
                picked?.user_id === m.user_id ? "border-primary bg-brand-soft" : "border-border"
              }`}
            >
              <MemberAvatar path={m.avatar_path} name={m.full_name} className="size-9" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {m.full_name}
                  {m.handle ? (
                    <span className="font-normal text-muted-foreground"> @{m.handle}</span>
                  ) : null}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {candidateIdentityLine(m)}
                  {m.already_member ? " · already a member of this shop" : ""}
                </span>
              </span>
            </button>
          ))
        : null}

      {picked ? (
        <div className="space-y-2 rounded-xl border border-primary/40 bg-brand-soft p-3">
          <div className="flex items-center gap-2">
            <MemberAvatar path={picked.avatar_path} name={picked.full_name} className="size-10" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{picked.full_name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {picked.handle ? `@${picked.handle}` : candidateIdentityLine(picked)}
              </p>
            </div>
            <StatusBadge tone="info" className="ml-auto">
              Shop Admin
            </StatusBadge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Assigning approves them immediately as this shop's admin — no invitation, no application.
            {admin?.userId
              ? ` ${admin.name ?? "The current admin"} stays a member here but can no longer manage the shop.`
              : ""}
          </p>
          <Button className="w-full" onClick={() => void assign()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {assigned
              ? `Replace Shop Admin with ${picked.full_name}`
              : `Assign ${picked.full_name} as Shop Admin`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

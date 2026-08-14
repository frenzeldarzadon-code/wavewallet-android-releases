/**
 * Assign or replace the admin of one shop (platform owner only).
 *
 * Assigning moves the admin role, not the money: the outgoing admin keeps
 * their membership, wallet and history and simply steps down, and the shop's
 * balances are untouched. The database records who was replaced, who took
 * over, which operator did it and when, and notifies the new admin.
 */
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      toast.success(`${picked.full_name} is now the shop admin`, {
        description: admin?.userId
          ? "The previous admin keeps their membership, wallet and history."
          : "They have been notified and can open the shop console now.",
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

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Shop admin</p>
        <StatusBadge tone={admin?.userId ? "success" : "warning"}>
          {admin?.userId ? "assigned" : "unassigned"}
        </StatusBadge>
      </div>

      {admin?.userId ? (
        <p className="text-xs text-muted-foreground">
          {admin.name ?? "Unnamed"} · {admin.email ?? "no email"}
          {admin.assignedAt ? ` · assigned ${shortDateTime(admin.assignedAt)}` : ""}
        </p>
      ) : null}
      {notice ? <p className="text-xs text-warning-foreground">{notice}</p> : null}

      <div className="space-y-1.5">
        <Label htmlFor="sa-q">{admin?.userId ? "Replace with" : "Assign"} a Universe member</Label>
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
              className={`flex w-full flex-col items-start rounded-xl border px-3 py-2 text-left ${
                picked?.user_id === m.user_id ? "border-primary bg-brand-soft" : "border-border"
              }`}
            >
              <span className="text-sm font-medium">{m.full_name}</span>
              <span className="text-[11px] text-muted-foreground">{candidateIdentityLine(m)}</span>
            </button>
          ))
        : null}

      {picked ? (
        <Button className="w-full" onClick={() => void assign()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          {admin?.userId ? `Replace admin with ${picked.full_name}` : `Make ${picked.full_name} admin`}
        </Button>
      ) : null}
    </div>
  );
}

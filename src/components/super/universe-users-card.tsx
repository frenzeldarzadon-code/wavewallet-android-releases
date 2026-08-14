/**
 * Universe users who belong to no shop yet.
 *
 * The platform owner can place one of them into a shop as a customer, or remove
 * an account that carries no money at all. Assigning creates exactly one shop
 * membership and leaves the person's global Universe identity untouched.
 */
import { useEffect, useState } from "react";
import { Loader2, Search, ShieldAlert, Store, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberAvatar } from "@/components/member-avatar";
import { EmptyState } from "@/components/ui-kit";
import { displayHandle } from "@/lib/profile";
import { deletePlatformUser } from "@/lib/platform-users.functions";
import {
  assignMemberToShop,
  deletionSummary,
  fetchDeletionCheck,
  fetchUnassignedUsers,
  type DeletionCheck,
  type UnassignedUser,
} from "@/lib/platform-users";

export function UniverseUsersCard({
  shops,
}: {
  shops: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<UnassignedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignTo, setAssignTo] = useState<UnassignedUser | null>(null);
  const [shopId, setShopId] = useState("");
  const [removing, setRemoving] = useState<UnassignedUser | null>(null);
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = (q?: string) => {
    setLoading(true);
    return fetchUnassignedUsers(q ?? search)
      .then(setRows)
      .catch((e: Error) => toast.error("Could not load members", { description: e.message }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRemove = async (u: UnassignedUser) => {
    setRemoving(u);
    setCheck(null);
    setReason("");
    try {
      setCheck(await fetchDeletionCheck(u.user_id));
    } catch (e) {
      toast.error("Could not check that account", { description: (e as Error).message });
    }
  };

  const confirmAssign = async () => {
    if (!assignTo || !shopId) return;
    setBusy(true);
    try {
      await assignMemberToShop(assignTo.user_id, shopId);
      toast.success("Added to the shop as a customer");
      setAssignTo(null);
      setShopId("");
      await load();
    } catch (e) {
      toast.error("Could not add them", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const result = await deletePlatformUser({
        data: { userId: removing.user_id, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      toast.success("Account removed", {
        description: result.loginReleased
          ? "Financial history is kept. They can sign up again with the same email or mobile."
          : `History kept, but the login could not be released: ${result.message}`,
      });
      setRemoving(null);
      await load();
    } catch (e) {
      toast.error("Could not remove that account", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-base">Universe users — pending shop assignment</CardTitle>
        <CardDescription>
          People who signed up and belong to no shop yet. They keep full Universe access; a shop
          membership is only created when you add one here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pb-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, @handle, email or mobile"
            className="h-10"
          />
          <Button type="submit" variant="outline" className="gap-1.5">
            <Search className="size-4" />
            <span className="hidden sm:inline">Search</span>
          </Button>
        </form>

        {loading ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nobody is waiting"
            description="Every Universe member belongs to at least one shop."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((u) => (
              <li key={u.user_id} className="flex flex-wrap items-center gap-3 py-3">
                <MemberAvatar path={u.avatar_path} name={u.full_name} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[displayHandle(u.handle), u.email, u.phone].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setAssignTo(u);
                      setShopId("");
                    }}
                  >
                    <Store className="size-4" /> Assign
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-destructive"
                    onClick={() => void openRemove(u)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={assignTo !== null} onOpenChange={(o) => !o && setAssignTo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to a shop</DialogTitle>
            <DialogDescription>
              {assignTo?.full_name} joins as a customer with their own wallet in that shop. Other
              shop memberships and balances are untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="assign-shop">Shop</Label>
            <Select value={shopId} onValueChange={setShopId}>
              <SelectTrigger id="assign-shop">
                <SelectValue placeholder="Choose a shop" />
              </SelectTrigger>
              <SelectContent>
                {shops.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTo(null)}>
              Cancel
            </Button>
            <Button disabled={!shopId || busy} onClick={() => void confirmAssign()} className="gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Add as customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removing?.full_name}?</DialogTitle>
            <DialogDescription>
              Financial records stay intact and anonymised. The login is released so the same email
              or mobile can be used to sign up again later.
            </DialogDescription>
          </DialogHeader>
          {!check ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking balances…
            </p>
          ) : (
            <div
              className={`rounded-lg border p-3 text-sm ${
                check.eligible
                  ? "border-success/40 bg-success/10"
                  : "border-destructive/40 bg-destructive/10"
              }`}
            >
              <p className="flex items-center gap-2 font-medium">
                <ShieldAlert className="size-4" />
                {check.eligible ? "Safe to remove" : "Cannot be removed"}
              </p>
              <p className="mt-1">{deletionSummary(check)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Credits {check.credit_total} · Points {check.points_total} · Paid social credits{" "}
                {check.social_purchased}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="remove-reason">Reason (kept in the audit log)</Label>
            <Input
              id="remove-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!check?.eligible || busy}
              onClick={() => void confirmRemove()}
              className="gap-1.5"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Remove account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Ecosystem switcher: one login, one active shop at a time.
 *
 * Switching only changes which membership is active — roles, wallets, history
 * and downlines stay attached to their own shop. The database re-authorizes
 * every switch, so this control can never widen access.
 */
import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Plus, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { roleLabels } from "@/lib/wavewallet";
import {
  fetchJoinableEcosystems,
  fetchMyMemberships,
  requestJoinEcosystem,
  switchEcosystem,
  switchableMemberships,
  type JoinableEcosystem,
  type Membership,
} from "@/lib/memberships";

export function EcosystemSwitcher({ mini }: { mini?: boolean }) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinable, setJoinable] = useState<JoinableEcosystem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchMyMemberships().then(setMemberships);
  }, []);

  const options = switchableMemberships(memberships);
  const active = options.find((m) => m.isActive) ?? null;
  if (options.length === 0) return null;

  async function choose(ecosystemId: string) {
    if (busy || active?.ecosystemId === ecosystemId) return;
    setBusy(true);
    try {
      await switchEcosystem(ecosystemId);
      // Reload so every wallet, list and report refetches in the new context.
      window.location.reload();
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof Error ? error.message : "Could not switch shop");
    }
  }

  async function openJoin() {
    setJoinOpen(true);
    setJoinable(await fetchJoinableEcosystems());
  }

  async function join(id: string) {
    setBusy(true);
    try {
      await requestJoinEcosystem(id);
      toast.success("Request sent — an admin of that shop will review it.");
      setJoinable(await fetchJoinableEcosystems());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label="Switch shop"
            className={cn("w-full justify-between gap-2", mini && "px-0 justify-center")}
          >
            {mini ? (
              <Store className="size-4" />
            ) : (
              <>
                <span className="min-w-0 truncate text-left">
                  <span className="block truncate text-xs font-medium">
                    {active?.ecosystemName ?? "Choose shop"}
                  </span>
                  <span className="block truncate text-[10px] capitalize text-muted-foreground">
                    {active ? roleLabels[active.role] : "No active shop"}
                  </span>
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs">Your shops</DropdownMenuLabel>
          {options.map((m) => (
            <DropdownMenuItem
              key={m.ecosystemId}
              onSelect={() => void choose(m.ecosystemId)}
              className="gap-2"
            >
              <Check className={cn("size-3.5", m.isActive ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0 flex-1 truncate">{m.ecosystemName}</span>
              <span className="text-[10px] capitalize text-muted-foreground">
                {roleLabels[m.role]}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void openJoin()} className="gap-2">
            <Plus className="size-3.5" /> Join another shop
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Join another shop</DialogTitle>
            <DialogDescription>
              You keep your login and profile. Each shop gives you its own role, wallet and
              history — nothing is shared between them. An admin of that shop approves the request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {joinable.length === 0 ? (
              <p className="text-sm text-muted-foreground">No other shops are open right now.</p>
            ) : (
              joinable.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-xl border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    {e.description ? (
                      <p className="truncate text-xs text-muted-foreground">{e.description}</p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant={e.pending ? "outline" : "default"}
                    disabled={e.pending || busy}
                    onClick={() => void join(e.id)}
                  >
                    {e.pending ? "Pending" : "Request"}
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

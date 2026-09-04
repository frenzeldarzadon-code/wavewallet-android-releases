/**
 * Ecosystem switcher: one login, one active shop at a time.
 *
 * Switching only changes which membership is active — roles, wallets, history
 * and downlines stay attached to their own shop. The database re-authorizes
 * every switch, so this control can never widen access.
 *
 * Universe is the customer portal, so there is no "join another shop" request
 * here any more: a member becomes part of a shop's team only through the
 * shop's own management (assignment or invitation), never by asking.
 */
import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { roleLabels } from "@/lib/wavewallet";
import {
  fetchMyMemberships,
  switchEcosystem,
  switchableMemberships,
  type Membership,
} from "@/lib/memberships";

export function EcosystemSwitcher({ mini }: { mini?: boolean }) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
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

  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

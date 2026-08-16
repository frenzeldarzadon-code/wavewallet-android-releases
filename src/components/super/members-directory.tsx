/**
 * Super Admin "Shop members" directory.
 *
 * Read-only listing across every shop with the two privileged actions the
 * platform owner already has — Access Account (audited delegation) and Manual
 * Credit — reachable per row. Both actions keep their existing server-side
 * authorization; this screen is only a launcher.
 */
import { Coins, KeyRound, Percent, Search, Trash2, UserCog } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { AccessAccountDialog, type AccessTarget } from "@/components/access-account-dialog";
import { ManualCreditDialog } from "@/components/super/manual-credit-dialog";
import { CashbackRateDialog, type CashbackTarget } from "@/components/cashback-rate-dialog";
import { MemberAccountDialog } from "@/components/super/member-account-dialog";
import { PurgeMemberDialog, type PurgeTarget } from "@/components/super/purge-member-dialog";
import { fetchEcosystemNames } from "@/lib/credit-management";
import {
  DIRECTORY_ROLES,
  canActAsMember,
  listPlatformMembers,
  type PlatformMember,
} from "@/lib/platform-members";
import { roleLabel } from "@/lib/wavewallet";
import { RoleBadge } from "@/components/role-badge";
import { visibleIdentifiers } from "@/lib/account-assistance";

const ALL = "all";

export function MembersDirectory() {
  const [query, setQuery] = useState("");
  const [ecosystem, setEcosystem] = useState<string>(ALL);
  const [role, setRole] = useState<string>(ALL);
  const [rows, setRows] = useState<PlatformMember[]>([]);
  const [shops, setShops] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [accessTarget, setAccessTarget] = useState<AccessTarget | null>(null);
  const [creditTarget, setCreditTarget] = useState<PlatformMember | null>(null);
  const [accountTarget, setAccountTarget] = useState<PlatformMember | null>(null);
  const [rateTarget, setRateTarget] = useState<CashbackTarget | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null);

  useEffect(() => {
    void fetchEcosystemNames().then(setShops).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPlatformMembers({
        query,
        ecosystemId: ecosystem === ALL ? null : ecosystem,
        role: role === ALL ? null : (role as PlatformMember["role"]),
      });
      setRows(data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, ecosystem, role]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 220);
    return () => clearTimeout(t);
  }, [load]);

  const shopOptions = useMemo(() => [...shops.entries()], [shops]);

  return (
    <>
      <PageSection
        title="Shop members"
        description="Every account on the platform, grouped by shop. Search by name, @handle, email or phone."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 pl-9"
                placeholder="Search name, @handle, email or phone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search members"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Select value={ecosystem} onValueChange={setEcosystem}>
                <SelectTrigger className="h-11" aria-label="Filter by shop">
                  <SelectValue placeholder="All shops" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All shops</SelectItem>
                  {shopOptions.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-11" aria-label="Filter by role">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All roles</SelectItem>
                  {DIRECTORY_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title={loading ? "Loading members…" : `${rows.length} member(s)`}
        description="One row per real account. Someone who belongs to several shops appears once, with their wallets totalled."
      >
        {!loading && rows.length === 0 ? (
          <EmptyState title="No members match" description="Try a different search or filter." />
        ) : (
          <div className="space-y-2">
            {rows.map((m) => (
              <Card key={m.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <MemberAvatar name={m.full_name} path={m.avatar_path} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {m.full_name}
                      {m.handle ? (
                        <span className="ml-1 font-normal text-muted-foreground">@{m.handle}</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {visibleIdentifiers(m).email ?? "No email on file"}
                      {visibleIdentifiers(m).phone ? ` · ${visibleIdentifiers(m).phone}` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <RoleBadge role={m.role} showCustomer />
                      {m.shops ? (
                        <Badge variant="outline">{m.shops}</Badge>
                      ) : m.ecosystem_name ? (
                        <Badge variant="outline">{m.ecosystem_name}</Badge>
                      ) : (
                        <Badge variant="outline">Universe only</Badge>
                      )}
                      <Badge variant="outline">{m.status}</Badge>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-sm font-semibold text-primary">
                      {m.credit_balance.toLocaleString()} credits
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.points_balance.toLocaleString()} points
                      {m.shop_count > 1 ? ` · ${m.shop_count} shops` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCreditTarget(m)}
                      className="h-9"
                    >
                      <Coins className="size-4" /> Issue coins
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9"
                      onClick={() => setAccountTarget(m)}
                    >
                      <UserCog className="size-4" /> Manage account
                    </Button>
                    {(m.role === "reseller" || m.role === "subreseller") && m.ecosystem_id ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9"
                        onClick={() =>
                          setRateTarget({
                            id: m.id,
                            name: m.full_name,
                            role: m.role as "reseller" | "subreseller",
                            ecosystemId: m.ecosystem_id!,
                            shopName: m.ecosystem_name,
                          })
                        }
                      >
                        <Percent className="size-4" /> Discount
                      </Button>
                    ) : null}
                    {canActAsMember(m) ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-9"
                        onClick={() =>
                          setAccessTarget({ id: m.id, name: m.full_name, role: m.role })
                        }
                      >
                        <KeyRound className="size-4" /> Access account
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 text-destructive"
                      onClick={() => setPurgeTarget({ id: m.id, name: m.full_name })}
                    >
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <CashbackRateDialog
        target={rateTarget}
        onClose={() => setRateTarget(null)}
        onSaved={() => void load()}
      />
      <MemberAccountDialog
        member={accountTarget}
        onClose={() => setAccountTarget(null)}
        onSaved={() => void load()}
      />
      <AccessAccountDialog target={accessTarget} onClose={() => setAccessTarget(null)} />
      <ManualCreditDialog
        target={
          creditTarget
            ? {
                id: creditTarget.id,
                full_name: creditTarget.full_name,
                avatar_path: creditTarget.avatar_path,
                role: creditTarget.role,
                ecosystem_name: creditTarget.ecosystem_name,
                credit_balance: creditTarget.credit_balance,
              }
            : null
        }
        onClose={() => setCreditTarget(null)}
        onGranted={() => void load()}
      />
    </>
  );
}

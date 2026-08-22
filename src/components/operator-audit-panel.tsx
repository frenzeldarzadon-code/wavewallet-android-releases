/**
 * Dual-identity audit view: every action taken while an operator was acting as
 * another member. Visibility follows the audit-log RLS policies — admins see
 * their own shop, super admins see the whole platform.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import {
  fetchOperatorAudit,
  filterOperatorAudit,
  type OperatorAuditRow,
} from "@/lib/impersonation";
import { shortDateTime } from "@/lib/wavewallet";

export function OperatorAuditPanel({
  ecosystemId,
  scope,
}: {
  ecosystemId: string | null;
  /** "platform" shows every shop the viewer may read. */
  scope: "ecosystem" | "platform";
}) {
  const [rows, setRows] = useState<OperatorAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchOperatorAudit({
      ...(scope === "ecosystem" ? { ecosystemId } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}),
      ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
    }).then((r) => {
      if (!active) return;
      setRows(r);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [ecosystemId, scope, from, to]);

  const visible = useMemo(
    () => filterOperatorAudit(rows, { query: q, targetRole: role }),
    [rows, q, role],
  );

  return (
    <PageSection devSlot="operator-audit-panel.operator-actions"
      title="Operator actions"
      description="Actions taken by an Admin or Super Admin while accessing a member's account. The operator's identity is always recorded."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="op-q">Search</Label>
            <Input
              id="op-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Operator, member, action or reason"
            />
          </div>
          <div>
            <Label>Member role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="reseller">Reseller</SelectItem>
                <SelectItem value="subreseller">Subreseller</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="op-from">From</Label>
              <Input id="op-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="op-to">To</Label>
              <Input id="op-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 shadow-[var(--shadow-card)]">
        <CardContent className="divide-y divide-border px-0 py-0">
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <EmptyState
              title="No operator actions yet"
              description="Entering a member's account and every change made there will appear here."
            />
          ) : (
            visible.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.action}</p>
                  <p className="text-xs text-muted-foreground">
                    Operator: {r.actorName}
                    {r.operatorRole ? ` (${r.operatorRole.replace("_", " ")})` : ""} · Target:{" "}
                    {r.target}
                  </p>
                  {r.reason ? (
                    <p className="text-xs text-muted-foreground">Reason: {r.reason}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {r.entity ? <StatusBadge tone="muted">{r.entity.replace(/_/g, " ")}</StatusBadge> : null}
                  <span className="text-[11px] text-muted-foreground">
                    {shortDateTime(r.created_at)}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </PageSection>
  );
}

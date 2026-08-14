/**
 * Cash in payment methods — database driven CRUD for the platform owner.
 * Members only ever see the methods marked active here.
 */
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, StatusBadge } from "@/components/ui-kit";
import {
  deletePaymentMethod,
  fetchPaymentMethods,
  savePaymentMethod,
  type PaymentMethod,
} from "@/lib/wallet-money";

const TYPES = [
  { value: "cash", label: "Cash on hand" },
  { value: "ewallet", label: "E-wallet" },
  { value: "bank", label: "Bank" },
  { value: "other", label: "Other" },
];

const blank = {
  id: null as string | null,
  name: "",
  method_type: "ewallet",
  instructions: "",
  account_name: "",
  account_number: "",
  notes: "",
  active: true,
};

export function PaymentMethodsCard() {
  const [rows, setRows] = useState<PaymentMethod[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await fetchPaymentMethods(false));
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Give this payment method a name.");
      return;
    }
    setBusy(true);
    try {
      await savePaymentMethod(form);
      toast.success(form.id ? "Payment method updated." : "Payment method added.");
      setForm({ ...blank });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (m: PaymentMethod) => {
    try {
      await savePaymentMethod({
        id: m.id,
        name: m.name,
        method_type: m.method_type,
        instructions: m.instructions,
        account_name: m.account_name,
        account_number: m.account_number,
        notes: m.notes,
        active: !m.active,
        sort_order: m.sort_order ?? 0,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update.");
    }
  };

  return (
    <Card className="mb-6 shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Cash in payment methods</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pm-name">Name</Label>
            <Input id="pm-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-type">Type</Label>
            <Select value={form.method_type} onValueChange={(v) => setForm({ ...form, method_type: v })}>
              <SelectTrigger id="pm-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-acct-name">Account name</Label>
            <Input
              id="pm-acct-name"
              value={form.account_name}
              onChange={(e) => setForm({ ...form, account_name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-acct-no">Account number</Label>
            <Input
              id="pm-acct-no"
              value={form.account_number}
              onChange={(e) => setForm({ ...form, account_number: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pm-instructions">Payment instructions</Label>
          <Textarea
            id="pm-instructions"
            rows={2}
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pm-notes">Notes</Label>
          <Textarea
            id="pm-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="pm-active"
            checked={form.active}
            onCheckedChange={(v) => setForm({ ...form, active: v })}
          />
          <Label htmlFor="pm-active">Active</Label>
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={busy}>
            <Plus className="size-4" /> {form.id ? "Save changes" : "Add method"}
          </Button>
          {form.id ? (
            <Button variant="outline" onClick={() => setForm({ ...blank })}>
              Cancel
            </Button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No payment methods yet" description="Members cannot cash in until one is active." />
        ) : (
          <div className="space-y-3">
            {rows.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3 text-xs"
              >
                <div className="min-w-[14rem] flex-1 space-y-1.5">
                  <p className="text-base font-semibold">{m.name}</p>
                  <dl className="grid gap-1 sm:grid-cols-2">
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Payment method</dt>
                      <dd className="text-sm font-medium">
                        {TYPES.find((t) => t.value === m.method_type)?.label ?? m.method_type}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Account name</dt>
                      <dd className="text-sm font-medium">{m.account_name?.trim() || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Account number</dt>
                      <dd className="text-sm font-medium">{m.account_number?.trim() || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</dt>
                      <dd className="text-sm font-medium whitespace-pre-line">{m.notes?.trim() || "—"}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={m.active ? "success" : "muted"}>{m.active ? "Active" : "Inactive"}</StatusBadge>
                  <Button size="sm" variant="outline" onClick={() => void toggle(m)}>
                    {m.active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({
                        id: m.id,
                        name: m.name,
                        method_type: m.method_type,
                        instructions: m.instructions ?? "",
                        account_name: m.account_name ?? "",
                        account_number: m.account_number ?? "",
                        notes: m.notes ?? "",
                        active: m.active,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${m.name}?`)) return;
                      try {
                        await deletePaymentMethod(m.id);
                        await load();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not remove.");
                      }
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

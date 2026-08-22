/**
 * Receiving / payment accounts — provider-agnostic CRUD.
 *
 * The platform owner manages platform-wide accounts (`ecosystemId` null); a
 * shop admin manages only their own shop's accounts. Which of the two applies
 * is enforced in the database RPC, never here.
 *
 * Each account may carry a QR code image. The uploaded image is authoritative:
 * decoding is only used to prefill the account details when it works.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, QrCode, Trash2, Upload } from "lucide-react";
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
import { PaymentQrPreview } from "@/components/money/payment-qr";
import {
  deletePaymentQr,
  fetchPaymentProviders,
  uploadPaymentQr,
  type PaymentProviderRow,
} from "@/lib/payment-accounts";
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

const NO_PROVIDER = "__none__";

const blank = {
  id: null as string | null,
  name: "",
  method_type: "ewallet",
  provider_id: NO_PROVIDER,
  label: "",
  instructions: "",
  account_name: "",
  account_number: "",
  notes: "",
  qr_path: null as string | null,
  qr_content: null as string | null,
  active: true,
};

export function ReceivingAccountsCard({
  ecosystemId = null,
  title = "Receiving accounts",
  description,
}: {
  /** Null = platform-wide accounts (platform owner). */
  ecosystemId?: string | null;
  title?: string;
  description?: string;
}) {
  const [rows, setRows] = useState<PaymentMethod[]>([]);
  const [providers, setProviders] = useState<PaymentProviderRow[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await fetchPaymentMethods(false, { ecosystemId, includeGlobal: false });
      setRows(all);
    } catch {
      setRows([]);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
    void fetchPaymentProviders().then(setProviders);
  }, [load]);

  const pickQr = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const { path, content } = await uploadPaymentQr(ecosystemId, file);
      setForm((f) => ({
        ...f,
        qr_path: path,
        qr_content: content,
        account_number: f.account_number || guessAccountNumber(content),
      }));
      toast.success(content ? "QR uploaded and read." : "QR uploaded. Details could not be read — that is fine.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload that QR code.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Give this receiving account a name.");
      return;
    }
    setBusy(true);
    try {
      await savePaymentMethod({
        id: form.id,
        name: form.name,
        method_type: form.method_type,
        provider_id: form.provider_id === NO_PROVIDER ? null : form.provider_id,
        ecosystem_id: ecosystemId,
        label: form.label,
        instructions: form.instructions,
        account_name: form.account_name,
        account_number: form.account_number,
        notes: form.notes,
        qr_path: form.qr_path,
        qr_content: form.qr_content,
        active: form.active,
      });
      toast.success(form.id ? "Receiving account updated." : "Receiving account added.");
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
        provider_id: m.provider_id,
        ecosystem_id: m.ecosystem_id,
        label: m.label,
        instructions: m.instructions,
        account_name: m.account_name,
        account_number: m.account_number,
        notes: m.notes,
        qr_path: m.qr_path,
        qr_content: m.qr_content,
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
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
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
            <Label htmlFor="pm-provider">Provider / bank</Label>
            <Select value={form.provider_id} onValueChange={(v) => setForm({ ...form, provider_id: v })}>
              <SelectTrigger id="pm-provider">
                <SelectValue placeholder="Not linked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROVIDER}>Not linked</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pm-label">Display label</Label>
            <Input
              id="pm-label"
              placeholder="e.g. Main counter account"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
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
          <Label>QR code (optional)</Label>
          <input
            id="pm-qr"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              e.target.value = "";
              void pickQr(picked);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => document.getElementById("pm-qr")?.click()}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {form.qr_path ? "Replace QR" : "Upload QR"}
            </Button>
            {form.qr_path ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void deletePaymentQr(form.qr_path);
                  setForm({ ...form, qr_path: null, qr_content: null });
                }}
              >
                <Trash2 className="size-4 text-destructive" /> Remove QR
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <QrCode className="size-3.5" /> Payers can scan or download it instead of typing details.
              </span>
            )}
          </div>
          {form.qr_path ? <PaymentQrPreview path={form.qr_path} name={form.name || "Receiving account"} compact /> : null}
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
          <Switch id="pm-active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
          <Label htmlFor="pm-active">Active</Label>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            <Plus className="size-4" /> {form.id ? "Save changes" : "Add account"}
          </Button>
          {form.id ? (
            <Button variant="outline" onClick={() => setForm({ ...blank })}>
              Cancel
            </Button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No receiving accounts yet" description="Members cannot cash in until one is active." />
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
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Type</dt>
                      <dd className="text-sm font-medium">
                        {TYPES.find((t) => t.value === m.method_type)?.label ?? m.method_type}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Provider</dt>
                      <dd className="text-sm font-medium">
                        {providers.find((p) => p.id === m.provider_id)?.name ?? m.provider_id ?? "—"}
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
                  {m.qr_path ? (
                    <div className="max-w-[16rem]">
                      <PaymentQrPreview path={m.qr_path} name={m.name} compact />
                    </div>
                  ) : null}
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
                        provider_id: m.provider_id ?? NO_PROVIDER,
                        label: m.label ?? "",
                        instructions: m.instructions ?? "",
                        account_name: m.account_name ?? "",
                        account_number: m.account_number ?? "",
                        notes: m.notes ?? "",
                        qr_path: m.qr_path ?? null,
                        qr_content: m.qr_content ?? null,
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

/** A QR payload sometimes carries a plain account/mobile number. Best effort only. */
function guessAccountNumber(content: string | null): string {
  if (!content) return "";
  const mobile = content.match(/(?:\+?63|0)9\d{9}/);
  return mobile ? mobile[0] : "";
}

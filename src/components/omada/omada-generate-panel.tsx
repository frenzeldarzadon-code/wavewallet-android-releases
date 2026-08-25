/**
 * Generate hotspot vouchers on THIS shop's own Omada controller.
 *
 * The form is built from the controller's own published field list, so what
 * WaveWallet sends always matches what that controller expects — nothing is
 * hard-coded or guessed here. The exact request is shown before sending.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui-kit";
import {
  generateOmadaVouchers,
  getOmadaVoucherSetup,
  listOmadaVoucherBatches,
  type OmadaVoucherSetup,
} from "@/lib/omada-vouchers.functions";
import type { OmadaFieldSpec } from "@/lib/omada-vouchers.server";

type Values = Record<string, unknown>;

function label(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function initialValue(field: OmadaFieldSpec): unknown {
  if (field.type === "object" && field.fields) {
    const nested: Values = {};
    for (const child of field.fields) nested[child.name] = initialValue(child);
    return nested;
  }
  if (field.type === "array") return [];
  if (field.type === "boolean") return false;
  if (field.enum && field.enum.length > 0) return field.enum[0];
  if (field.type === "integer" || field.type === "number") return field.minimum ?? 0;
  return "";
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: OmadaFieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (field.type === "object" && field.fields) {
    const nested = (value ?? {}) as Values;
    return (
      <div className="space-y-3 rounded-md border p-3 sm:col-span-2">
        <p className="text-xs font-medium">{label(field.name)}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field.fields.map((child) => (
            <FieldInput
              key={child.name}
              field={child}
              value={nested[child.name]}
              onChange={(next) => onChange({ ...nested, [child.name]: next })}
            />
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <Label className="text-xs font-normal">{label(field.name)}</Label>
        <Switch checked={Boolean(value)} onCheckedChange={(v) => onChange(v)} />
      </div>
    );
  }

  const control =
    field.enum && field.enum.length > 0 ? (
      <Select value={String(value ?? "")} onValueChange={(v) => onChange(field.type === "integer" || field.type === "number" ? Number(v) : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {field.enum.map((option) => (
            <SelectItem key={String(option)} value={String(option)}>
              {String(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : field.type === "array" ? (
      <Input
        value={Array.isArray(value) ? (value as unknown[]).join(", ") : ""}
        placeholder="Comma separated"
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean)
              .map((part) => (/^-?\d+$/.test(part) ? Number(part) : part)),
          )
        }
      />
    ) : (
      <Input
        type={field.type === "integer" || field.type === "number" ? "number" : "text"}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) =>
          onChange(
            field.type === "integer" || field.type === "number"
              ? e.target.value === ""
                ? ""
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    );

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label(field.name)}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {control}
      {field.description ? (
        <p className="break-words text-[11px] text-muted-foreground">{field.description}</p>
      ) : null}
    </div>
  );
}

export function OmadaGeneratePanel({ ecosystemId }: { ecosystemId: string | null }) {
  const [setup, setSetup] = useState<OmadaVoucherSetup | null>(null);
  const [values, setValues] = useState<Values>({});
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<
    Array<{ id: string; group_name: string; amount: number; created_at: string; group_id: string | null }>
  >([]);

  const load = () => {
    if (!ecosystemId) return;
    void getOmadaVoucherSetup({ data: { ecosystemId } }).then((next) => {
      setSetup(next);
      const seed: Values = {};
      for (const field of next.fields) seed[field.name] = initialValue(field);
      setValues(seed);
    });
    void listOmadaVoucherBatches({ data: { ecosystemId } }).then(setBatches).catch(() => setBatches([]));
  };

  useEffect(load, [ecosystemId]);

  const payload = useMemo(() => {
    const out: Values = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === "" || v === undefined) continue;
      out[k] = v;
    }
    return out;
  }, [values]);

  if (!ecosystemId) return null;

  if (!setup) {
    return (
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  if (!setup.configured) {
    return (
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Connect your Omada controller on the Connection tab first. Voucher generation uses your
          shop's own controller only.
        </CardContent>
      </Card>
    );
  }

  const send = async () => {
    setBusy(true);
    try {
      const res = await generateOmadaVouchers({ data: { ecosystemId, payload } });
      toast.success("Vouchers generated on your Omada controller.", {
        description: res.groupId ? `Group ${res.groupId}` : undefined,
      });
      setPreview(false);
      load();
    } catch (e) {
      toast.error("Could not generate vouchers", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Generate vouchers</span>
            <StatusBadge tone={setup.supported ? "success" : "danger"}>
              {setup.supported ? "Calibrated to your controller" : "Unavailable"}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            These fields are read from your own controller, so what is sent matches exactly what it
            expects. Review the request before it is submitted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {setup.error ? (
            <p className="break-words rounded-md border border-destructive/40 p-3 text-xs text-destructive">
              {setup.error}
            </p>
          ) : null}
          {!setup.supported ? (
            <p className="break-words text-sm text-muted-foreground">{setup.limitation}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {setup.fields.map((field) => (
                  <FieldInput
                    key={field.name}
                    field={field}
                    value={values[field.name]}
                    onChange={(next) => setValues((v) => ({ ...v, [field.name]: next }))}
                  />
                ))}
              </div>

              {preview ? (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-xs font-medium">This exact request will be sent:</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => void send()}>
                      {busy ? "Sending…" : "Confirm and generate"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPreview(false)}>
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" onClick={() => setPreview(true)}>
                  Review request
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {batches.length > 0 ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Generated from WaveWallet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {batches.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs"
              >
                <span className="min-w-0 break-words font-medium">{b.group_name}</span>
                <span className="text-muted-foreground">
                  {b.amount} codes · {new Date(b.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

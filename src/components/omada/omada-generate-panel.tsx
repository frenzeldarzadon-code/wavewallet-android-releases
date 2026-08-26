/**
 * Shop-specific Omada voucher generation.
 *
 * Flow: choose one of THIS shop's voucher products -> its saved calibration is
 * prefilled -> the complete verified Omada template is shown and validated ->
 * the admin reviews and confirms -> the group is created on this shop's own
 * controller -> the generated codes are read back and shown in an editable
 * preview -> only an explicit second confirmation imports them into this
 * shop's Code Inventory. Nothing is ever imported automatically.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { StatusBadge } from "@/components/ui-kit";
import {
  controllerMismatch,
  isValidVoucherCode,
  reviewExtractedCodes,
  suggestGroupName,
  validateGenerationPayload,
  type GenValue,
  type VoucherFieldSpec,
} from "@/lib/omada-generation";
import {
  generateVoucherGroupForProduct,
  getVoucherGenerationSetup,
  importGeneratedVoucherCodes,
  listOmadaVoucherBatches,
  saveVoucherCalibration,
  type GenerationOutcome,
  type VoucherGenerationSetup,
} from "@/lib/omada-vouchers.functions";

type Values = Record<string, GenValue>;

function label(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function FieldInput({
  field,
  value,
  origin,
  onChange,
}: {
  field: VoucherFieldSpec;
  value: GenValue | undefined;
  origin: string | null;
  onChange: (next: GenValue) => void;
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
              origin={null}
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

  const control = field.enum ? (
    <Select
      value={String(value ?? "")}
      onValueChange={(v) => onChange(field.type === "integer" ? Number(v) : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {field.enum.map((option) => (
          <SelectItem key={String(option.value)} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : field.type === "array" ? (
    <Input
      value={Array.isArray(value) ? (value as GenValue[]).join(", ") : ""}
      placeholder="0 = digits, 1 = lower case, 2 = upper case"
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
      type={field.type === "integer" ? "number" : "text"}
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(e) =>
        onChange(
          field.type === "integer"
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
      <Label className="flex flex-wrap items-center gap-1.5 text-xs">
        <span>{label(field.name)}</span>
        {field.required ? (
          <span className="text-destructive">*</span>
        ) : (
          <span className="text-[10px] text-muted-foreground">optional</span>
        )}
        {origin ? (
          <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{origin}</span>
        ) : null}
      </Label>
      {control}
      {field.description ? (
        <p className="break-words text-[11px] text-muted-foreground">{field.description}</p>
      ) : null}
      {field.minimum !== undefined || field.maximum !== undefined ? (
        <p className="text-[11px] text-muted-foreground">
          Allowed: {field.minimum ?? "—"} to {field.maximum ?? "—"}
        </p>
      ) : null}
    </div>
  );
}

type Stage = "form" | "review" | "preview";

export function OmadaGeneratePanel({ ecosystemId }: { ecosystemId: string | null }) {
  const [setup, setSetup] = useState<VoucherGenerationSetup | null>(null);
  const [productId, setProductId] = useState<string>("");
  const [values, setValues] = useState<Values>({});
  const [calibratedKeys, setCalibratedKeys] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage>("form");
  const [busy, setBusy] = useState(false);
  const [saveAsCalibration, setSaveAsCalibration] = useState(false);
  const [outcome, setOutcome] = useState<GenerationOutcome | null>(null);
  const [codeText, setCodeText] = useState("");
  const [batches, setBatches] = useState<
    Array<{ id: string; group_name: string; amount: number; created_at: string; group_id: string | null }>
  >([]);

  const load = () => {
    if (!ecosystemId) return;
    void getVoucherGenerationSetup({ data: { ecosystemId } }).then(setSetup);
    void listOmadaVoucherBatches({ data: { ecosystemId } }).then(setBatches).catch(() => setBatches([]));
  };

  useEffect(load, [ecosystemId]);

  const product = useMemo(
    () => setup?.products.find((p) => p.id === productId) ?? null,
    [setup, productId],
  );

  const calibration = productId ? setup?.calibrations[productId] : undefined;

  const mismatch = useMemo(() => {
    if (!calibration || !setup?.controller) return null;
    return controllerMismatch(calibration.controller_identity, setup.controller);
  }, [calibration, setup]);

  const selectProduct = (id: string) => {
    setProductId(id);
    setStage("form");
    setOutcome(null);
    if (!setup) return;
    const chosen = setup.products.find((p) => p.id === id);
    const saved = setup.calibrations[id]?.payload ?? null;
    const next: Values = { ...setup.defaults, ...(saved ?? {}) };
    next["name"] = suggestGroupName(chosen?.name ?? "Vouchers", setup.groupNames);
    // Product-derived: the shop's own selling price is carried into Omada so the
    // two definitions cannot drift apart by mistake.
    if (chosen) next["unitPrice"] = String(chosen.promo_price ?? chosen.credit_price ?? "");
    setValues(next);
    setCalibratedKeys(new Set(saved ? Object.keys(saved) : []));
  };

  const payload = useMemo(() => {
    const out: Values = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === "" || v === undefined) continue;
      out[k] = v;
    }
    return out;
  }, [values]);

  const problems = useMemo(() => validateGenerationPayload(payload), [payload]);

  const previewCodes = useMemo(
    () =>
      codeText
        .split(/[\s,]+/)
        .map((c) => c.trim())
        .filter(Boolean),
    [codeText],
  );

  const codeLength = Number(values["codeLength"] ?? 0) || undefined;

  const summary = useMemo(
    () =>
      reviewExtractedCodes(previewCodes, outcome?.duplicateInInventory ?? [], codeLength),
    [previewCodes, outcome, codeLength],
  );

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

  const generate = async () => {
    setBusy(true);
    try {
      const res = await generateVoucherGroupForProduct({
        data: { ecosystemId, productId, payload, saveAsCalibration },
      });
      setOutcome(res);
      setCodeText(res.extracted.join("\n"));
      setStage("preview");
      toast.success("Vouchers generated on your Omada controller.", {
        description: res.retrievalNote ?? `${res.extracted.length} codes retrieved.`,
      });
      load();
    } catch (e) {
      toast.error("Nothing was generated", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const importCodes = async () => {
    if (summary.importable.length === 0) return;
    setBusy(true);
    try {
      const res = await importGeneratedVoucherCodes({
        data: {
          ecosystemId,
          productId,
          batchId: outcome?.batchId,
          codes: summary.importable,
        },
      });
      toast.success(`${res.importedCount} codes added to Code Inventory.`, {
        description:
          res.duplicateCount > 0 || res.invalidCount > 0
            ? `${res.duplicateCount} duplicate, ${res.invalidCount} invalid skipped.`
            : undefined,
      });
      setStage("form");
      setOutcome(null);
      setCodeText("");
      load();
    } catch (e) {
      toast.error("Import failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveCalibrationNow = async () => {
    setBusy(true);
    try {
      const res = await saveVoucherCalibration({ data: { ecosystemId, productId, payload } });
      toast.success(`Saved as calibration version ${res.version}.`);
      load();
    } catch (e) {
      toast.error("Could not save the calibration", { description: (e as Error).message });
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
            <StatusBadge tone="success">
              Omada {setup.controller?.controllerVersion ?? "controller"}
            </StatusBadge>
          </CardTitle>
          <CardDescription>
            Everything here belongs to this shop only — its products, its controller and its own
            Code Inventory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {setup.error ? (
            <p className="break-words rounded-md border border-destructive/40 p-3 text-xs text-destructive">
              {setup.error}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs">Voucher product *</Label>
            <Select value={productId} onValueChange={selectProduct}>
              <SelectTrigger>
                <SelectValue placeholder="Choose one of this shop's voucher products" />
              </SelectTrigger>
              <SelectContent>
                {setup.products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {setup.products.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Create a voucher product for this shop first.
              </p>
            ) : null}
          </div>

          {product ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                {calibration ? (
                  <StatusBadge tone="success">
                    Calibration v{calibration.version} prefilled
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warning">No saved calibration yet</StatusBadge>
                )}
                <span>Prefilled values stay editable for this generation only.</span>
              </div>

              {mismatch ? (
                <p className="break-words rounded-md border border-destructive/40 p-3 text-xs text-destructive">
                  {mismatch}
                </p>
              ) : null}

              {stage === "form" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {setup.fields.map((field) => (
                      <FieldInput
                        key={field.name}
                        field={field}
                        value={values[field.name]}
                        origin={
                          field.name === "unitPrice"
                            ? "from product"
                            : calibratedKeys.has(field.name)
                              ? `calibration v${calibration?.version ?? ""}`
                              : null
                        }
                        onChange={(next) => setValues((v) => ({ ...v, [field.name]: next }))}
                      />
                    ))}
                  </div>

                  {problems.length > 0 ? (
                    <ul className="space-y-1 rounded-md border border-destructive/40 p-3 text-xs text-destructive">
                      {problems.map((p) => (
                        <li key={p} className="break-words">
                          {p}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <Button size="sm" disabled={problems.length > 0} onClick={() => setStage("review")}>
                    Review before generating
                  </Button>
                </>
              ) : null}

              {stage === "review" ? (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-xs font-medium">Confirm this generation</p>
                  <dl className="grid gap-1 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Product</dt>
                      <dd className="break-words font-medium">{product.name}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Group name</dt>
                      <dd className="break-words font-medium">{String(values["name"] ?? "")}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Quantity</dt>
                      <dd className="font-medium">{String(values["amount"] ?? "")}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Controller</dt>
                      <dd className="break-words font-medium">
                        {setup.controller?.baseUrl} · {setup.controller?.controllerVersion ?? "—"}
                      </dd>
                    </div>
                  </dl>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-[11px]">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                  <div className="flex items-center justify-between gap-3 rounded-md border p-2">
                    <Label className="text-xs font-normal">
                      Save these settings as this product's calibration
                    </Label>
                    <Switch checked={saveAsCalibration} onCheckedChange={setSaveAsCalibration} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => void generate()}>
                      {busy ? "Generating…" : "Confirm and generate in Omada"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStage("form")}>
                      Back
                    </Button>
                  </div>
                </div>
              ) : null}

              {stage === "preview" && outcome ? (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-xs font-medium">
                    Review the codes before they enter Code Inventory
                  </p>
                  {outcome.retrievalNote ? (
                    <p className="break-words text-[11px] text-muted-foreground">
                      {outcome.retrievalNote}
                    </p>
                  ) : null}
                  <p className="break-words text-[11px] text-muted-foreground">
                    Group {outcome.groupName}
                    {outcome.groupId ? ` · ${outcome.groupId}` : ""}
                    {outcome.calibrationVersion ? ` · calibration v${outcome.calibrationVersion}` : ""}
                  </p>
                  <Textarea
                    value={codeText}
                    rows={10}
                    className="font-mono text-xs"
                    onChange={(e) => setCodeText(e.target.value)}
                  />
                  <div className="grid gap-1 text-xs sm:grid-cols-2">
                    <span>Extracted: {outcome.extracted.length}</span>
                    <span>In this list: {summary.extracted}</span>
                    <span>New and importable: {summary.importable.length}</span>
                    <span>
                      Duplicates: {summary.duplicateInBatch + summary.duplicateInInventory}
                    </span>
                    <span>Invalid format: {summary.invalid}</span>
                  </div>
                  {previewCodes.some((c) => !isValidVoucherCode(c, codeLength)) ? (
                    <p className="text-[11px] text-destructive">
                      Some codes do not match the expected format and will be skipped.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy || summary.importable.length === 0}
                      onClick={() => void importCodes()}
                    >
                      {busy
                        ? "Importing…"
                        : `Confirm import of ${summary.importable.length} codes`}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void saveCalibrationNow()}>
                      Save settings as calibration
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setStage("form");
                        setOutcome(null);
                      }}
                    >
                      Close without importing
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
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

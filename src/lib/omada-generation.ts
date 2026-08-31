/**
 * Pure, browser-safe rules for the shop-specific Omada voucher generation
 * workflow.
 *
 * Everything here was verified against a live Omada Controller 6.2.14.11
 * (Sagada Wave) by reading the controller's OWN validation responses. The
 * controller on that version does NOT publish an OpenAPI document, so the field
 * list, required flags and ranges below are the controller's own stated rules,
 * captured verbatim — not guesses.
 *
 *   POST /openapi/v1/{omadacId}/sites/{siteId}/hotspot/voucher-groups
 *   required: name, amount, codeLength, codeForm, limitType, duration,
 *             durationType, timingType, rateLimit, applyToAllPortals,
 *             trafficLimitEnable
 *   amount 1..5000 · codeLength 6..10 · duration 1..14400000
 *   limitType 0|1|2 · durationType 0|1 · timingType 0|1
 */

/** JSON-safe value: generation payloads cross the server boundary. */
export type GenValue = string | number | boolean | null | GenValue[] | { [key: string]: GenValue };

export interface VoucherFieldSpec {
  name: string;
  type: "string" | "integer" | "boolean" | "array" | "object";
  required: boolean;
  description: string;
  enum?: Array<{ value: number | string; label: string }>;
  minimum?: number;
  maximum?: number;
  fields?: VoucherFieldSpec[];
  /** Unit shown to the admin (display only; the controller unit is unchanged). */
  unitSuffix?: string;
  /** Display values may be fractional (e.g. 0.5 Mbps) even if the API wants an integer. */
  allowDecimal?: boolean;
}

/** Verified generation template for Omada Controller 6.2.x hotspot vouchers. */
export const VERIFIED_VOUCHER_FIELDS: VoucherFieldSpec[] = [
  {
    name: "name",
    type: "string",
    required: true,
    description: "Voucher group name shown in Omada. 1 to 32 characters.",
  },
  {
    name: "amount",
    type: "integer",
    required: true,
    description: "How many voucher codes to create. The controller allows 1 to 5000.",
    minimum: 1,
    maximum: 5000,
  },
  {
    name: "codeLength",
    type: "integer",
    required: true,
    description: "Number of characters in each code. The controller allows 6 to 10.",
    minimum: 6,
    maximum: 10,
  },
  {
    name: "codeForm",
    type: "array",
    required: true,
    description: "Character sets used in the code: 0 = digits, 1 = lower case, 2 = upper case.",
  },
  {
    name: "limitType",
    type: "integer",
    required: true,
    description: "How many devices may use one code.",
    enum: [
      { value: 0, label: "Limited number of users" },
      { value: 1, label: "Limited online users" },
      { value: 2, label: "Unlimited" },
    ],
  },
  {
    name: "limitNum",
    type: "integer",
    required: false,
    description: "Number of users allowed, used with the two limited options.",
    minimum: 1,
  },
  {
    name: "durationType",
    type: "integer",
    required: true,
    description: "How the duration is counted.",
    enum: [
      { value: 0, label: "Client duration" },
      { value: 1, label: "Voucher duration" },
    ],
  },
  {
    name: "duration",
    type: "integer",
    required: true,
    description: "Validity in minutes. The controller allows 1 to 14400000.",
    minimum: 1,
    maximum: 14_400_000,
  },
  {
    name: "timingType",
    type: "integer",
    required: true,
    description: "When the countdown starts.",
    enum: [
      { value: 0, label: "Timing by time" },
      { value: 1, label: "Timing by usage" },
    ],
  },
  {
    name: "rateLimit",
    type: "object",
    required: true,
    description: "Speed limit applied to clients using these vouchers.",
    fields: [
      {
        name: "mode",
        type: "integer",
        required: true,
        description: "0 = custom limit, 1 = existing rate limit profile.",
        enum: [
          { value: 0, label: "Custom rate limit" },
          { value: 1, label: "Rate limit profile" },
        ],
      },
      {
        name: "rateLimitProfileId",
        type: "string",
        required: false,
        description: "Profile id, required when mode is 1. Reuse the id from an existing group.",
      },
      {
        name: "customRateLimit",
        type: "object",
        required: false,
        description: "Custom limits, used when mode is 0.",
        fields: [
          {
            name: "downLimitEnable",
            type: "boolean",
            required: false,
            description: "Limit download speed.",
          },
          {
            name: "downLimit",
            type: "integer",
            required: false,
            description: "Download limit in Kbps.",
            minimum: 0,
          },
          {
            name: "upLimitEnable",
            type: "boolean",
            required: false,
            description: "Limit upload speed.",
          },
          {
            name: "upLimit",
            type: "integer",
            required: false,
            description: "Upload limit in Kbps.",
            minimum: 0,
          },
        ],
      },
    ],
  },
  {
    name: "trafficLimitEnable",
    type: "boolean",
    required: true,
    description: "Whether a data cap applies.",
  },
  {
    name: "trafficLimit",
    type: "integer",
    required: false,
    description: "Data cap amount, used when the data cap is on.",
    minimum: 0,
  },
  {
    name: "trafficLimitFrequency",
    type: "integer",
    required: false,
    description: "How the data cap resets.",
    enum: [
      { value: 0, label: "Total" },
      { value: 1, label: "Daily" },
      { value: 2, label: "Weekly" },
      { value: 3, label: "Monthly" },
    ],
  },
  {
    name: "applyToAllPortals",
    type: "boolean",
    required: true,
    description: "Whether these vouchers work on every portal of this site.",
  },
  {
    name: "unitPrice",
    type: "string",
    required: false,
    description: "Price recorded in Omada for each voucher.",
  },
  {
    name: "currency",
    type: "string",
    required: false,
    description: "Currency used for the price, for example PHP.",
  },
  {
    name: "validityType",
    type: "integer",
    required: false,
    description: "0 = permanent validity, 1 = valid for a set period.",
    enum: [
      { value: 0, label: "Permanent" },
      { value: 1, label: "Set period" },
    ],
  },
  {
    name: "logout",
    type: "boolean",
    required: false,
    description: "Whether clients may log out of the hotspot.",
  },
  {
    name: "description",
    type: "string",
    required: false,
    description: "Optional note stored with the group in Omada.",
  },
];

/** Sensible starting values that still satisfy every verified controller rule. */
export function defaultGenerationValues(): Record<string, GenValue> {
  return {
    name: "",
    amount: 10,
    codeLength: 8,
    codeForm: [0],
    limitType: 0,
    limitNum: 1,
    durationType: 1,
    duration: 480,
    timingType: 0,
    rateLimit: { mode: 0, customRateLimit: { downLimitEnable: false, upLimitEnable: false } },
    trafficLimitEnable: false,
    applyToAllPortals: true,
    currency: "PHP",
    validityType: 0,
    logout: false,
  };
}

export interface ControllerIdentity {
  baseUrl: string;
  omadacId: string;
  siteId: string;
  controllerVersion: string | null;
}

/** A calibration saved for a different controller/site must be reviewed first. */
export function controllerMismatch(
  saved: Partial<ControllerIdentity> | null | undefined,
  current: ControllerIdentity,
): string | null {
  if (!saved || !saved.omadacId) return null;
  const diffs: string[] = [];
  if (saved.baseUrl && saved.baseUrl !== current.baseUrl) diffs.push("controller address");
  if (saved.omadacId !== current.omadacId) diffs.push("controller identity");
  if (saved.siteId && saved.siteId !== current.siteId) diffs.push("site");
  if (
    saved.controllerVersion &&
    current.controllerVersion &&
    saved.controllerVersion !== current.controllerVersion
  ) {
    diffs.push("controller version");
  }
  if (diffs.length === 0) return null;
  return `This saved calibration was verified against a different ${diffs.join(", ")}. Review every setting before generating.`;
}

/**
 * Omada rejects any voucher group name outside 1~32 UTF-8 characters. This is
 * the single rule every generation path must satisfy, so it lives here and is
 * applied again immediately before the outbound request.
 */
export const OMADA_NAME_MAX_CHARS = 32;

/** Characters (code points), never bytes — multibyte names must stay intact. */
export function nameCharLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Makes any candidate name safe for Omada without changing any other rule:
 * whitespace is collapsed, a trailing date/counter suffix is preserved, and the
 * leading (product) part is shortened by code points when the whole is too long.
 * Deterministic: the same input always yields the same name.
 */
export function normalizeVoucherGroupName(raw: unknown, fallback = "Voucher batch"): string {
  const cleaned = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const safeFallback = Array.from(String(fallback).replace(/\s+/g, " ").trim())
    .slice(0, OMADA_NAME_MAX_CHARS)
    .join("");
  const base = cleaned || safeFallback || "Voucher batch";
  if (nameCharLength(base) <= OMADA_NAME_MAX_CHARS) return base;

  // Keep the meaningful tail (" 2026-08-31", " (2)", or both) and trim the head.
  const tailMatch = base.match(/(\s\d{4}-\d{2}-\d{2})?(\s\(\d+\))?$/);
  const tail = tailMatch?.[0] ?? "";
  const tailLen = nameCharLength(tail);
  const head = base.slice(0, base.length - tail.length);
  const room = OMADA_NAME_MAX_CHARS - tailLen;
  if (room <= 0) return Array.from(base).slice(0, OMADA_NAME_MAX_CHARS).join("");
  const trimmedHead = Array.from(head).slice(0, room).join("").trimEnd();
  const result = `${trimmedHead}${tail}`.trim();
  return Array.from(result).slice(0, OMADA_NAME_MAX_CHARS).join("") || safeFallback;
}

/** Group name default: product title + today's date, made unique for the day. */
export function defaultGroupName(
  productName: string,
  existingNames: string[],
  today: Date = new Date(),
): string {
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const base = normalizeVoucherGroupName(`${productName.trim()} ${stamp}`, `Vouchers ${stamp}`);
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 200; n += 1) {
    const candidate = normalizeVoucherGroupName(`${base} (${n})`, `Vouchers ${stamp}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return normalizeVoucherGroupName(`${base} (${Date.now()})`, `Vouchers ${stamp}`);
}

/** Validation against the verified controller rules, before anything is sent. */
export function validateGenerationPayload(payload: Record<string, GenValue>): string[] {
  const errors: string[] = [];
  const walk = (specs: VoucherFieldSpec[], value: Record<string, GenValue>, prefix: string) => {
    for (const field of specs) {
      const raw = value[field.name];
      const label = `${prefix}${field.name}`;
      const missing = raw === undefined || raw === null || raw === "";
      if (missing) {
        if (field.required) errors.push(`${label} is required by the controller.`);
        continue;
      }
      if (field.type === "integer") {
        const n = Number(raw);
        if (!Number.isInteger(n)) errors.push(`${label} must be a whole number.`);
        else {
          if (field.minimum !== undefined && n < field.minimum)
            errors.push(`${label} must be at least ${field.minimum}.`);
          if (field.maximum !== undefined && n > field.maximum)
            errors.push(`${label} must be at most ${field.maximum}.`);
          if (field.enum && !field.enum.some((o) => Number(o.value) === n))
            errors.push(`${label} must be one of ${field.enum.map((o) => o.value).join(", ")}.`);
        }
      } else if (field.type === "boolean") {
        if (typeof raw !== "boolean") errors.push(`${label} must be yes or no.`);
      } else if (field.type === "array") {
        if (!Array.isArray(raw) || raw.length === 0) errors.push(`${label} must have a value.`);
      } else if (field.type === "object") {
        if (typeof raw !== "object") errors.push(`${label} must be a set of values.`);
        else if (field.fields) walk(field.fields, raw as Record<string, GenValue>, `${label}.`);
      }
    }
  };
  walk(VERIFIED_VOUCHER_FIELDS, payload, "");

  const rawName = payload["name"];
  if (typeof rawName === "string" && rawName.trim()) {
    const length = nameCharLength(rawName.trim());
    if (length > OMADA_NAME_MAX_CHARS) {
      errors.push(`name must be 1 to ${OMADA_NAME_MAX_CHARS} characters (currently ${length}).`);
    }
  }

  const limitType = Number(payload["limitType"]);
  if ((limitType === 0 || limitType === 1) && !Number(payload["limitNum"])) {
    errors.push("limitNum is required for the limited user options.");
  }
  const rateLimit = payload["rateLimit"] as Record<string, GenValue> | undefined;
  if (rateLimit && Number(rateLimit["mode"]) === 1 && !rateLimit["rateLimitProfileId"]) {
    errors.push("rateLimit.rateLimitProfileId is required when using a rate limit profile.");
  }
  if (payload["trafficLimitEnable"] === true && !Number(payload["trafficLimit"])) {
    errors.push("trafficLimit is required when the data cap is on.");
  }
  return errors;
}

/** Codes are alphanumeric on Omada; length must match the generated codeLength. */
export function isValidVoucherCode(code: string, codeLength?: number): boolean {
  const clean = code.trim();
  if (!/^[A-Za-z0-9]{4,64}$/.test(clean)) return false;
  if (codeLength && clean.length !== codeLength) return false;
  return true;
}

export interface CodeReviewSummary {
  extracted: number;
  selected: number;
  unique: number;
  duplicateInBatch: number;
  duplicateInInventory: number;
  invalid: number;
  importable: string[];
}

/**
 * Duplicate and format analysis for the editable preview. Codes already present
 * in this shop's inventory are never re-imported and never overwrite anything.
 */
export function reviewExtractedCodes(
  selected: string[],
  existingInventory: string[],
  codeLength?: number,
): CodeReviewSummary {
  const inventory = new Set(existingInventory.map((c) => c.trim().toUpperCase()));
  const seen = new Set<string>();
  let duplicateInBatch = 0;
  let duplicateInInventory = 0;
  let invalid = 0;
  const importable: string[] = [];

  for (const raw of selected) {
    const clean = raw.trim();
    const key = clean.toUpperCase();
    if (!isValidVoucherCode(clean, codeLength)) {
      invalid += 1;
      continue;
    }
    if (seen.has(key)) {
      duplicateInBatch += 1;
      continue;
    }
    seen.add(key);
    if (inventory.has(key)) {
      duplicateInInventory += 1;
      continue;
    }
    importable.push(clean);
  }

  return {
    extracted: selected.length,
    selected: selected.length,
    unique: seen.size,
    duplicateInBatch,
    duplicateInInventory,
    invalid,
    importable,
  };
}

/* -------------------------------------------------------------------------
 * Display units for Voucher Creation
 *
 * Speed: the controller takes Kbps; admins enter Mbps (x1024).
 * Data cap: the controller's voucher group takes `trafficLimit` as a WHOLE
 * NUMBER OF MEGABYTES. WaveWallet admins configure the data cap exclusively in
 * GB, so the GB value is multiplied by 1024 at the Omada boundary and nowhere
 * else (1 GB -> 1024, 2 GB -> 2048, 5 GB -> 5120, 10 GB -> 10240). Conversion is
 * a pure 1024 factor both ways, so a saved calibration round-trips to exactly
 * the same controller value it already had.
 * ------------------------------------------------------------------------- */

export const KBPS_PER_MBPS = 1024;
/** Omada expects the data cap in MB; the admin enters GB. */
export const OMADA_MB_PER_GB = 1024;

/** GB as the admin sees it -> the exact integer MB Omada requires. */
export function gbToOmadaTrafficLimit(gb: number): number {
  return Math.round(gb * OMADA_MB_PER_GB);
}

/** Omada's MB value -> the GB value the admin sees. */
export function omadaTrafficLimitToGb(mb: number): number {
  return Number((mb / OMADA_MB_PER_GB).toFixed(6));
}

/**
 * A GB entry is valid when it is a finite, non-negative number that converts to
 * a whole number of MB (i.e. a multiple of 1/1024 GB).
 */
export function validateTrafficLimitGb(gb: unknown): string | null {
  const n = Number(gb);
  if (!Number.isFinite(n)) return "Data cap must be a number in GB.";
  if (n < 0) return "Data cap cannot be negative.";
  const mb = n * OMADA_MB_PER_GB;
  if (Math.abs(mb - Math.round(mb)) > 1e-6) {
    return "Data cap is too precise: it must convert to a whole number of MB (multiples of 1/1024 GB).";
  }
  return null;
}

/** Fields the admin edits in Mbps, nested under rateLimit.customRateLimit. */
const RATE_FIELDS = ["downLimit", "upLimit"] as const;

function scaleDown(raw: GenValue | undefined, factor: number): GenValue | undefined {
  if (raw === undefined || raw === null || raw === "") return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return Number((n / factor).toFixed(6));
}

function scaleUp(raw: GenValue | undefined, factor: number): GenValue | undefined {
  if (raw === undefined || raw === null || raw === "") return raw;
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return Math.round(n * factor);
}

/** Controller payload (Kbps / MB) -> what the admin sees (Mbps / GB). */
export function toDisplayUnits(values: Record<string, GenValue>): Record<string, GenValue> {
  const out: Record<string, GenValue> = { ...values };
  const traffic = scaleDown(out["trafficLimit"], OMADA_MB_PER_GB);
  if (traffic !== undefined) out["trafficLimit"] = traffic;

  const rateLimit = out["rateLimit"];
  if (rateLimit && typeof rateLimit === "object" && !Array.isArray(rateLimit)) {
    const rl = { ...(rateLimit as Record<string, GenValue>) };
    const custom = rl["customRateLimit"];
    if (custom && typeof custom === "object" && !Array.isArray(custom)) {
      const c = { ...(custom as Record<string, GenValue>) };
      for (const key of RATE_FIELDS) {
        const next = scaleDown(c[key], KBPS_PER_MBPS);
        if (next !== undefined) c[key] = next;
      }
      rl["customRateLimit"] = c;
    }
    out["rateLimit"] = rl;
  }
  return out;
}

/** What the admin sees (Mbps / MB) -> the controller payload (Kbps / KB). */
export function toControllerUnits(values: Record<string, GenValue>): Record<string, GenValue> {
  const out: Record<string, GenValue> = { ...values };
  const traffic = scaleUp(out["trafficLimit"], KB_PER_MB);
  if (traffic !== undefined) out["trafficLimit"] = traffic;

  const rateLimit = out["rateLimit"];
  if (rateLimit && typeof rateLimit === "object" && !Array.isArray(rateLimit)) {
    const rl = { ...(rateLimit as Record<string, GenValue>) };
    const custom = rl["customRateLimit"];
    if (custom && typeof custom === "object" && !Array.isArray(custom)) {
      const c = { ...(custom as Record<string, GenValue>) };
      for (const key of RATE_FIELDS) {
        const next = scaleUp(c[key], KBPS_PER_MBPS);
        if (next !== undefined) c[key] = next;
      }
      rl["customRateLimit"] = c;
    }
    out["rateLimit"] = rl;
  }
  return out;
}

/**
 * Same verified field list, relabelled for the form: speeds in Mbps and the
 * data cap in MB, with the allowed range converted to match.
 */
export function displayVoucherFields(fields: VoucherFieldSpec[]): VoucherFieldSpec[] {
  return fields.map((field) => {
    if (field.name === "trafficLimit") {
      return {
        ...field,
        unitSuffix: "MB",
        allowDecimal: true,
        description: "Data cap amount in MB, used when the data cap is on.",
        ...(field.minimum !== undefined ? { minimum: field.minimum / KB_PER_MB } : {}),
        ...(field.maximum !== undefined ? { maximum: field.maximum / KB_PER_MB } : {}),
      };
    }
    if ((RATE_FIELDS as readonly string[]).includes(field.name)) {
      return {
        ...field,
        unitSuffix: "Mbps",
        allowDecimal: true,
        description: field.description.replace(/in Kbps/i, "in Mbps"),
        ...(field.minimum !== undefined ? { minimum: field.minimum / KBPS_PER_MBPS } : {}),
        ...(field.maximum !== undefined ? { maximum: field.maximum / KBPS_PER_MBPS } : {}),
      };
    }
    if (field.fields) return { ...field, fields: displayVoucherFields(field.fields) };
    return field;
  });
}

/* -------------------------------------------------------------------------
 * Duration units for Voucher Creation
 *
 * The verified Omada 6.2.14.11 schema takes `duration` as a WHOLE NUMBER OF
 * MINUTES (1..14400000). The admin picks Minutes / Hours / Days purely for
 * convenience; the value is converted to minutes (x1, x60, x1440) before
 * validation and before anything is sent, so a saved calibration keeps exactly
 * the same controller meaning it already had.
 * ------------------------------------------------------------------------- */

export type DurationUnit = "minutes" | "hours" | "days";

export const DURATION_UNIT_MINUTES: Record<DurationUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};

export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};

/** Admin entry (value + unit) -> the controller's minutes. */
export function durationToMinutes(value: number, unit: DurationUnit): number {
  return Math.round(value * DURATION_UNIT_MINUTES[unit]);
}

/** Controller minutes -> the largest unit that still divides evenly. */
export function splitDurationMinutes(minutes: number): { value: number; unit: DurationUnit } {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return { value: n || 0, unit: "minutes" };
  if (n % DURATION_UNIT_MINUTES.days === 0) return { value: n / DURATION_UNIT_MINUTES.days, unit: "days" };
  if (n % DURATION_UNIT_MINUTES.hours === 0) return { value: n / DURATION_UNIT_MINUTES.hours, unit: "hours" };
  return { value: n, unit: "minutes" };
}

/** Human-readable duration for the review screen, e.g. "12 Hours". */
export function formatDurationUnits(minutes: number): string {
  const { value, unit } = splitDurationMinutes(minutes);
  const singular = value === 1 ? DURATION_UNIT_LABELS[unit].replace(/s$/, "") : DURATION_UNIT_LABELS[unit];
  return `${value} ${singular}`;
}

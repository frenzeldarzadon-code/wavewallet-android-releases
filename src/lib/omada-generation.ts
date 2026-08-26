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

export interface VoucherFieldSpec {
  name: string;
  type: "string" | "integer" | "boolean" | "array" | "object";
  required: boolean;
  description: string;
  enum?: Array<{ value: number | string; label: string }>;
  minimum?: number;
  maximum?: number;
  fields?: VoucherFieldSpec[];
}

/** Verified generation template for Omada Controller 6.2.x hotspot vouchers. */
export const VERIFIED_VOUCHER_FIELDS: VoucherFieldSpec[] = [
  {
    name: "name",
    type: "string",
    required: true,
    description: "Voucher group name shown in Omada.",
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
export function defaultGenerationValues(): Record<string, unknown> {
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

/** Group name default: product title + today's date, made unique for the day. */
export function defaultGroupName(
  productName: string,
  existingNames: string[],
  today: Date = new Date(),
): string {
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const base = `${productName.trim()} ${stamp}`.trim();
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 200; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/** Validation against the verified controller rules, before anything is sent. */
export function validateGenerationPayload(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const walk = (specs: VoucherFieldSpec[], value: Record<string, unknown>, prefix: string) => {
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
        else if (field.fields) walk(field.fields, raw as Record<string, unknown>, `${label}.`);
      }
    }
  };
  walk(VERIFIED_VOUCHER_FIELDS, payload, "");

  const limitType = Number(payload["limitType"]);
  if ((limitType === 0 || limitType === 1) && !Number(payload["limitNum"])) {
    errors.push("limitNum is required for the limited user options.");
  }
  const rateLimit = payload["rateLimit"] as Record<string, unknown> | undefined;
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

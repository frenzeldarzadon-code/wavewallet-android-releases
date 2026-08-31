import { normalizeVoucherGroupName } from "./omada-generation";
/**
 * Voucher calibration + operations against ONE tenant's Omada controller.
 *
 * Calibration is not guessed. WaveWallet reads the controller's OWN OpenAPI
 * document (`/openapi/v3/api-docs`, served by the controller itself) and derives
 * the voucher endpoints and the exact request schema from it. That means the
 * fields, types, enums and required flags always come from the controller the
 * tenant is actually connected to, never from a hard-coded assumption.
 */
import { OmadaError, omadaEnvelope, type OmadaSession } from "./omada-api.server";

const TIMEOUT_MS = 20_000;

export interface OmadaFieldSpec {
  name: string;
  /** JSON type as declared by the controller. */
  type: string;
  required: boolean;
  description: string | null;
  enum: Array<string | number> | null;
  format: string | null;
  minimum: number | null;
  maximum: number | null;
  /** Nested object fields, in declaration order. */
  fields: OmadaFieldSpec[] | null;
  /** Element spec when type is "array". */
  items: OmadaFieldSpec | null;
}

export interface OmadaVoucherCapabilities {
  /** Spec was readable and a create endpoint exists. */
  supported: boolean;
  createPath: string | null;
  listPath: string | null;
  groupDetailPath: string | null;
  voucherListPath: string | null;
  deletePath: string | null;
  fields: OmadaFieldSpec[];
  /** Human-readable reason when generation is not available. */
  limitation: string | null;
}

async function specFetch(url: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `AccessToken=${token}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The controller serves its own OpenAPI document behind the same token. */
export async function loadOmadaSpec(session: OmadaSession): Promise<Record<string, unknown> | null> {
  for (const path of ["/openapi/v3/api-docs", "/openapi/v2/api-docs", "/openapi/api-docs"]) {
    const doc = await specFetch(`${session.base}${path}`, session.token);
    if (doc && typeof doc === "object" && (doc as Record<string, unknown>)["paths"]) {
      return doc as Record<string, unknown>;
    }
  }
  return null;
}

type SchemaNode = Record<string, unknown>;

function deref(spec: Record<string, unknown>, node: SchemaNode | undefined): SchemaNode | undefined {
  let current = node;
  for (let hops = 0; current && typeof current["$ref"] === "string" && hops < 10; hops += 1) {
    const ref = String(current["$ref"]).replace(/^#\//, "").split("/");
    let target: unknown = spec;
    for (const part of ref) {
      target = (target as Record<string, unknown> | undefined)?.[part];
    }
    current = (target as SchemaNode | undefined) ?? undefined;
  }
  return current;
}

function fieldsOf(
  spec: Record<string, unknown>,
  schema: SchemaNode | undefined,
  depth = 0,
): OmadaFieldSpec[] {
  const node = deref(spec, schema);
  const props = node?.["properties"] as Record<string, SchemaNode> | undefined;
  if (!props || depth > 3) return [];
  const required = new Set((node?.["required"] as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, raw]) => describe(spec, name, raw, required.has(name), depth));
}

function describe(
  spec: Record<string, unknown>,
  name: string,
  raw: SchemaNode,
  required: boolean,
  depth: number,
): OmadaFieldSpec {
  const node = deref(spec, raw) ?? raw;
  const type = String(node["type"] ?? (node["properties"] ? "object" : "string"));
  const enumValues = Array.isArray(node["enum"])
    ? (node["enum"] as Array<string | number>)
    : null;
  return {
    name,
    type,
    required,
    description:
      typeof node["description"] === "string" ? (node["description"] as string).slice(0, 400) : null,
    enum: enumValues,
    format: typeof node["format"] === "string" ? (node["format"] as string) : null,
    minimum: typeof node["minimum"] === "number" ? (node["minimum"] as number) : null,
    maximum: typeof node["maximum"] === "number" ? (node["maximum"] as number) : null,
    fields: type === "object" ? fieldsOf(spec, node, depth + 1) : null,
    items:
      type === "array"
        ? describe(spec, `${name}[]`, (node["items"] as SchemaNode) ?? {}, false, depth + 1)
        : null,
  };
}

const VOUCHER_GROUPS = /\/hotspot\/voucher-groups$/;
const VOUCHER_GROUP_ONE = /\/hotspot\/voucher-groups\/\{[^}]+\}$/;
const VOUCHER_LIST = /\/hotspot\/voucher-groups\/\{[^}]+\}\/vouchers$/;
const OFFICIAL_VOUCHER_GROUPS =
  "/openapi/v1/{omadacId}/sites/{siteId}/hotspot/voucher-groups";
// On Controller 6.2, group detail includes the paginated voucher rows in
// result.data. Some newer schemas additionally publish a /vouchers child.
const OFFICIAL_VOUCHER_LIST = `${OFFICIAL_VOUCHER_GROUPS}/{groupId}`;

/**
 * Derives the voucher endpoints and the exact create-request schema from the
 * controller's own document. Returns `supported: false` with an explicit
 * limitation when this controller does not expose voucher generation.
 */
export function voucherCapabilities(
  spec: Record<string, unknown> | null,
): OmadaVoucherCapabilities {
  const empty: OmadaVoucherCapabilities = {
    supported: false,
    createPath: null,
    listPath: null,
    groupDetailPath: null,
    voucherListPath: null,
    deletePath: null,
    fields: [],
    limitation: null,
  };
  if (!spec) {
    return {
      ...empty,
      // These read-only routes are part of Omada's published Northbound Open
      // API. Reading status must not depend on the optional Swagger document.
      listPath: OFFICIAL_VOUCHER_GROUPS,
      voucherListPath: OFFICIAL_VOUCHER_LIST,
      limitation:
        "Voucher status is available through Omada's Open API, but this controller did not publish the voucher creation schema. Generation stays disabled rather than sending an unverified request.",
    };
  }
  const paths = (spec["paths"] as Record<string, Record<string, SchemaNode>>) ?? {};
  let createPath: string | null = null;
  let listPath: string | null = null;
  let groupDetailPath: string | null = null;
  let voucherListPath: string | null = null;
  let deletePath: string | null = null;
  let createOp: SchemaNode | undefined;

  for (const [path, ops] of Object.entries(paths)) {
    if (VOUCHER_GROUPS.test(path)) {
      if (ops["post"]) {
        createPath = path;
        createOp = ops["post"];
      }
      if (ops["get"]) listPath = path;
    } else if (VOUCHER_LIST.test(path)) {
      if (ops["get"]) voucherListPath = path;
    } else if (VOUCHER_GROUP_ONE.test(path)) {
      if (ops["get"]) groupDetailPath = path;
      if (ops["delete"]) deletePath = path;
    }
  }

  if (!createPath || !createOp) {
    return {
      ...empty,
      listPath,
      groupDetailPath,
      voucherListPath,
      limitation:
        "This controller's Open API does not expose a voucher-generation endpoint. Vouchers must be created in the Omada interface itself.",
    };
  }

  const body = deref(spec, createOp["requestBody"] as SchemaNode | undefined);
  const content = body?.["content"] as Record<string, SchemaNode> | undefined;
  const jsonSchema = content?.["application/json"]?.["schema"] as SchemaNode | undefined;
  const fields = fieldsOf(spec, jsonSchema);

  return {
    supported: fields.length > 0,
    createPath,
    listPath,
    groupDetailPath,
    voucherListPath,
    deletePath,
    fields,
    limitation:
      fields.length > 0
        ? null
        : "The controller exposes a voucher endpoint but did not describe its fields, so WaveWallet will not send a guessed request.",
  };
}

/** Replaces the {omadacId}/{siteId} placeholders with this tenant's own values. */
export function resolvePath(
  session: OmadaSession,
  template: string,
  extra: Record<string, string> = {},
): string {
  return template
    .replace(/\{omadacId\}/g, session.omadacId)
    .replace(/\{siteId\}/g, session.siteId)
    .replace(/\{([^}]+)\}/g, (whole, key: string) => extra[key] ?? whole);
}

async function call(
  session: OmadaSession,
  absolutePath: string,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${session.base}${absolutePath}`, {
      ...init,
      headers: {
        Authorization: `AccessToken=${session.token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text.slice(0, 8000);
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const parsed = omadaEnvelope(body);
    if (!res.ok || (parsed.code !== null && parsed.code !== 0)) {
      throw new OmadaError(
        `Omada refused the request: ${parsed.msg || `HTTP ${res.status}`}`,
        res.status === 401 || res.status === 403 ? "auth" : "api",
      );
    }
    return parsed.result;
  } catch (e) {
    if (e instanceof OmadaError) throw e;
    throw new OmadaError(
      `Controller not reachable: ${e instanceof Error ? e.message : String(e)}`,
      "unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function listVoucherGroups(
  session: OmadaSession,
  caps: OmadaVoucherCapabilities,
): Promise<Array<Record<string, unknown>>> {
  if (!caps.listPath) return [];
  const result = (await call(
    session,
    `${resolvePath(session, caps.listPath)}?page=1&pageSize=100`,
  )) as Record<string, unknown> | null;
  const rows = (result?.["data"] ?? result) as unknown;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/** Reads every controller page; Omada remains the source of truth. */
export async function listAllVoucherGroups(
  session: OmadaSession,
  caps: OmadaVoucherCapabilities,
): Promise<Array<Record<string, unknown>>> {
  if (!caps.listPath) return [];
  const pageSize = 100;
  const rows: Array<Record<string, unknown>> = [];
  for (let page = 1; ; page += 1) {
    const result = (await call(
      session,
      `${resolvePath(session, caps.listPath)}?page=${page}&pageSize=${pageSize}`,
    )) as Record<string, unknown> | null;
    const pageRows = (result?.["data"] ?? result) as unknown;
    const batch = Array.isArray(pageRows) ? (pageRows as Array<Record<string, unknown>>) : [];
    rows.push(...batch);
    const total = Number(result?.["totalRows"] ?? rows.length);
    if (batch.length === 0 || batch.length < pageSize || rows.length >= total) return rows;
  }
}

export async function listVouchersInGroup(
  session: OmadaSession,
  caps: OmadaVoucherCapabilities,
  groupId: string,
  page = 1,
  pageSize = 100,
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  if (!caps.voucherListPath) return { rows: [], total: 0 };
  const path = resolvePath(session, caps.voucherListPath, {
    groupId,
    id: groupId,
    voucherGroupId: groupId,
  });
  const result = (await call(session, `${path}?page=${page}&pageSize=${pageSize}`)) as Record<
    string,
    unknown
  > | null;
  const rows = (result?.["data"] ?? result) as unknown;
  return {
    rows: Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [],
    total: Number(result?.["totalRows"] ?? (Array.isArray(rows) ? rows.length : 0)),
  };
}

export async function findVoucherByCode(
  session: OmadaSession,
  caps: OmadaVoucherCapabilities,
  groupId: string,
  code: string,
): Promise<Record<string, unknown> | null> {
  const wanted = code.toUpperCase();
  const pageSize = 100;
  for (let page = 1; ; page += 1) {
    const { rows, total } = await listVouchersInGroup(session, caps, groupId, page, pageSize);
    const hit = rows.find((row) => String(row["code"] ?? "").toUpperCase() === wanted);
    if (hit) return hit;
    if (rows.length === 0 || rows.length < pageSize || page * pageSize >= total) return null;
  }
}

export async function createVoucherGroup(
  session: OmadaSession,
  caps: OmadaVoucherCapabilities,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!caps.createPath) {
    throw new OmadaError(caps.limitation ?? "Voucher generation is not available.", "api");
  }
  const result = await call(session, resolvePath(session, caps.createPath), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
}

/** Validates a payload against the controller's own declared schema. */
export function validateAgainstSpec(
  fields: OmadaFieldSpec[],
  payload: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const walk = (specs: OmadaFieldSpec[], value: Record<string, unknown>, prefix: string) => {
    for (const field of specs) {
      const raw = value[field.name];
      const label = `${prefix}${field.name}`;
      if (raw === undefined || raw === null || raw === "") {
        if (field.required) errors.push(`${label} is required by this controller.`);
        continue;
      }
      if (field.type === "integer" || field.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) errors.push(`${label} must be a number.`);
        else {
          if (field.type === "integer" && !Number.isInteger(n))
            errors.push(`${label} must be a whole number.`);
          if (field.minimum !== null && n < field.minimum)
            errors.push(`${label} must be at least ${field.minimum}.`);
          if (field.maximum !== null && n > field.maximum)
            errors.push(`${label} must be at most ${field.maximum}.`);
          if (field.enum && !field.enum.map(Number).includes(n))
            errors.push(`${label} must be one of ${field.enum.join(", ")}.`);
        }
      } else if (field.type === "boolean") {
        if (typeof raw !== "boolean") errors.push(`${label} must be yes or no.`);
      } else if (field.type === "object" && field.fields) {
        if (typeof raw !== "object") errors.push(`${label} must be a set of values.`);
        else walk(field.fields, raw as Record<string, unknown>, `${label}.`);
      } else if (field.type === "array") {
        if (!Array.isArray(raw)) errors.push(`${label} must be a list.`);
      } else if (field.enum && !field.enum.map(String).includes(String(raw))) {
        errors.push(`${label} must be one of ${field.enum.join(", ")}.`);
      }
    }
  };
  walk(fields, payload, "");
  return errors;
}

/**
 * Live client snapshot of this site (generic clients endpoint).
 *
 * Supplementary network information only. It reports devices that are online
 * RIGHT NOW and is NOT authoritative for "is a device authorized by this
 * voucher" — `listHotspotAuthedClients` below is.
 */
export async function listAuthorizedClients(
  session: OmadaSession,
): Promise<Array<Record<string, unknown>>> {
  const pageSize = 100;
  const rows: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = (await call(
      session,
      `/openapi/v1/${session.omadacId}/sites/${session.siteId}/clients?page=${page}&pageSize=${pageSize}`,
    )) as Record<string, unknown> | null;
    const pageRows = (result?.["data"] ?? result) as unknown;
    const batch = Array.isArray(pageRows) ? (pageRows as Array<Record<string, unknown>>) : [];
    rows.push(...batch);
    const total = Number(result?.["totalRows"] ?? rows.length);
    if (batch.length === 0 || batch.length < pageSize || rows.length >= total) break;
  }
  return rows;
}

/** Hotspot authorization records, paginated. `complete` is false when truncated. */
export interface AuthedClientPage {
  rows: Array<Record<string, unknown>>;
  complete: boolean;
}

/**
 * Omada's documented Hotspot Authorized Client operation (GetHotspotAuthedClients).
 *
 * Verified live on Controller 6.2.14.11:
 *   GET /openapi/v1/{omadacId}/sites/{siteId}/hotspot/authed-records
 *       ?page=&pageSize=[&searchKey=]
 * Each record carries `id` (authorization record id), `name`, `mac`, `ip`,
 * `ssid`/`networkName`, `authType` (3 = voucher), `voucherCode`, `start`,
 * `end`, `valid`, `download`, `upload` and `duration`. This is the authoritative
 * voucher -> device association and it keeps returning records after the
 * voucher expires, unlike the live client snapshot.
 *
 * Throws OmadaError on failure — a failure is never an empty device list.
 */
export async function listHotspotAuthedClients(
  session: OmadaSession,
  searchKey?: string,
): Promise<AuthedClientPage> {
  const pageSize = 100;
  const maxPages = 50;
  const rows: Array<Record<string, unknown>> = [];
  const search = searchKey ? `&searchKey=${encodeURIComponent(searchKey)}` : "";
  for (let page = 1; page <= maxPages; page += 1) {
    const result = (await call(
      session,
      `/openapi/v1/${session.omadacId}/sites/${session.siteId}/hotspot/authed-records?page=${page}&pageSize=${pageSize}${search}`,
    )) as Record<string, unknown> | null;
    const pageRows = (result?.["data"] ?? result) as unknown;
    const batch = Array.isArray(pageRows) ? (pageRows as Array<Record<string, unknown>>) : [];
    rows.push(...batch);
    const total = Number(result?.["totalRows"] ?? rows.length);
    if (batch.length === 0 || batch.length < pageSize || rows.length >= total) {
      return { rows, complete: true };
    }
  }
  return { rows, complete: false };
}


/**
 * Verified generation surface for Omada Controller 6.2.x.
 *
 * This controller family does NOT publish an OpenAPI document, so the endpoints
 * below were verified directly against the live controller, including its own
 * validation messages for every required field and range. Nothing here is
 * speculative: only paths that answered on the real controller are used.
 */
export const VERIFIED_CREATE_PATH =
  "/openapi/v1/{omadacId}/sites/{siteId}/hotspot/voucher-groups";
export const VERIFIED_GROUP_DETAIL_PATH = `${VERIFIED_CREATE_PATH}/{groupId}`;

/** Controller identity + firmware version, from the controller's own /api/info. */
export async function readControllerInfo(
  session: OmadaSession,
): Promise<{ controllerVersion: string | null }> {
  try {
    const res = await fetch(`${session.base}/api/info`, {
      headers: { Authorization: `AccessToken=${session.token}` },
    });
    const body = (await res.json()) as unknown;
    const result = omadaEnvelope(body).result as Record<string, unknown> | null;
    const version = result?.["controllerVer"];
    return { controllerVersion: typeof version === "string" ? version : null };
  } catch {
    return { controllerVersion: null };
  }
}

/**
 * Creates the voucher group on THIS shop's controller. Returns the raw result.
 *
 * This is the single outbound door for every generation path (manual, saved
 * calibration, automatic replenishment, retries), so the Omada 1~32 character
 * rule for `name` is enforced here — no caller can bypass it. Nothing else in
 * the payload is touched.
 */
export async function createVoucherGroupVerified(
  session: OmadaSession,
  payload: Record<string, unknown>,
): Promise<{ result: unknown; groupId: string | null; name: string }> {
  const name = normalizeVoucherGroupName(payload["name"]);
  const safePayload = { ...payload, name };
  const result = await call(session, resolvePath(session, VERIFIED_CREATE_PATH), {
    method: "POST",
    body: JSON.stringify(safePayload),
  });
  return { result: result ?? null, groupId: extractGroupId(result), name };
}

/** The create response shape varies by build; read an id only when one is given. */
export function extractGroupId(result: unknown): string | null {
  if (typeof result === "string" && result.trim()) return result.trim();
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const key of ["id", "groupId", "voucherGroupId"]) {
      const value = r[key];
      if (typeof value === "string" && value) return value;
    }
  }
  return null;
}

/**
 * Fallback when the create response carries no id: find the group the admin
 * just created by its exact name, preferring the newest one created at or after
 * the moment generation started.
 */
export async function findGroupIdByName(
  session: OmadaSession,
  caps: OmadaVoucherCapabilities,
  name: string,
  createdSinceMs: number,
): Promise<string | null> {
  const groups = await listAllVoucherGroups(session, {
    ...caps,
    listPath: caps.listPath ?? VOUCHER_GROUPS_FALLBACK,
  });
  const wanted = name.trim().toLowerCase();
  const matches = groups
    .filter((g) => String(g["name"] ?? "").trim().toLowerCase() === wanted)
    .filter((g) => Number(g["createdTime"] ?? 0) >= createdSinceMs - 120_000)
    .sort((a, b) => Number(b["createdTime"] ?? 0) - Number(a["createdTime"] ?? 0));
  const hit = matches[0];
  return hit ? (String(hit["id"] ?? "") || null) : null;
}

const VOUCHER_GROUPS_FALLBACK = OFFICIAL_VOUCHER_GROUPS;

/**
 * Reads back the generated group and extracts ONLY the voucher codes.
 * Verified: GET .../voucher-groups/{groupId}?page&pageSize returns the group
 * plus result.data[] rows carrying `code`. Pagination params are mandatory.
 */
export async function fetchGroupCodes(
  session: OmadaSession,
  groupId: string,
): Promise<{ codes: string[]; groupName: string | null; total: number }> {
  const pageSize = 100;
  const codes: string[] = [];
  let groupName: string | null = null;
  let total = 0;
  for (let page = 1; page <= 100; page += 1) {
    const result = (await call(
      session,
      `${resolvePath(session, VERIFIED_GROUP_DETAIL_PATH, { groupId })}?page=${page}&pageSize=${pageSize}`,
    )) as Record<string, unknown> | null;
    if (!result) break;
    if (groupName === null && typeof result["name"] === "string") groupName = result["name"];
    total = Number(result["totalCount"] ?? result["totalRows"] ?? total);
    const rows = Array.isArray(result["data"]) ? (result["data"] as Array<Record<string, unknown>>) : [];
    for (const row of rows) {
      const code = row["code"];
      if (typeof code === "string" && code.trim()) codes.push(code.trim());
    }
    if (rows.length < pageSize) break;
  }
  return { codes, groupName, total: total || codes.length };
}

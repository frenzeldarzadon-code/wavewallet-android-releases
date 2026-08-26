# Omada voucher generation — verification results and implementation plan

## 1. What was verified on the live controller (Sagada Wave, 6.2.14.11)

Probes were run server-side with the shop's own stored credentials. **No voucher group was created** — every write probe deliberately carried one invalid field so the controller rejected it at validation.

Verified facts:

- The controller does **not** publish an OpenAPI document (`/openapi/v3|v2/api-docs` → 404). Schema-by-document discovery cannot work here; the schema had to be verified against the live endpoint itself.
- Create endpoint exists: `POST /openapi/v1/{omadacId}/sites/{siteId}/hotspot/voucher-groups` (OPTIONS → `POST,GET,HEAD,OPTIONS`).
- The controller enumerates its own **required** fields (from an empty-body probe):
  `name, amount, codeLength, codeForm, limitType, duration, durationType, timingType, rateLimit, applyToAllPortals, trafficLimitEnable`
- Verified ranges/allowed values (from the controller's own validation messages):

| Field | Rule (controller-stated) |
|---|---|
| `amount` | 1 – 5000 |
| `codeLength` | 6 – 10 |
| `limitType` | 0, 1 or 2 (`limitNum` used with 1/2) |
| `durationType` | 0 or 1 |
| `timingType` | 0 or 1 |
| `duration` | 1 – 14400000 |
| `rateLimit` | object; `mode` 0 = custom (`customRateLimit`), 1 = profile (`rateLimitProfileId`); mode 2 → "Invalid Number" |
| `codeForm` | array (e.g. `[0]` digits) |
| `trafficLimitEnable` | boolean; `trafficLimit` / `trafficLimitFrequency` when enabled |
| optional, observed on real groups | `unitPrice`, `currency`, `description`, `validityType`, `logout`, `portalNames`, `voucherPattern`, `effectiveTime`/`expirationTime` |

- Group read-back is confirmed: `GET .../hotspot/voucher-groups/{id}?page=1&pageSize=N` returns the group plus a paginated `result.data[]` of voucher rows with the real **`code`**, `id`, `status` (0 unused / 1 in-use / 2 expired), traffic and time fields. There is **no** `/vouchers` child route (404) — pagination params are required (no params → HTTP 400).
- `rate-limit-profiles` and `portals` list endpoints are **not** exposed (404), so a profile id can only be reused from an existing group, not picked from a live list.

## 2. The one thing that cannot be verified without a real write

The **response body shape of a successful create** (whether it returns the new `groupId`) is unknowable without actually generating a real voucher group on the production controller. Implementation handles both cases: use the returned id when present, otherwise re-read the group list and match the just-created group by name + `createdTime`. A one-off 1-code test batch (deletable) is the way to confirm it for real.

## 3. Implementation plan (only after your go-ahead)

**Data (all shop-scoped, RLS + GRANTs):**
- `omada_voucher_calibrations` — versioned: `(ecosystem_id, product_id, version)`, `payload jsonb`, `controller_identity` (base URL, omadacId, siteId, controller version), `is_current`, actor, timestamps. Never silently overwritten; a new version is only written when the Admin explicitly saves after a successful generation.
- Extend `omada_voucher_batches` with `product_id`, `calibration_id`, `group_id`, `group_name`, `requested_amount`, `imported_count`, `controller_identity`, actor. `voucher_codes.import_id` keeps the code→import→batch chain, giving the full Shop → Product → Calibration version → Omada group → code lineage.

**Server functions (`assertShopAdmin` on every call, ecosystem id from the caller's shop, never the client's claim):**
1. `getVoucherGenerationSetup({ecosystemId, productId})` — live-verified field template, product-derived prefills, current calibration + controller-mismatch warning.
2. `generateVoucherGroup(...)` — validates required fields/ranges locally against the verified rules, then POSTs; on failure nothing is imported and the controller's message is surfaced.
3. `fetchGeneratedGroupCodes({ecosystemId, groupId})` — re-reads the group and extracts **only** `code` values.
4. `importGeneratedCodes(...)` — duplicate check within the extraction and against that shop's `voucher_codes`, then insert only confirmed codes; writes `voucher_imports` + batch audit.

**UI (Admin → Omada → Generate, admin-only):**
Product picker → prefilled calibration + full verified field template (required/optional/product-derived/calibrated clearly marked) → group name defaulting to `<Product> <YYYY-MM-DD>` with a numeric suffix when a same-day duplicate exists → review screen → generate → editable code preview with counts (extracted / new / duplicate / to import) → explicit final import confirm → optional "save these settings as the calibration".

**Untouched:** Status Checker, tracer behaviour, multi-device handling, existing inventory import paths.

## 4. Decision needed

Do you want me to (a) implement the above now and confirm the create-response shape with a single deletable 1-code test group on the live controller, or (b) implement it without any live write and confirm the response shape on your first real generation?

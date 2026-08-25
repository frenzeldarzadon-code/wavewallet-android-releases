# Optional Omada integration — architecture plan (Phase 0/1)

This is an investigation + proof-of-concept plan. No production code, schema, UI or voucher-import behaviour changes are proposed for approval in this step beyond the isolated Phase 1 items listed at the end.

Note: a standing project rule currently says "No Omada API / auto voucher generation". This plan supersedes it only if you approve; otherwise the rule stays.

## 1. Where the integration attaches

The existing model does not need to change:

- `voucher_products` — untouched (name, description, credit/points price, promo, active, archived).
- `voucher_codes` — remains the single source of truth. Unique per `(ecosystem_id, upper(code))`, so duplicate protection already exists at the database level.
- `voucher_imports` — every batch already records `source` ('paste' today). Omada generation becomes just another `source` value ('omada'), so batch history, deletion rules and Code Inventory UI keep working unchanged.
- `import_voucher_codes(_product_id, _codes[], _source)` — the existing security-definer RPC already does authorization, duplicate/invalid counting, batch creation and audit logging. Omada import must call this exact function rather than inserting codes directly. That guarantees no second inventory and identical rules to manual import.

So the integration is a thin **provider adapter** that produces `text[]` codes and hands them to the existing import RPC. Manual paste/file import is unaffected.

New, additive-only storage (Phase 2, not Phase 1):
- `omada_connections` — one row per ecosystem: controller base URL, omadac id, site id/name, connection status, last verified at. No secrets in this table.
- `omada_product_links` — links one `voucher_product` to one Omada voucher configuration (duration, timing mode, usage limit, rate/traffic limit, code length/format). This is the "Voucher Calibration" record.
- Both RLS-scoped by `ecosystem_id` with the project's standard `is_ecosystem_admin`/`is_super_admin` policies plus explicit GRANTs.

## 2. Credential storage

- Client Secret never reaches the browser and never lives in source.
- Phase 1 (single tenant, your controller): store `OMADA_CLIENT_ID`, `OMADA_CLIENT_SECRET`, `OMADA_BASE_URL`, `OMADA_OMADAC_ID`, `OMADA_SITE_ID` in Project Settings → Secrets. Read them only inside a `createServerFn` handler (`process.env[...]`), never at module scope.
- Phase 2 (multi-tenant): reuse the pattern this project already uses for app-user connector keys — AES-256-GCM ciphertext in a server-only table readable by `service_role` only, with the encryption key from a platform secret. Per-ecosystem rows, decrypted only inside a server function after the caller's admin role for that ecosystem is verified.
- No secret is ever returned to the client; the UI only ever sees connection status and site name.

## 3. Does the stack support the calls?

Yes. Server functions run in a Cloudflare-Workers-style runtime with `fetch`, `crypto` and `Buffer`. Outbound HTTPS to `https://portal.sagadawave.com:8043` is fine. Two caveats to verify in the very first probe:

- Non-standard port 8043 — allowed, but must be confirmed from the server runtime, not just from a browser.
- Omada controllers commonly serve a **self-signed certificate**. Workers `fetch` cannot disable TLS verification. If the certificate is not publicly trusted, the integration is blocked until the controller is fronted by a trusted certificate (e.g. a proper cert on `portal.sagadawave.com`). This is the single biggest technical risk and Phase 1 exists mainly to answer it.

## 4. Omada Open API operations required

Stated with explicit confidence levels; nothing below is presented as verified for your exact build.

| Need | Expected operation | Confidence |
|---|---|---|
| Auth (Client mode) | `POST /openapi/authorize/token?grant_type=client_credentials` with client id/secret → access token, then `Authorization: AccessToken=<token>` on subsequent calls | High |
| Token refresh | `POST /openapi/authorize/token` re-issue, or refresh-token grant | Medium |
| List sites | `GET /openapi/v1/{omadacId}/sites` | High |
| List voucher groups | `GET /openapi/v1/{omadacId}/sites/{siteId}/hotspot/vouchers` (paged) | Medium |
| Create voucher group | `POST` to the same collection with duration/limit/code-length payload | Medium |
| Retrieve generated codes | A per-group detail/list endpoint returning individual voucher codes | Medium — this is the one that most often differs by version |
| Voucher status / left time / remaining traffic | Same detail endpoint's per-voucher fields (`status`, `expirationTime`, `trafficLimit`/used) | Medium |
| `omadacId` discovery | `GET /api/info` on the controller root | High |

Uncertainty is real and version-specific. Standard Controller 6.2 exposes its own OpenAPI documentation on the controller itself (typically reachable from the controller UI under Global View → Platform Integration → Open API, "API Docs"). **The authoritative endpoint list must be read from your controller's own API Docs page before any code is written.** Phase 1 includes that as a deliverable.

## 5. Least privilege

- Testing with Role = Admin is fine.
- Production target: an Open API application in **Client mode**, site-scoped to `Sagada Wave V2`, with the lowest role that still permits Hotspot → Voucher read and create. On Standard Controller this is usually a custom site role granting only Hotspot Manager / Voucher permissions; "Viewer" is enough for the read-only Phase 1 but not for generation.
- Recommendation: create a second Open API application for read-only Phase 1 with Viewer role, and keep the Admin one out of production.

## 6. Phase 1 — read-only proof of concept

Deliberately tiny, no schema, no UI, no writes to Omada or to WaveWallet inventory.

1. One server function file (e.g. `src/lib/omada.functions.ts` + `omada.server.ts`) exposing a single super-admin-gated `omadaProbe()`.
2. It performs, in order, and returns a structured diagnostic report:
   - TLS/connectivity check against the base URL (`GET /api/info`) → controller version + `omadacId`.
   - Token request with client credentials → success/failure only, token never returned.
   - `GET sites` → confirm `Sagada Wave V2` is visible and capture its site id.
   - List voucher groups for that site → count + field shape of the response.
   - Read one voucher group's codes/status → confirm which of code/status/left-time/remaining-traffic actually come back.
3. Output rendered on an existing Super Admin diagnostics surface (or returned as JSON via the invoke tool) — no new user-facing route needed.
4. Guards even in Phase 1: super-admin-only, 10 s timeout per call, no secret echoed, response bodies truncated in logs, no persistence.

Exit criteria: we know whether TLS works, which endpoints exist on 6.2.0.17, and exactly which status fields are available.

## 7. Later phases (not for approval now)

- **Phase 2 — Calibration**: `omada_connections` + `omada_product_links` tables, Admin → Omada connection screen, per-product calibration form, connection test button.
- **Phase 3 — Generation/import**: admin picks an existing product + quantity → server function creates the Omada voucher group, polls for codes, validates them (length/charset), then calls the existing `import_voucher_codes(..., 'omada')`. Idempotency key per generation request so a retry can never double-import; the DB unique index is the final backstop.
- **Phase 4 — Status checker**: read-only lookup by code; shows Unused/In-use/Expired plus left time / remaining traffic when present. No device, MAC, IP or AP data.

## 8. Security risks and safeguards

| Risk | Safeguard |
|---|---|
| Client Secret exposure | Secrets store only; read inside handlers; never returned, logged or rendered |
| Cross-tenant credential use | Every server function resolves the ecosystem from the caller's verified admin membership, never from a client-supplied id |
| Duplicate inventory | Import always goes through `import_voucher_codes`; `voucher_codes_unique_per_ecosystem` is the hard backstop; generation requests carry an idempotency key |
| Second source of truth | No Omada-specific code table; Omada is only a `source` label on `voucher_imports` |
| Runaway generation | Server-side quantity cap (mirror the existing 500 ceiling), per-ecosystem rate limit on generate calls, confirmation dialog reusing the current import confirm pattern |
| Untrusted TLS | Fail closed; no verification bypass is possible or permitted |
| Auditability | Every connect, calibrate, generate and status lookup writes an `audit_logs` row with ecosystem, actor and counts |
| Omada outage | All Omada paths are optional; failure surfaces a clear message and manual import remains fully available |

## 9. Effort estimate

- Phase 1 (read-only probe + endpoint discovery report): small — roughly a few hours of work, one focused session.
- Phase 2 (connection + calibration schema and UI): medium.
- Phase 3 (generation + import): medium, dominated by response-shape handling and idempotency tests.
- Phase 4 (status checker): small once Phase 1 has confirmed the status fields.

## 10. What I need from you before the first live test

1. Add these in **Project Settings → Secrets** (do not paste values in chat):
   - `OMADA_CLIENT_ID`
   - `OMADA_CLIENT_SECRET`
   - `OMADA_BASE_URL` = `https://portal.sagadawave.com:8043`
   - optionally `OMADA_OMADAC_ID` and `OMADA_SITE_ID` if you already have them
2. Confirm whether the controller's certificate is publicly trusted or self-signed.
3. From the controller's Open API Docs page, tell me the generation label shown (e.g. "Open API v1") and whether Hotspot/Voucher endpoints are listed.
4. Confirm you accept that this supersedes the existing "no Omada API" project rule.
5. Confirm whether Phase 1 may use the existing Admin-role "WaveWallet Test" application, or whether you prefer a new Viewer-role application first.

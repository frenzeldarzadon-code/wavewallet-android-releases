# WaveWallet Captive Portal for Omada

A public, mobile-first captive portal that an Omada External Portal redirects to. It keeps manual voucher entry exactly as it is today, and adds an optional WaveWallet path: sign in, see real coins/points, buy a voucher from that shop's existing Voucher Shop, and get the current device authorized on the controller for the real product duration.

## What already exists and will be reused (no parallel systems)

- Omada controller connection per shop: `omada_connections` + `openOmadaSession()` / `omadaSiteCall()` (encrypted secrets, token cache, silent re-auth). Site discovery already happens there.
- Voucher Shop: `voucher_products` (+ `voucher_codes`, `voucher_sales`) and the `purchase_voucher` RPC, wrapped by `purchaseVoucher()` in `src/lib/wallet.ts`. Also `purchase_voucher_with_points`. These stay the single purchase path — commissions, cashback, points, ledger and sale records all come free.
- Product duration: taken from the shop's existing current voucher calibration (`omada_voucher_calibrations.payload.duration` + `durationType`, in minutes). No new duration field, no hard-coded hours.
- Auth: existing username/password login (`username-login.*`) and existing signup/join-shop path. No second auth system.
- Voucher status, cash in, rewards: existing functions only, surfaced behind portal feature flags.

## New database (one migration)

`omada_portal_mappings`
- `ecosystem_id` (shop), `omada_connection_ecosystem_id` (reuse of the existing connection — no duplicated credentials)
- `site_id`, `site_name`, `portal_id`, `portal_name`, `ssid_info`
- `enabled`, `settings` (jsonb: allow_purchase, show_coins, show_points, allow_cash_in, allow_rewards, show_voucher_status, show_history, remember_customer)
- `last_test_status`, `last_test_at`, `last_test_detail`, `created_at`, `updated_at`
- unique on `(ecosystem_id, site_id, portal_id)`; multiple portals per shop allowed, each independently enabled/edited/removed
- GRANTs + RLS: shop admins read/write only their own shop's rows; super admin all; no anon access. The public portal reads mappings through a server function with the service client only, never from the browser.

`portal_sessions` (short-lived, server-issued)
- `id`, `mapping_id`, `ecosystem_id`, `client_mac`, `client_ip`, `ap_mac`, `ssid`, `radio_id`, `redirect_url`, `expires_at`, `member_id` (nullable, set after login), `created_at`
- no anon grants; only reachable through server functions. This is the anti-tampering mechanism: the browser holds an opaque session id, and the shop is always resolved server-side from `mapping_id`.

`portal_authorizations` (audit + retry safety)
- `session_id`, `sale_id`, `voucher_code`, `duration_minutes`, `status` (`authorized` / `failed` / `retried`), `error`, `authorized_at`
- lets an authorization failure be retried without re-charging, and separates "purchase succeeded" from "authorization succeeded".

## Server layer

- `src/lib/omada-portals.server.ts` — capability-aware adapter: version detection from the existing `/api/info` probe, portal discovery for a site (`.../setting/portals` family, with graceful "capability not supported" reporting), and client authorization via the External Portal authorize endpoint using the real `clientMac`/`apMac`/`ssid`/`radioId` and a real expiry in seconds. No fake success — an unsupported controller yields an explicit admin error.
- `src/lib/omada-portals.functions.ts` — admin server fns (all `requireSupabaseAuth` + existing `assertShopAdmin`): `listOmadaSites`, `listOmadaPortals(siteId)`, `savePortalMapping`, `listPortalMappings`, `setPortalMappingEnabled`, `deletePortalMapping`, `testPortalMapping` (controller reachable → auth → version/capability → site exists → portal exists in that site → mapping belongs to caller's shop → public portal URL reachable).
- `src/lib/portal-session.functions.ts` — public (unauthenticated) server fns for the captive portal: `startPortalSession` (validates the Omada query parameters against a saved, enabled mapping and mints a session), `getPortalState` (shop branding, feature flags, and — when signed in — real name/coins/points/products), `portalLogin` (delegates to the existing username login), `portalPurchase` (idempotency key; verifies membership + product ownership + active + stock, then calls the existing `purchase_voucher` RPC as the member, then authorizes the client), `retryPortalAuthorization`.
- Rate limiting on login and purchase per session/IP; security-relevant portal events logged to the existing audit table.

## Routes / UI

- Public: `src/routes/portal.tsx` — mobile-first captive portal. Manual voucher entry card first and always present (posts straight to the Omada portal's own submit URL, unchanged behavior, no account needed), then the WaveWallet section: remembered session greeting with real name/coins/points, or Log in / Sign up (signup pre-bound to the resolved shop), then real Voucher Shop product cards, confirmation sheet (product, price, balance, balance after, voucher shop name), and the success state with real code/times/remaining balance plus Continue to Internet. Failure-after-purchase state shows the purchased code and a Retry authorization action.
- Admin: new "Customer Portal" tab inside the existing `admin.omada` tabs — connection status + detected version/capability, site picker (real sites), portal picker (real portals for that site, explicit selection required), feature toggles, save, Test, mappings table with Site / Portal / Portal ID / SSID / status / Voucher Shop / Edit / Enable-Disable / Disconnect / + Connect another portal, plus a live mobile preview driven by the same real data and flags.
- Pre-auth guidance panel showing the actual deployed origin to whitelist.

## Tests

Vitest for the pure logic (mapping resolution, tamper-proof shop resolution, feature-flag gating, duration derivation, idempotency, authorization-failure handling, manual-flow preservation) and pgTAP-style SQL tests under `supabase/tests/` for portal-mapping tenant isolation, cross-shop admin access, and cross-ecosystem purchase blocking — matching the 25 listed acceptance checks.

## Notes / assumptions

- Portal discovery and client authorization endpoints will be probed against the live connected controller before the adapter is finalized; if the connected controller does not expose them, the admin UI reports the exact capability gap rather than silently degrading.
- Product duration comes from the existing per-product Omada calibration. Products without a calibration cannot authorize a device; they will be shown as unavailable in the portal with a clear admin warning.

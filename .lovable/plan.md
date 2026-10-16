# Omada local users in the Omada tab: feasibility and plan

## What exists today (checked in the code)
- **Omada tab:** `src/routes/admin.omada.tsx` has five tabs: connection, devices, generate, status, portal. None of them handles local users.
- **Controller access:** `src/lib/omada-api.server.ts`
  - `openOmadaSession` uses the shop's own Open API app (client-credentials token stored encrypted in `omada_connections`), so every call stays inside that shop's own controller and site.
  - `omadaSiteCall(session, path, init)` (line 247) is the only helper needed for site-level calls.
- **Who may use it:** `assertShopAdmin` in `src/lib/omada-vouchers.functions.ts:46` lets in the platform owner or someone the backend confirms is this shop's admin (`is_ecosystem_admin`). Reuse it as is.
- **Local-user code today:** `src/lib/voucher-monitoring.server.ts:67-120` is read-only.
  - `localUserPath()` only finds the endpoint if the controller's own API description lists `/hotspot/local-users` (or `/hotspot/users`).
  - `findLocalUser()` pages through that list (100 per page, at most 50 pages).
  - Nothing creates or updates local users.
- **Controller version:** a comment at `omada-vouchers.server.ts:487` says the live controller (6.2.x) publishes **no** API description. The voucher endpoints were checked by hand against it. So on that controller `localUserPath()` probably returns nothing and local users are currently treated as unsupported. Not confirmed live.

## Feasibility
- **List and search: likely feasible.** Omada Open API documents hotspot local-user listing per site. The exact address and field names on 6.2.x must be confirmed against the live controller first, as was done for vouchers.
- **Create: likely feasible.** Fields: username, password, expiry, data cap, and speed limits only if the controller exposes them.
- **Add GB without wiping unused data: feasible only if the controller reports both the data cap and the data already used, and lets the cap be changed on its own.** Rule:
  - new cap = current cap + added GB
  - never reset the used-data counter
  - never send a smaller cap
  - if the controller has no "used data" field, or only offers "reset usage", the feature stays off for that controller
- **Extend or reset expiry: feasible** if the controller exposes an expiry field. "Extend" = later of (current expiry, now) + N days. "Set" takes an explicit future date. A past date is refused.
- **Never allowed:** disconnect, unauthorize or block, delete a user, enable/disable, any "reset usage", or any portal or SSID change. These requests are never built.

## Uncertainties and requirements
- **Exact endpoints and fields on the live controller are unknown**, and the controller publishes no API description. Step 1 is a read-only probe of candidate addresses that records the field names returned. No writes until they are confirmed.
- **Open API permission:** the shop's Omada Open API app must have hotspot/local-user permission (in the controller's Open API settings). If the controller refuses access, the UI says so; it never retries with other credentials.
- **Units:** how the controller measures data (bytes, MB or GB) and expiry (seconds, milliseconds or a date string) must be read from the probe. A wrong unit could shrink someone's quota, so the code refuses to save if it can't recognise the units.
- **Passwords:** the list may return passwords. They are never sent to the browser or stored; they are only shown at create time.
- **Simultaneous edits:** re-read the user right before each update and use the fresh cap, so another change made in the controller isn't overwritten.

## Implementation plan
1. **Read-only probe (server only).** New `src/lib/omada-local-users.server.ts`:
   - `probeLocalUsers(session)` tries the documented local-user list address(es) via `omadaSiteCall`.
   - It returns the working path plus a field map (name, cap, used, expiry, speed).
   - It reuses `localUserPath()` when an API description exists.
2. **Server functions**, all behind `requireSupabaseAuth` and `assertShopAdmin`, scoped to the session's own site. New `src/lib/omada-local-users.functions.ts`:
   - `listOmadaLocalUsers({ ecosystemId, search, page })`: paged, without passwords.
   - `createOmadaLocalUser({ ecosystemId, username, password, quotaGb?, expiresAt?, speed? })`: refuses if the username already exists.
   - `addOmadaLocalUserQuota({ ecosystemId, userId, addGb })`: re-reads the user, sends only the cap field (current + added), never the used counter, and refuses if the new cap would not be larger.
   - `updateOmadaLocalUserExpiry({ ecosystemId, userId, mode: "extend"|"set", days?|date? })`: sends only the expiry field.
   - Each change writes an `audit_logs` row: shop, actor, user, field, before and after values, no password.
3. **UI.** New `src/components/omada/local-users-panel.tsx` and a sixth tab "Local users" in `admin.omada.tsx` (add `local-users` to the allowed `tab` values). It contains:
   - search box and paged list: username, data used / cap / remaining, expiry, speed
   - "Add user" form
   - per-user "Add GB" and "Extend expiry" dialogs showing a before/after preview
   - when the probe says unsupported or permission is missing: a plain notice, with no controls
4. **Tests** (`src/lib/omada-local-users.test.ts`):
   - adding GB never lowers the cap and never sends a used/reset field
   - extend starts from the later of expiry and now
   - the outgoing request contains only allowed fields
   - none of the forbidden actions (disconnect, unauthorize, delete, disable, reset) can be built
   - non-admins are refused

## Safety checks
- Requests are built from an allow-list of fields: username, password (create only), cap, expiry, speed. Any other key is dropped before sending.
- No code path calls client, authorize, disconnect, block, delete or reset endpoints; a test enforces this.
- Every change re-reads the user first, and changes nothing if the user can't be read or the units can't be recognised.
- Shop admin only, own shop's controller and site only, all on the server; tokens and passwords never reach the browser.
- Omada stays in charge of logins and access; One Wave only edits the user record.
- Nothing about vouchers, portals, wallets or accounting changes.

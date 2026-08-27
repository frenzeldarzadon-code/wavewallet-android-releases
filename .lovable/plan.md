# Investigation Report: Omada Device Status / Antenna System — Current State

Read-only investigation. No code changed, nothing published, no live device actions taken.

## Item-by-item status

### 1. Admin > Omada "Device Status" tab — IMPLEMENTED (as "Antennas")
- File: `src/routes/admin.omada.tsx`
- Tabs: **Connection | Antennas | Generate | Status** (grid-cols-4). The device tab uses the agreed "Antenna" UI terminology and mounts `<AntennaStatusPanel ecosystemId manage />`.

### 2. Backend/API for retrieving Omada site devices — IMPLEMENTED
- `src/lib/omada-devices.server.ts` — `listSiteDevices(session)`: paginated `GET /openapi/v1/{omadacId}/sites/{siteId}/devices?page=&pageSize=100`, parses mac, name, type, model/modelName, ip, publicIp, sn, status, detailStatus, uptime, lastSeen, cpuUtil, memUtil, firmwareVersion.
- `src/lib/omada-devices.functions.ts` — server functions `listShopAntennas` (admin) and `listMyAntennas` (member), merging live controller data with DB assignments and preserving assignments for devices the controller no longer lists.
- `src/lib/omada-devices.ts` — shared types, `normaliseMac`, `describeDeviceStatus` (status/detailStatus → Connected/Disconnected/Pending/Warning/unknown mapping).
- `src/lib/omada-devices.test.ts` — status mapping tests.

### 3. Reboot endpoint/action — IMPLEMENTED and wired to UI
- `src/lib/omada-devices.server.ts` — `rebootSiteDevice(session, mac)`: `POST /openapi/v1/{omadacId}/sites/{siteId}/devices/{mac}/reboot` (verified live with a fake-MAC probe: endpoint exists, returns errorCode -39006 for unknown devices; no real device rebooted).
- `src/lib/omada-devices.functions.ts` — `rebootAntenna` server fn: admin may reboot any shop device; a member may reboot only devices assigned to them; writes to `audit_logs`.
- UI: `src/components/omada/antenna-status-panel.tsx` — reboot button with confirmation dialog, progress state, refresh.

### 4. Antenna assignment table/schema — IMPLEMENTED and deployed
- Migration: `supabase/migrations/20260827023314_002c615c-e36d-4aa4-b4c2-74769250f734.sql`
- Table `public.omada_device_assignments`: id, ecosystem_id (FK→ecosystems, cascade), device_mac, device_id, device_name, device_type, assigned_user_id, assigned_by, active, last_seen_at, created_at, updated_at.
- RLS enabled; grants to authenticated + service_role; policies: members read own assignment, shop admins/super admin read + manage their shop's assignments; partial unique index on (ecosystem_id, upper(device_mac)) WHERE active; updated_at trigger via `public.set_updated_at()`.
- Verified present in the live database (information_schema query) and in generated `src/integrations/supabase/types.ts`.
- Server functions: `listAntennaAssignees`, `assignAntenna` (reassign-safe, audits), `unassignAntenna` (keeps history, drops active flag). UI wired via `AntennaStatusPanel` (assign/reassign/unassign controls in admin mode).

### 5. Status Check page with tabs — IMPLEMENTED
- `src/routes/app.omada.tsx` (customer/member) and `src/routes/reseller.omada.tsx`: exactly **Antenna Status | Voucher Status** tabs. Antenna tab shows only the member's assigned devices; Voucher Status/tracer behavior retained.
- Navigation (`src/lib/navigation.ts`): customer + reseller see "Status Check" (/app/omada, /reseller/omada); admin sees "Omada management" (/admin/omada).

### 6. Role/permission logic for assignment vs reboot — IMPLEMENTED
- `omada-devices.functions.ts`: `isShopAdmin` (super admin OR `is_ecosystem_admin`), `assertShopAdmin`, `assertShopMember` (`has_membership`), server-side re-checks on every call. Members can reboot only their own assigned devices; assignment/unassignment is admin-only. Controller address/credentials never reach the browser.

### 7. Did the previous mission produce committed code? — YES, committed
- `git log`: latest commit `648b452 "Added Omada device status panel"`; working tree is clean (no uncommitted changes).

### 8. Published vs preview — Published (with a caveat to verify visually)
- Previous mission ended with a successful publish; `https://wallet.sagadawave.com/admin/omada` returns HTTP 200. SPA content can't be fully verified by curl; a quick browser check of the Antennas tab on the live domain is the only remaining visual confirmation.

## Verified live-controller facts (from the mission's read-only probes)
- Inventory: `GET .../sites/{siteId}/devices?page=&pageSize=` — 49 managed devices on Sagada Wave Controller 6.2.14.11.
- Reboot: `POST .../sites/{siteId}/devices/{mac}/reboot` — exists; unknown device returns errorCode -39006. No real device rebooted.
- detailStatus observed: 0 = Disconnected, 14 = Connected, 15 = Connected (wireless).
- Unpaged `/devices`, `/aps`, `/devices/{mac}` returned 400/404 — not used.

## What remains before a new implementation instruction
Nothing for the core feature — it is committed, tested (966 tests passed at the time), and published. Possible optional follow-ups only:
- Visually confirm the live published Antennas tab renders (publish was reported successful; HTTP 200 confirmed).
- If any refinement is desired (e.g. additional status mappings, column layout, member-facing fields), specify it as a follow-up instruction rather than re-requesting the base feature.

# Hotspot Authorized Clients correction

## Verified controller evidence
- Use the documented Omada Open API operation `GetHotspotAuthedClients`: `GET /openapi/v1/{omadacId}/sites/{siteId}/hotspot/authed-records` with required `page` and `pageSize`, optional `searchKey`, and existing `AccessToken` authentication.
- A read-only live probe on Sagada Wave Controller 6.2.14.11 returned voucher `9139618` with device `OPPO-Reno3`, MAC/IP, voucher code, authorization ID, start/end, validity, traffic, and duration.
- The same endpoint returned expired voucher `5639838` with device `TECNO-SPARK-Go-3` and its historical authorization record.

## Implementation
1. Add a tenant/site-scoped paginated `listHotspotAuthedClients()` adapter that returns explicit complete/partial/failure state and maps the verified `voucherCode` association without depending on generic `/clients`.
2. Update voucher lookup to preserve voucher-group status, source authorized devices from `/hotspot/authed-records`, persist every observed authorization with its real controller record ID and site ID, and retain prior history on empty/failure responses.
3. Extend usage-session persistence safely for controller authorization IDs and observed end/valid metadata without deleting the existing 31 records.
4. Add the verified `sale_id → voucher_sales.buyer_id` fallback while retaining shop scoping and truthful “not linked” UI for controller-only vouchers.
5. Update the existing status panel sections and empty/error wording; keep manual Tracer labels separate from device history and keep mobile-safe layouts.
6. Add regression tests for the two captured controller records, multiple devices, expired history, unused vouchers, endpoint failure/partial results, generic-client independence, authorized-user fallback, and tenant scoping.
7. Run focused and full tests plus typecheck/build checks, inspect the diff, then publish only if clean.

## Scope safeguards
- No voucher generation, inventory semantics, Status Checker access, tracer conflict rules, Omada credentials, or tenant authorization rules will be changed.
- No historical records will be fabricated or removed.

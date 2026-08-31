/**
 * Server-side Omada reads for Live Voucher Monitoring.
 *
 * One controller session, one pass over the shop's voucher groups, however many
 * codes the customer monitors — several monitored vouchers from the same site
 * never cost more than one sweep. Controller credentials and tokens stay here;
 * only translated display values ever reach the browser.
 */
import type { OmadaSession } from "./omada-api.server";
import { omadaSiteCall } from "./omada-api.server";

export interface VoucherHit {
  row: Record<string, unknown>;
  group: Record<string, unknown> | null;
}

/**
 * Every requested code the controller knows, in a single sweep of this site's
 * voucher groups. Codes the controller does not have are simply absent.
 */
export async function fetchVoucherRows(
  session: OmadaSession,
  codes: string[],
): Promise<Map<string, VoucherHit>> {
  const { loadOmadaSpec, voucherCapabilities, listAllVoucherGroups, listVouchersInGroup } =
    await import("./omada-vouchers.server");
  const caps = voucherCapabilities(await loadOmadaSpec(session));
  const wanted = new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean));
  const found = new Map<string, VoucherHit>();
  if (wanted.size === 0) return found;

  const groups = await listAllVoucherGroups(session, caps);
  const pageSize = 100;
  for (const group of groups) {
    if (wanted.size === 0) break;
    const groupId = String(group["id"] ?? group["groupId"] ?? "");
    if (!groupId) continue;
    for (let page = 1; ; page += 1) {
      const { rows, total } = await listVouchersInGroup(session, caps, groupId, page, pageSize);
      for (const row of rows) {
        const code = String(row["code"] ?? "").trim().toUpperCase();
        if (!wanted.has(code)) continue;
        found.set(code, { row, group });
        wanted.delete(code);
      }
      if (
        wanted.size === 0 ||
        rows.length === 0 ||
        rows.length < pageSize ||
        page * pageSize >= total
      )
        break;
    }
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Local user monitoring                                               */
/* ------------------------------------------------------------------ */

/**
 * Whether this controller publishes a hotspot local-user endpoint at all.
 * Derived from the controller's own OpenAPI document — when it is absent the
 * caller hides the Local User section instead of offering a dead control.
 */
export function localUserPath(spec: Record<string, unknown> | null): string | null {
  const paths = (spec?.["paths"] as Record<string, Record<string, unknown>> | undefined) ?? {};
  for (const [path, ops] of Object.entries(paths)) {
    if (!/\/hotspot\/(local-users|users)$/.test(path)) continue;
    if (ops["get"]) return path;
  }
  return null;
}

export async function localUserSupported(session: OmadaSession): Promise<boolean> {
  const { loadOmadaSpec } = await import("./omada-vouchers.server");
  return localUserPath(await loadOmadaSpec(session)) !== null;
}

/**
 * Verifies a local-user credential against the controller's own local-user
 * records and returns that record. The password is only compared here, on the
 * server, and is never persisted anywhere.
 */
export async function findLocalUser(
  session: OmadaSession,
  username: string,
  password: string,
): Promise<Record<string, unknown> | null> {
  const { loadOmadaSpec } = await import("./omada-vouchers.server");
  const template = localUserPath(await loadOmadaSpec(session));
  if (!template) return null;
  const suffix = template.replace(/^.*\/sites\/\{siteId\}/, "");
  const wanted = username.trim().toLowerCase();
  const pageSize = 100;
  for (let page = 1; page <= 50; page += 1) {
    const result = (await omadaSiteCall<Record<string, unknown>>(
      session,
      `${suffix}?page=${page}&pageSize=${pageSize}`,
    )) as Record<string, unknown> | null;
    const raw = (result?.["data"] ?? result) as unknown;
    const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
    for (const row of rows) {
      const name = String(row["name"] ?? row["userName"] ?? row["username"] ?? "")
        .trim()
        .toLowerCase();
      if (name !== wanted) continue;
      const stored = String(row["password"] ?? "");
      return stored && stored === password ? row : null;
    }
    const total = Number(result?.["totalRows"] ?? rows.length);
    if (rows.length === 0 || rows.length < pageSize || page * pageSize >= total) break;
  }
  return null;
}

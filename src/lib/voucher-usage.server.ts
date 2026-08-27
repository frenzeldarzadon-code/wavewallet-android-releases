/**
 * Server-side persistence for the voucher Usage Tracer.
 *
 * Every authoritative status lookup writes what the controller reported so the
 * history survives voucher expiry, when the controller no longer reports the
 * client at all. Everything is keyed by shop id, so one shop can never read or
 * write another shop's history.
 */
import type { AuthorizedUser, UsageObservation, UsageSessionView } from "./voucher-usage";

type Admin = {
  from: (table: string) => any;
};

interface StoredRow {
  id: string;
  device_mac: string;
  session_key: string;
  authorization_id: string | null;
  device_name: string | null;
  ip_address: string | null;
  ap_identifier: string | null;
  network_name: string | null;
  connected_at: string | null;
  authorized_until: string | null;
  still_valid: boolean | null;
  duration_seconds: number | null;
  first_seen_at: string;
  last_seen_at: string;
  traffic_bytes: number | null;
  voucher_state: string | null;
}

const COLUMNS =
  "id, device_mac, session_key, authorization_id, device_name, ip_address, ap_identifier, network_name, connected_at, authorized_until, still_valid, duration_seconds, first_seen_at, last_seen_at, traffic_bytes, voucher_state";

/**
 * Record/refresh what the controller reported for this voucher right now.
 *
 * Existing rows are refreshed in place, keyed by the controller's own
 * authorization record id, so a device authorized again later is preserved as
 * its own history entry and nothing is ever wiped.
 */
export async function recordUsageSessions(
  admin: Admin,
  ecosystemId: string,
  voucherCode: string,
  observations: UsageObservation[],
  voucherState: string | null,
  siteId: string | null = null,
): Promise<void> {
  if (observations.length === 0) return;
  const code = voucherCode.trim().toUpperCase();
  const now = new Date().toISOString();

  for (const obs of observations) {
    const { data: existing } = await admin
      .from("voucher_usage_sessions")
      .select("id")
      .eq("ecosystem_id", ecosystemId)
      .eq("voucher_code", code)
      .eq("device_mac", obs.deviceMac)
      .eq("session_key", obs.sessionKey)
      .maybeSingle();

    const fields = {
      authorization_id: obs.authorizationId,
      device_name: obs.deviceName,
      ip_address: obs.ipAddress,
      ap_identifier: obs.apIdentifier,
      network_name: obs.networkName,
      connected_at: obs.connectedAt,
      authorized_until: obs.authorizedUntil,
      still_valid: obs.stillValid,
      duration_seconds: obs.durationSeconds,
      traffic_bytes: obs.trafficBytes,
      voucher_state: voucherState,
      site_id: siteId,
      last_seen_at: now,
    };

    if (existing?.id) {
      await admin.from("voucher_usage_sessions").update(fields).eq("id", existing.id);
    } else {
      await admin.from("voucher_usage_sessions").insert({
        ecosystem_id: ecosystemId,
        voucher_code: code,
        device_mac: obs.deviceMac,
        session_key: obs.sessionKey,
        first_seen_at: now,
        ...fields,
      });
    }
  }
}

/** Everything this shop has ever observed for that voucher code. */
export async function loadUsageSessions(
  admin: Admin,
  ecosystemId: string,
  voucherCode: string,
  currentKeys: string[],
): Promise<UsageSessionView[]> {
  const code = voucherCode.trim().toUpperCase();
  const { data } = await admin
    .from("voucher_usage_sessions")
    .select(COLUMNS)
    .eq("ecosystem_id", ecosystemId)
    .eq("voucher_code", code)
    .order("last_seen_at", { ascending: false })
    .limit(200);

  const current = new Set(currentKeys.map((m) => m.toUpperCase()));
  return ((data ?? []) as StoredRow[]).map((row) => ({
    id: row.id,
    deviceMac: row.device_mac,
    authorizationId: row.authorization_id,
    deviceName: row.device_name,
    ipAddress: row.ip_address,
    apIdentifier: row.ap_identifier,
    networkName: row.network_name,
    connectedAt: row.connected_at,
    authorizedUntil: row.authorized_until,
    stillValid: row.still_valid,
    durationSeconds: row.duration_seconds,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    trafficBytes: row.traffic_bytes,
    voucherState: row.voucher_state,
    // "Current" means this exact authorization record is in the live
    // authorized-client answer, matched by record id or device address.
    current:
      current.has(row.device_mac.toUpperCase()) ||
      (row.authorization_id ? current.has(row.authorization_id.toUpperCase()) : false),
  }));
}


/**
 * Who this shop sold/assigned the voucher to. Read from WaveWallet's own sale
 * records, so it stays available long after the voucher expires on Omada.
 *
 * `sold_to` is the primary association; when a code was sold without it being
 * set, the sale row's buyer is used instead. Both stay scoped to this shop, and
 * a controller-only code with no WaveWallet sale returns null rather than a
 * made-up customer.
 */
export async function authorizedUserFor(
  admin: Admin,
  ecosystemId: string,
  voucherCode: string,
): Promise<AuthorizedUser | null> {
  const code = voucherCode.trim().toUpperCase();
  const { data } = await admin
    .from("voucher_codes")
    .select("sold_to, sold_at, sale_id, voucher_products(name)")
    .eq("ecosystem_id", ecosystemId)
    .ilike("code", code)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const productName =
    (Array.isArray(data.voucher_products)
      ? (data.voucher_products[0]?.name as string | undefined)
      : ((data.voucher_products as { name?: string } | null)?.name ?? undefined)) ?? null;

  let holder = (data.sold_to as string | null) ?? null;
  let soldAt = (data.sold_at as string | null) ?? null;

  if (!holder && data.sale_id) {
    const { data: sale } = await admin
      .from("voucher_sales")
      .select("buyer_id, created_at")
      .eq("id", data.sale_id)
      .eq("ecosystem_id", ecosystemId)
      .maybeSingle();
    holder = (sale?.buyer_id as string | null) ?? null;
    soldAt = soldAt ?? ((sale?.created_at as string | null) ?? null);
  }

  let name: string | null = null;
  let phone: string | null = null;
  if (holder) {
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", holder)
      .eq("ecosystem_id", ecosystemId)
      .maybeSingle();
    name = (profile?.full_name as string | null) ?? null;
    phone = (profile?.phone as string | null) ?? null;
  }

  if (!name && !phone && !soldAt && !productName) return null;
  return { name, phone, soldAt, productName };
}


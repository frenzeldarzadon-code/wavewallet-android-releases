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
  device_name: string | null;
  ip_address: string | null;
  ap_identifier: string | null;
  network_name: string | null;
  connected_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  traffic_bytes: number | null;
  voucher_state: string | null;
}

/** Record/refresh what the controller reported for this voucher right now. */
export async function recordUsageSessions(
  admin: Admin,
  ecosystemId: string,
  voucherCode: string,
  observations: UsageObservation[],
  voucherState: string | null,
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
      device_name: obs.deviceName,
      ip_address: obs.ipAddress,
      ap_identifier: obs.apIdentifier,
      network_name: obs.networkName,
      connected_at: obs.connectedAt,
      traffic_bytes: obs.trafficBytes,
      voucher_state: voucherState,
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
  currentMacs: string[],
): Promise<UsageSessionView[]> {
  const code = voucherCode.trim().toUpperCase();
  const { data } = await admin
    .from("voucher_usage_sessions")
    .select(
      "id, device_mac, session_key, device_name, ip_address, ap_identifier, network_name, connected_at, first_seen_at, last_seen_at, traffic_bytes, voucher_state",
    )
    .eq("ecosystem_id", ecosystemId)
    .eq("voucher_code", code)
    .order("last_seen_at", { ascending: false })
    .limit(200);

  const current = new Set(currentMacs.map((m) => m.toUpperCase()));
  return ((data ?? []) as StoredRow[]).map((row) => ({
    id: row.id,
    deviceMac: row.device_mac,
    deviceName: row.device_name,
    ipAddress: row.ip_address,
    apIdentifier: row.ap_identifier,
    networkName: row.network_name,
    connectedAt: row.connected_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    trafficBytes: row.traffic_bytes,
    voucherState: row.voucher_state,
    current: current.has(row.device_mac.toUpperCase()),
  }));
}

/**
 * Who this shop sold/assigned the voucher to. Read from WaveWallet's own sale
 * records, so it stays available long after the voucher expires on Omada.
 */
export async function authorizedUserFor(
  admin: Admin,
  ecosystemId: string,
  voucherCode: string,
): Promise<AuthorizedUser | null> {
  const code = voucherCode.trim().toUpperCase();
  const { data } = await admin
    .from("voucher_codes")
    .select("sold_to, sold_at, voucher_products(name)")
    .eq("ecosystem_id", ecosystemId)
    .ilike("code", code)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const productName =
    (Array.isArray(data.voucher_products)
      ? (data.voucher_products[0]?.name as string | undefined)
      : ((data.voucher_products as { name?: string } | null)?.name ?? undefined)) ?? null;

  let name: string | null = null;
  let phone: string | null = null;
  if (data.sold_to) {
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", data.sold_to)
      .eq("ecosystem_id", ecosystemId)
      .maybeSingle();
    name = (profile?.full_name as string | null) ?? null;
    phone = (profile?.phone as string | null) ?? null;
  }

  if (!name && !phone && !data.sold_at && !productName) return null;
  return { name, phone, soldAt: (data.sold_at as string | null) ?? null, productName };
}

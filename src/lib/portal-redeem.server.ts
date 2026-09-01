/**
 * Connect tickets: the server side of handing a Voucher Shop code back to the
 * controller's own portal page for redemption (see portal-redeem.ts).
 *
 *  - mint:   after a purchase (or manual entry on the wallet page), create a
 *            single-use short-lived ticket bound to one hotspot session and
 *            build the return address to the controller portal page.
 *  - claim:  the controller-served page exchanges the ticket ONCE for the
 *            voucher code, then submits Omada's own form with it.
 *  - report: the page reports the controller's real /portal/auth verdict so
 *            the authorization record reflects what Omada actually decided.
 */
import {
  REDEEM_TTL_MS,
  buildPortalReturnUrl,
  portalPageUrlAllowed,
} from "./portal-redeem";

type AdminClient = { from: (table: string) => any };

/** 32 chars from a 64-symbol alphabet: 192 bits, URL-safe, single use. */
export function randomRedeemToken(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i]! & 63];
  return out;
}

export interface RedemptionMint {
  ok: boolean;
  redeemUrl: string | null;
  reason: string | null;
}

/** Creates the ticket and the address that carries the customer back. */
export async function mintPortalRedemption(
  supabaseAdmin: AdminClient,
  opts: {
    session: Record<string, unknown>;
    ecosystemId: string;
    code: string;
    saleId: string | null;
    authorizationId: string | null;
  },
): Promise<RedemptionMint> {
  const { data: conn } = await supabaseAdmin
    .from("omada_connections")
    .select("base_url")
    .eq("ecosystem_id", opts.ecosystemId)
    .maybeSingle();
  const baseUrl = ((conn as { base_url?: string | null } | null)?.base_url ?? null) || null;
  const reportedPage = (opts.session["page_url"] as string | null) ?? null;
  const pageUrl = portalPageUrlAllowed(reportedPage, baseUrl) ? reportedPage : null;

  const token = randomRedeemToken();
  const redeemUrl = buildPortalReturnUrl({
    pageUrl,
    baseUrl,
    rawQuery: (opts.session["raw_query"] as Record<string, unknown> | null) ?? null,
    session: {
      clientMac: (opts.session["client_mac"] as string | null) ?? null,
      apMac: (opts.session["ap_mac"] as string | null) ?? null,
      ssid: (opts.session["ssid"] as string | null) ?? null,
      radioId:
        opts.session["radio_id"] === null || opts.session["radio_id"] === undefined
          ? null
          : String(opts.session["radio_id"]),
      siteRef: (opts.session["site_ref"] as string | null) ?? null,
      redirectUrl: (opts.session["redirect_url"] as string | null) ?? null,
    },
    token,
  });
  if (!redeemUrl) {
    return {
      ok: false,
      redeemUrl: null,
      reason:
        "This shop's hotspot address is not configured, so the code could not be handed to the hotspot page automatically.",
    };
  }

  const { error } = await supabaseAdmin.from("portal_redemptions").insert({
    token,
    session_id: opts.session["id"],
    ecosystem_id: opts.ecosystemId,
    authorization_id: opts.authorizationId,
    sale_id: opts.saleId,
    voucher_code: opts.code,
    expires_at: new Date(Date.now() + REDEEM_TTL_MS).toISOString(),
  });
  if (error) {
    return { ok: false, redeemUrl: null, reason: "The connect ticket could not be created." };
  }
  return { ok: true, redeemUrl, reason: null };
}

/**
 * Burns the ticket and returns the code — once. A second claim, an expired
 * ticket, or a ticket bound to a different portal mapping all answer nothing.
 */
export async function claimPortalRedemption(
  supabaseAdmin: AdminClient,
  mappingId: string,
  token: string,
): Promise<{ ok: true; code: string } | { ok: false; reason: string }> {
  const { data: ticket } = await supabaseAdmin
    .from("portal_redemptions")
    .select("id, session_id")
    .eq("token", token)
    .maybeSingle();
  if (!ticket) return { ok: false, reason: "This connect ticket is not valid." };

  const { data: session } = await supabaseAdmin
    .from("portal_sessions")
    .select("mapping_id")
    .eq("id", (ticket as { session_id: string }).session_id)
    .maybeSingle();
  if (!session || String((session as { mapping_id: unknown }).mapping_id) !== mappingId) {
    return { ok: false, reason: "This connect ticket belongs to a different hotspot." };
  }

  const now = new Date().toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("portal_redemptions")
    .update({ status: "claimed", claimed_at: now, updated_at: now })
    .eq("id", (ticket as { id: string }).id)
    .eq("status", "issued")
    .gt("expires_at", now)
    .select("voucher_code")
    .maybeSingle();
  if (!claimed) {
    return { ok: false, reason: "This connect ticket was already used or has expired." };
  }
  return { ok: true, code: String((claimed as { voucher_code: unknown }).voucher_code) };
}

/**
 * Records what the controller actually answered to ITS OWN /portal/auth
 * submission. This is bookkeeping, not the source of truth — the customer is
 * online (or not) regardless of whether this report arrives.
 */
export async function reportPortalRedemption(
  supabaseAdmin: AdminClient,
  token: string,
  ok: boolean,
  errorCode: number | null,
): Promise<{ ok: boolean }> {
  const now = new Date().toISOString();
  const failure = `Omada refused the code (errorCode ${errorCode ?? "unknown"}).`;
  const { data: row } = await supabaseAdmin
    .from("portal_redemptions")
    .update({ status: ok ? "succeeded" : "failed", error: ok ? null : failure, updated_at: now })
    .eq("token", token)
    .eq("status", "claimed")
    .select("authorization_id")
    .maybeSingle();
  if (!row) return { ok: false };
  const authorizationId = (row as { authorization_id: string | null }).authorization_id;
  if (authorizationId) {
    await supabaseAdmin
      .from("portal_authorizations")
      .update({
        status: ok ? "authorized" : "failed",
        error: ok ? null : failure,
        authorized_at: ok ? now : null,
      })
      .eq("id", authorizationId);
  }
  return { ok: true };
}

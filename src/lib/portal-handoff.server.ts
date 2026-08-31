/**
 * Issuing and redeeming the captive-portal hand-off token.
 *
 * Everything that decides WHICH shop a hand-off belongs to happens here, from
 * the saved portal mapping. The browser only ever carries an opaque signed
 * string; no Omada credential, controller URL or token is ever part of it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  HANDOFF_EXPIRED,
  HANDOFF_TTL_MS,
  MAX_HANDOFF_USES,
  handoffClaimsValid,
  handoffEntryUrl,
  type HandoffClaims,
  type HandoffResolution,
} from "./portal-handoff";

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signHandoff(claims: HandoffClaims, secret: string): string {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyHandoff(token: string, secret: string, now = Date.now()): HandoffClaims | null {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(payload, secret))) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return handoffClaimsValid(claims, now) ? claims : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Called by the generated portal AFTER the controller authenticated the client.
 * The mapping id only selects a saved row; the shop comes from that row.
 */
export async function issuePortalHandoff(
  input: { mappingId: string; sessionId?: string | null },
  origin: string,
  secret: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  if (!UUID.test(input.mappingId)) return { ok: false, reason: "Unknown portal." };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: mapping } = await supabaseAdmin
    .from("omada_portal_mappings")
    .select("id, ecosystem_id, enabled, portal_id, site_id")
    .eq("id", input.mappingId)
    .maybeSingle();
  if (!mapping || mapping.enabled === false) {
    return { ok: false, reason: "This hotspot portal is not active." };
  }

  const sessionId = input.sessionId && UUID.test(input.sessionId) ? input.sessionId : null;
  const { data: row } = await supabaseAdmin
    .from("portal_handoffs")
    .insert({
      ecosystem_id: mapping.ecosystem_id,
      mapping_id: mapping.id,
      portal_id: mapping.portal_id,
      site_id: mapping.site_id,
      session_id: sessionId,
      expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (!row) return { ok: false, reason: "The hand-off could not be started." };

  const token = signHandoff(
    {
      jti: String(row.id),
      ecosystemId: mapping.ecosystem_id as string,
      mappingId: mapping.id as string,
      portalId: (mapping.portal_id as string | null) ?? null,
      siteId: (mapping.site_id as string | null) ?? null,
      expiresAt: Date.now() + HANDOFF_TTL_MS,
    },
    secret,
  );
  return { ok: true, url: handoffEntryUrl(origin, token) };
}

/**
 * Resolves the entry page's shop. A tampered, replayed or expired token simply
 * has no shop — the page then asks for a normal WaveWallet sign-in.
 */
export async function redeemPortalHandoff(
  token: string,
  secret: string,
): Promise<HandoffResolution> {
  const claims = verifyHandoff(token, secret);
  if (!claims) return { ok: false, reason: HANDOFF_EXPIRED };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: handoff } = await supabaseAdmin
    .from("portal_handoffs")
    .select("id, uses, expires_at, ecosystem_id, mapping_id")
    .eq("id", claims.jti)
    .maybeSingle();
  if (
    !handoff ||
    handoff.ecosystem_id !== claims.ecosystemId ||
    handoff.mapping_id !== claims.mappingId ||
    new Date(handoff.expires_at as string).getTime() < Date.now() ||
    (handoff.uses as number) >= MAX_HANDOFF_USES
  ) {
    return { ok: false, reason: HANDOFF_EXPIRED };
  }
  await supabaseAdmin
    .from("portal_handoffs")
    .update({ uses: (handoff.uses as number) + 1 })
    .eq("id", handoff.id as string);

  const { data: shop } = await supabaseAdmin
    .from("ecosystems")
    .select("name, slug, description")
    .eq("id", claims.ecosystemId)
    .maybeSingle();
  if (!shop) return { ok: false, reason: HANDOFF_EXPIRED };

  const { data: mapping } = await supabaseAdmin
    .from("omada_portal_mappings")
    .select("portal_name")
    .eq("id", claims.mappingId)
    .maybeSingle();

  return {
    ok: true,
    shop: {
      shopName: shop.name as string,
      shopSlug: (shop.slug as string | null) ?? null,
      shopDescription: (shop.description as string | null) ?? null,
      portalName: (mapping?.portal_name as string | null) ?? null,
    },
  };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { sanitizeFileName } from "./download-file";

const DOWNLOAD_TTL_MS = 5 * 60 * 1000;

type AuthContext = {
  supabase: {
    rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
};

interface DownloadClaims {
  ecosystemId: string;
  mappingId: string;
  checksum: string;
  userId: string;
  expiresAt: number;
}

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

async function assertShopAdmin(context: AuthContext, ecosystemId: string): Promise<void> {
  const owner = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (owner.error) throw new Error(owner.error.message);
  if (owner.data === true) return;
  const admin = await context.supabase.rpc("is_ecosystem_admin", {
    _user_id: context.userId,
    _ecosystem_id: ecosystemId,
  });
  if (admin.error) throw new Error(admin.error.message);
  if (admin.data !== true) throw new Error("You can only download portal pages for your own shop.");
}

export async function issuePortalArtifactDownload(
  context: AuthContext,
  data: { ecosystemId: string; mappingId: string },
  secret: string,
): Promise<{ url: string; fileName: string }> {
  await assertShopAdmin(context, data.ecosystemId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("omada_portal_templates")
    .select("file_name, generated_checksum, generated_html")
    .eq("mapping_id", data.mappingId)
    .eq("ecosystem_id", data.ecosystemId)
    .maybeSingle();
  if (!row?.generated_html || !row.file_name || !row.generated_checksum) {
    throw new Error("Generate the portal page first.");
  }

  const claims: DownloadClaims = {
    ecosystemId: data.ecosystemId,
    mappingId: data.mappingId,
    checksum: row.generated_checksum,
    userId: context.userId,
    expiresAt: Date.now() + DOWNLOAD_TTL_MS,
  };
  const payload = encode(JSON.stringify(claims));
  return {
    url: `/api/portal-template-download?t=${encodeURIComponent(`${payload}.${sign(payload, secret)}`)}`,
    fileName: sanitizeFileName(row.file_name),
  };
}

export function verifyPortalArtifactDownload(token: string, secret: string): DownloadClaims | null {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, sign(payload, secret))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DownloadClaims;
    if (
      !claims.ecosystemId ||
      !claims.mappingId ||
      !claims.checksum ||
      !claims.userId ||
      !Number.isFinite(claims.expiresAt) ||
      claims.expiresAt < Date.now()
    ) return null;
    return claims;
  } catch {
    return null;
  }
}

export function portalArtifactResponse(html: string, fileName: string): Response {
  const safeName = sanitizeFileName(fileName);
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "content-length": String(new TextEncoder().encode(html).byteLength),
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
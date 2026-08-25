/**
 * One-time, tenant-scoped provisioning of an already-verified Omada controller.
 *
 * ONLY the shops listed here are pre-provisioned, and only with their own
 * controller details. Every other tenant starts unconfigured and its admin
 * enters its own values — nothing is inherited, prefilled or shared.
 *
 * The client secret is never stored in source: it is read once from a
 * server-only environment secret, encrypted at rest for that single shop, and
 * then only ever used from that shop's row.
 */

export interface ProvisionedOmada {
  baseUrl: string;
  omadacId: string;
  clientId: string;
  siteName: string;
  /** Server-only env var holding this shop's client secret (bootstrap only). */
  secretEnv: string;
}

/** Keyed by ecosystem slug — non-secret controller identity only. */
export const PROVISIONED_OMADA: Record<string, ProvisionedOmada> = {
  sagadawave: {
    baseUrl: "https://portal.sagadawave.com:8043",
    omadacId: "c113a909b51676083a4ae67dc55af386",
    clientId: "4280c2d475fb481181f080c95e1ff191",
    siteName: "Sagada Wave V2",
    secretEnv: "OMADA_CLIENT_SECRET",
  },
};

type AdminClient = {
  from: (table: string) => any;
};

export async function provisioningFor(
  supabaseAdmin: AdminClient,
  ecosystemId: string,
): Promise<ProvisionedOmada | null> {
  const { data } = await supabaseAdmin
    .from("ecosystems")
    .select("slug")
    .eq("id", ecosystemId)
    .maybeSingle();
  const slug = (data?.slug as string | undefined)?.toLowerCase();
  if (!slug) return null;
  return PROVISIONED_OMADA[slug] ?? null;
}

/**
 * Creates the row for a pre-provisioned shop when the secret is available.
 * Returns the created row, or null when this shop is not pre-provisioned or
 * the secret is not present in the server environment.
 */
export async function bootstrapProvisionedConnection(
  supabaseAdmin: AdminClient,
  ecosystemId: string,
): Promise<Record<string, unknown> | null> {
  const spec = await provisioningFor(supabaseAdmin, ecosystemId);
  if (!spec) return null;
  const secret = process.env[spec.secretEnv];
  if (!secret) return null;

  const { encryptSecret } = await import("./omada-crypto.server");
  const { data: row, error } = await supabaseAdmin
    .from("omada_connections")
    .upsert(
      {
        ecosystem_id: ecosystemId,
        base_url: spec.baseUrl,
        omadac_id: spec.omadacId,
        client_id: spec.clientId,
        client_secret_ciphertext: encryptSecret(secret),
        site_name: spec.siteName,
        last_status: "untested",
        last_error: null,
      },
      { onConflict: "ecosystem_id" },
    )
    .select("*")
    .single();
  if (error) return null;
  return row as Record<string, unknown>;
}

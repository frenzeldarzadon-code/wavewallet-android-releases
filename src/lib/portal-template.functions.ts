/**
 * Admin-side "Import Customized Page" workflow, scoped to ONE shop's portal.
 *
 * The uploaded template belongs to a single saved portal mapping, and every
 * call re-authorises the caller against that shop. No controller write is ever
 * attempted here: Omada 6.2.14.11 publishes no supported route for importing a
 * customized portal page, so the generated file is downloaded and uploaded once
 * by the admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  analyzeOmadaTemplate,
  generateWaveWalletPortal,
  generatedFileName,
  normalizeTemplateFeatures,
  type PortalTemplateFeatures,
  type TemplateAnalysis,
} from "./portal-template";

type AuthContext = {
  supabase: {
    rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
};

async function assertShopAdmin(context: AuthContext, ecosystemId: string) {
  const owner = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (owner.error) throw new Error(owner.error.message);
  if (owner.data === true) return;
  const admin = await context.supabase.rpc("is_ecosystem_admin", {
    _user_id: context.userId,
    _ecosystem_id: ecosystemId,
  });
  if (admin.error) throw new Error(admin.error.message);
  if (admin.data !== true) {
    throw new Error("You can only set up the customer portal of your own shop.");
  }
}

export interface PortalTemplateView {
  mappingId: string;
  fileName: string | null;
  bytes: number | null;
  analysis: TemplateAnalysis | null;
  features: PortalTemplateFeatures;
  generatedAt: string | null;
  hasGenerated: boolean;
  importStatus: string;
  importDetail: string | null;
  importVerifiedAt: string | null;
  updatedAt: string | null;
}

function view(mappingId: string, row: Record<string, unknown> | null): PortalTemplateView {
  return {
    mappingId,
    fileName: (row?.["file_name"] as string | null) ?? null,
    bytes: row?.["template_bytes"] === undefined ? null : Number(row?.["template_bytes"] ?? 0) || null,
    analysis:
      row && row["analysis"] && typeof row["analysis"] === "object" && Object.keys(row["analysis"]).length
        ? (row["analysis"] as TemplateAnalysis)
        : null,
    features: normalizeTemplateFeatures(row?.["features"]),
    generatedAt: (row?.["generated_at"] as string | null) ?? null,
    hasGenerated: Boolean(row?.["generated_html"]),
    importStatus: (row?.["import_status"] as string | null) ?? "manual_required",
    importDetail: (row?.["import_detail"] as string | null) ?? null,
    importVerifiedAt: (row?.["import_verified_at"] as string | null) ?? null,
    updatedAt: (row?.["updated_at"] as string | null) ?? null,
  };
}

/** Loads the mapping and proves it belongs to the caller's shop. */
async function requireMapping(context: AuthContext, ecosystemId: string, mappingId: string) {
  await assertShopAdmin(context, ecosystemId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: mapping } = await supabaseAdmin
    .from("omada_portal_mappings")
    .select("*")
    .eq("id", mappingId)
    .eq("ecosystem_id", ecosystemId)
    .maybeSingle();
  if (!mapping) throw new Error("That portal does not belong to this shop.");
  return { supabaseAdmin, mapping: mapping as Record<string, unknown> };
}

export const getPortalTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mappingId: string }) => {
    if (!data?.ecosystemId || !data?.mappingId) throw new Error("A shop and portal are required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<PortalTemplateView> => {
    const { supabaseAdmin } = await requireMapping(
      context as unknown as AuthContext,
      data.ecosystemId,
      data.mappingId,
    );
    const { data: row } = await supabaseAdmin
      .from("omada_portal_templates")
      .select("*")
      .eq("mapping_id", data.mappingId)
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();
    return view(data.mappingId, (row as Record<string, unknown> | null) ?? null);
  });

/** Stores the ORIGINAL template exported from this shop's own controller. */
export const uploadPortalTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mappingId: string; fileName: string; html: string }) => {
    if (!data?.ecosystemId || !data?.mappingId) throw new Error("A shop and portal are required.");
    if (typeof data.html !== "string" || !data.html.trim()) throw new Error("Choose a template file.");
    if (data.html.length > 4_000_000) throw new Error("That file is too large.");
    return data;
  })
  .handler(async ({ data, context }): Promise<PortalTemplateView> => {
    const ctx = context as unknown as AuthContext;
    const { supabaseAdmin } = await requireMapping(ctx, data.ecosystemId, data.mappingId);
    const analysis = analyzeOmadaTemplate(data.html);
    if (!analysis.valid) throw new Error(analysis.errors.join(" "));

    const { data: row, error } = await supabaseAdmin
      .from("omada_portal_templates")
      .upsert(
        {
          mapping_id: data.mappingId,
          ecosystem_id: data.ecosystemId,
          file_name: data.fileName.slice(0, 200) || "portal.html",
          template_html: data.html,
          template_bytes: analysis.bytes,
          analysis: analysis as never,
          generated_html: null,
          generated_at: null,
          import_status: "manual_required",
          import_detail: null,
          import_verified_at: null,
          created_by: ctx.userId,
        },
        { onConflict: "mapping_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return view(data.mappingId, row as Record<string, unknown>);
  });

export const savePortalTemplateFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      ecosystemId: string;
      mappingId: string;
      features: Partial<PortalTemplateFeatures>;
    }) => {
      if (!data?.ecosystemId || !data?.mappingId) throw new Error("A shop and portal are required.");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<PortalTemplateView> => {
    const { supabaseAdmin } = await requireMapping(
      context as unknown as AuthContext,
      data.ecosystemId,
      data.mappingId,
    );
    const features = normalizeTemplateFeatures(data.features);
    const { data: row, error } = await supabaseAdmin
      .from("omada_portal_templates")
      .update({ features: features as unknown as Record<string, unknown> })
      .eq("mapping_id", data.mappingId)
      .eq("ecosystem_id", data.ecosystemId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Upload the Omada template for this portal first.");
    return view(data.mappingId, row as Record<string, unknown>);
  });

export interface GeneratedPortalFile {
  fileName: string;
  html: string;
  /** Exactly what the admin must do in Omada, for THIS portal. */
  manualSteps: string[];
  /** Never automatic on this controller; kept explicit so the UI cannot lie. */
  importSupported: false;
}

/** Builds the downloadable page for ONE portal, from that portal's template. */
export const generatePortalTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mappingId: string; origin: string }) => {
    if (!data?.ecosystemId || !data?.mappingId) throw new Error("A shop and portal are required.");
    if (!/^https?:\/\/.+/.test(data?.origin ?? "")) throw new Error("A WaveWallet address is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<GeneratedPortalFile> => {
    const { supabaseAdmin, mapping } = await requireMapping(
      context as unknown as AuthContext,
      data.ecosystemId,
      data.mappingId,
    );
    const { data: row } = await supabaseAdmin
      .from("omada_portal_templates")
      .select("*")
      .eq("mapping_id", data.mappingId)
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();
    if (!row?.template_html) throw new Error("Upload the Omada template for this portal first.");

    const { data: shop } = await supabaseAdmin
      .from("ecosystems")
      .select("name, slug")
      .eq("id", data.ecosystemId)
      .maybeSingle();

    const analysis = analyzeOmadaTemplate(row.template_html as string);
    if (!analysis.valid) throw new Error(analysis.errors.join(" "));
    const features = normalizeTemplateFeatures(row.features);
    const shopName = (shop?.name as string | null) ?? "This shop";
    const portalName = (mapping["portal_name"] as string | null) ?? null;

    const html = generateWaveWalletPortal(row.template_html as string, analysis, features, {
      origin: data.origin,
      mappingId: data.mappingId,
      shopName,
      shopSlug: (shop?.slug as string | null) ?? null,
      portalName,
      siteName: (mapping["site_name"] as string | null) ?? null,
    });

    await supabaseAdmin
      .from("omada_portal_templates")
      .update({
        analysis: analysis as never,
        generated_html: html,
        generated_at: new Date().toISOString(),
        import_status: "manual_required",
      })
      .eq("mapping_id", data.mappingId)
      .eq("ecosystem_id", data.ecosystemId);

    return {
      fileName: generatedFileName(shopName, portalName),
      html,
      importSupported: false,
      manualSteps: manualImportSteps(
        portalName,
        (mapping["site_name"] as string | null) ?? (mapping["site_id"] as string),
      ),
    };
  });

/** The exact clicks for ONE portal — never a global controller setting. */
export function manualImportSteps(portalName: string | null, siteLabel: string): string[] {
  const portal = portalName ? `"${portalName}"` : "the portal you selected";
  return [
    `In Omada, switch to site "${siteLabel}". Do not change any global or organisation-wide setting.`,
    `Open Settings \u2192 Authentication \u2192 Portal and edit ${portal} only.`,
    "In the Portal Customization section, choose Custom Page / Import Customized Page.",
    "Upload the HTML file WaveWallet generated for this portal.",
    "Save the portal, then reconnect a phone to that hotspot to see the new page.",
  ];
}

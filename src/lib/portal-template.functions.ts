/**
 * Admin-side "Import Customized Page" workflow, scoped to ONE shop's portal.
 *
 * Admins never upload a template: the page is derived from the ACTIVE canonical
 * master the platform owner published. Every call re-authorises the caller
 * against the shop that owns the selected portal mapping. No controller write
 * is ever attempted here: Omada 6.2.14.11 publishes no supported route for
 * importing a customized portal page, so the generated file is downloaded and
 * imported once by the admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { base64ToBytes, masterFromArchive, readZipEntries } from "./portal-master";
import { generatePortalFromMaster } from "./portal-generate";
import {
  DEFAULT_PORTAL_THEME_SLUG,
  normalizePortalTheme,
  PORTAL_THEMES,
  resolvePortalTheme,
  type PortalTheme,
} from "./portal-themes";
import {
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
  /** Name and measured size of the LAST generated artifact for this portal. */
  fileName: string | null;
  bytes: number | null;
  features: PortalTemplateFeatures;
  generatedAt: string | null;
  hasGenerated: boolean;
  importStatus: string;
  /** Design gallery theme chosen for this portal. Presentation only. */
  themeSlug: string;
  updatedAt: string | null;
  /** Active canonical master this portal generates from. Admins never upload. */
  masterVersion: number | null;
  masterChecksum: string | null;
  masterBytes: number | null;
  masterFileName: string | null;
  masterUploadedAt: string | null;
  masterAnalysis: TemplateAnalysis | null;
  masterWarnings: string[];
}

interface MasterRow {
  id: string;
  version: number;
  checksum: string;
  template_html: string;
  template_bytes: number;
  original_file_name: string | null;
  source_kind: string | null;
  original_content: string | null;
  analysis: unknown;
  warnings: unknown;
  created_at: string;
}

function view(
  mappingId: string,
  row: Record<string, unknown> | null,
  master: MasterRow | null,
): PortalTemplateView {
  return {
    mappingId,
    fileName: (row?.["file_name"] as string | null) ?? null,
    bytes: row?.["template_bytes"] === undefined ? null : Number(row?.["template_bytes"] ?? 0) || null,
    features: normalizeTemplateFeatures(row?.["features"]),
    generatedAt: (row?.["generated_at"] as string | null) ?? null,
    hasGenerated: Boolean(row?.["generated_html"]),
    importStatus: (row?.["import_status"] as string | null) ?? "manual_required",
    themeSlug: (row?.["theme_slug"] as string | null) ?? DEFAULT_PORTAL_THEME_SLUG,
    updatedAt: (row?.["updated_at"] as string | null) ?? null,
    masterVersion: master?.version ?? null,
    masterChecksum: master?.checksum ?? null,
    masterBytes: master?.template_bytes ?? null,
    masterFileName: master?.original_file_name ?? null,
    masterUploadedAt: master?.created_at ?? null,
    masterAnalysis:
      master?.analysis && typeof master.analysis === "object" && Object.keys(master.analysis).length
        ? (master.analysis as TemplateAnalysis)
        : null,
    masterWarnings: Array.isArray(master?.warnings) ? (master.warnings as string[]) : [],
  };
}

const MASTER_SELECT =
  "id, version, checksum, template_html, template_bytes, original_file_name, source_kind, original_content, analysis, warnings, created_at";

/** Reads the active canonical master. Read-only: admins can never change it. */
async function activeMaster(
  supabaseAdmin: { from: (t: string) => never },
): Promise<MasterRow | null> {
  const client = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: unknown,
        ) => { maybeSingle: () => Promise<{ data: MasterRow | null }> };
      };
    };
  };
  const { data } = await client
    .from("omada_portal_base_templates")
    .select(MASTER_SELECT)
    .eq("is_active", true)
    .maybeSingle();
  return data ?? null;
}

/**
 * Reads the database-backed design gallery. The built-in seed list is only a
 * fallback so preview and generation never break when the catalog is empty.
 */
async function themeCatalog(supabaseAdmin: unknown): Promise<PortalTheme[]> {
  const client = supabaseAdmin as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: unknown,
        ) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: unknown[] | null }> };
      };
    };
  };
  try {
    const { data } = await client
      .from("omada_portal_themes")
      .select("slug, name, description, category, layout, decor, font_stack, motion, tokens, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    const rows = (data ?? []).map((r) => normalizePortalTheme(r));
    return rows.length ? rows : PORTAL_THEMES;
  } catch {
    return PORTAL_THEMES;
  }
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
    return view(
      data.mappingId,
      (row as Record<string, unknown> | null) ?? null,
      await activeMaster(supabaseAdmin as never),
    );
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
    const ctx = context as unknown as AuthContext;
    const { supabaseAdmin } = await requireMapping(ctx, data.ecosystemId, data.mappingId);
    const features = normalizeTemplateFeatures(data.features);
    const { data: row, error } = await supabaseAdmin
      .from("omada_portal_templates")
      .upsert(
        {
          mapping_id: data.mappingId,
          ecosystem_id: data.ecosystemId,
          features: features as never,
          created_by: ctx.userId,
        },
        { onConflict: "mapping_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return view(
      data.mappingId,
      row as Record<string, unknown>,
      await activeMaster(supabaseAdmin as never),
    );
  });

/** The design gallery, straight from the database. Read-only for admins. */
export const listPortalThemes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<PortalTheme[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return themeCatalog(supabaseAdmin);
  });

/** Saves the chosen theme for ONE portal. Presentation only: nothing about the
 * canonical Omada master, its mechanics or the enabled features changes. */
export const savePortalTemplateTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mappingId: string; themeSlug: string }) => {
    if (!data?.ecosystemId || !data?.mappingId) throw new Error("A shop and portal are required.");
    if (!data?.themeSlug) throw new Error("Choose a design theme.");
    return data;
  })
  .handler(async ({ data, context }): Promise<PortalTemplateView> => {
    const ctx = context as unknown as AuthContext;
    const { supabaseAdmin } = await requireMapping(ctx, data.ecosystemId, data.mappingId);
    const catalog = await themeCatalog(supabaseAdmin);
    const theme = catalog.find((th) => th.slug === data.themeSlug);
    if (!theme) throw new Error("That design theme is not available.");

    const { data: existing } = await supabaseAdmin
      .from("omada_portal_templates")
      .select("features")
      .eq("mapping_id", data.mappingId)
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("omada_portal_templates")
      .upsert(
        {
          mapping_id: data.mappingId,
          ecosystem_id: data.ecosystemId,
          features: normalizeTemplateFeatures(existing?.features) as never,
          theme_slug: theme.slug,
          created_by: ctx.userId,
        },
        { onConflict: "mapping_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return view(
      data.mappingId,
      row as Record<string, unknown>,
      await activeMaster(supabaseAdmin as never),
    );
  });

export interface GeneratedPortalFile {
  fileName: string;
  html: string;
  /** Real measured size of the generated file. */
  bytes: number;
  checksum: string;
  /** Canonical master this artifact was derived from. */
  masterVersion: number;
  masterChecksum: string;
  themeSlug: string;
  themeName: string;
  summary: string[];
  warnings: string[];
  /** Exactly what the admin must do in Omada, for THIS portal. */
  manualSteps: string[];
  /** Never automatic on this controller; kept explicit so the UI cannot lie. */
  importSupported: false;
}

/**
 * Builds the downloadable page for ONE portal by deriving it from the ACTIVE
 * canonical master the platform owner uploaded. No master, no generation: the
 * builder never falls back to a hand-written copy of Omada's runtime.
 */
export const generatePortalTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mappingId: string; origin: string }) => {
    if (!data?.ecosystemId || !data?.mappingId) throw new Error("A shop and portal are required.");
    if (!/^https?:\/\/.+/.test(data?.origin ?? "")) throw new Error("A WaveWallet address is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<GeneratedPortalFile> => {
    const ctx = context as unknown as AuthContext;
    // The page is imported into a controller and opened by customers who are
    // NOT online yet, so it must carry the deployed public address — never the
    // preview host the admin generated it from.
    const { getRequest } = await import("@tanstack/react-start/server");
    let requestOrigin: string | null = null;
    try {
      requestOrigin = new URL(getRequest().url).origin;
    } catch {
      /* no request context (tests): fall back below */
    }
    const publicOrigin = resolvePublicOrigin({
      configured: process.env["PUBLIC_APP_ORIGIN"] ?? null,
      request: requestOrigin,
      suggested: data.origin,
    });
    const { supabaseAdmin, mapping } = await requireMapping(ctx, data.ecosystemId, data.mappingId);

    const master = await activeMaster(supabaseAdmin as never);
    if (!master) {
      throw new Error(
        "No Omada portal template has been published yet. Ask the platform owner to upload the original Omada template first.",
      );
    }

    const { data: row } = await supabaseAdmin
      .from("omada_portal_templates")
      .select("*")
      .eq("mapping_id", data.mappingId)
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();

    const { data: shop } = await supabaseAdmin
      .from("ecosystems")
      .select("name, slug")
      .eq("id", data.ecosystemId)
      .maybeSingle();

    const features = normalizeTemplateFeatures(row?.features);
    const theme = resolvePortalTheme(
      (row?.theme_slug as string | null) ?? DEFAULT_PORTAL_THEME_SLUG,
      await themeCatalog(supabaseAdmin),
    );
    const shopName = (shop?.name as string | null) ?? "This shop";
    const portalName = (mapping["portal_name"] as string | null) ?? null;

    // The stored original is only ever READ. Re-reading the archive here keeps
    // the master byte-for-byte in the database.
    let files: Record<string, string> = { "index.html": master.template_html };
    if (master.source_kind === "zip" && master.original_content) {
      try {
        const entries = await readZipEntries(base64ToBytes(master.original_content));
        files = masterFromArchive(entries.text, entries.names).files;
      } catch {
        /* unreadable archive: generate from the cached index.html alone */
      }
    }

    const generated = generatePortalFromMaster(
      {
        version: master.version,
        checksum: master.checksum,
        html: master.template_html,
        files,
        analysis:
          master.analysis && typeof master.analysis === "object"
            ? (master.analysis as TemplateAnalysis)
            : null,
      },
      features,
      {
        origin: data.origin,
        mappingId: data.mappingId,
        shopName,
        shopSlug: (shop?.slug as string | null) ?? null,
        portalId: (mapping["portal_id"] as string | null) ?? null,
        portalName,
        siteId: (mapping["site_id"] as string | null) ?? null,
        siteName: (mapping["site_name"] as string | null) ?? null,
      },
      theme,
    );

    await supabaseAdmin.from("omada_portal_templates").upsert(
      {
        mapping_id: data.mappingId,
        ecosystem_id: data.ecosystemId,
        features: features as never,
        theme_slug: theme.slug,
        file_name: generated.fileName,
        template_bytes: generated.bytes,
        generated_html: generated.html,
        generated_checksum: generated.checksum,
        base_template_id: master.id,
        base_version: master.version,
        generated_at: new Date().toISOString(),
        import_status: "manual_required",
        created_by: ctx.userId,
      },
      { onConflict: "mapping_id" },
    );

    return {
      fileName: generated.fileName,
      html: generated.html,
      bytes: generated.bytes,
      checksum: generated.checksum,
      masterVersion: generated.masterVersion,
      masterChecksum: generated.masterChecksum,
      themeSlug: generated.themeSlug,
      themeName: generated.themeName,
      summary: generated.summary,
      warnings: generated.warnings,
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


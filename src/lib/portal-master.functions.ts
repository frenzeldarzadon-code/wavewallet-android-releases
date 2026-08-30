/**
 * Canonical Omada portal master library — platform owner only.
 *
 * The platform owner uploads the ORIGINAL Omada template once. It is stored
 * exactly as uploaded (never rewritten, never replaced by a newer upload) and
 * older versions are kept forever. Shop admins can read which version is active
 * but can never add, change or activate one: every mutation below re-checks
 * super-admin rights on the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { analyzeOmadaTemplate, type TemplateAnalysis } from "./portal-template";
import {
  base64ToBytes,
  byteSize,
  checksumOf,
  deriveFromMaster,
  masterFromArchive,
  readZipEntries,
} from "./portal-master";

type AuthContext = {
  supabase: {
    rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
};

async function requirePlatformOwner(context: AuthContext) {
  const owner = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (owner.error) throw new Error(owner.error.message);
  if (owner.data !== true) {
    throw new Error("Only the platform owner can manage the canonical portal template.");
  }
}

export interface PortalMasterView {
  id: string;
  version: number;
  fileName: string;
  sourceKind: string;
  /** Untouched original size in bytes. */
  originalBytes: number;
  originalChecksum: string;
  /** Size of the parsed index.html cached from the original. */
  bytes: number;
  checksum: string;
  isActive: boolean;
  isValid: boolean;
  archiveFiles: string[];
  warnings: string[];
  analysis: TemplateAnalysis | null;
  notes: string | null;
  uploadedAt: string;
}

function toView(row: Record<string, unknown>): PortalMasterView {
  return {
    id: String(row["id"]),
    version: Number(row["version"] ?? 0),
    fileName: (row["original_file_name"] as string | null) ?? (row["file_name"] as string) ?? "portal.html",
    sourceKind: (row["source_kind"] as string | null) ?? "html",
    originalBytes: Number(row["original_bytes"] ?? row["template_bytes"] ?? 0),
    originalChecksum: (row["original_checksum"] as string | null) ?? "",
    bytes: Number(row["template_bytes"] ?? 0),
    checksum: (row["checksum"] as string | null) ?? "",
    isActive: row["is_active"] === true,
    isValid: row["is_valid"] === true,
    archiveFiles: Array.isArray(row["archive_files"]) ? (row["archive_files"] as string[]) : [],
    warnings: Array.isArray(row["warnings"]) ? (row["warnings"] as string[]) : [],
    analysis:
      row["analysis"] && typeof row["analysis"] === "object" && Object.keys(row["analysis"]).length
        ? (row["analysis"] as TemplateAnalysis)
        : null,
    notes: (row["notes"] as string | null) ?? null,
    uploadedAt: String(row["created_at"] ?? ""),
  };
}

const MASTER_COLUMNS =
  "id, version, file_name, original_file_name, source_kind, original_bytes, original_checksum, template_bytes, checksum, is_active, is_valid, archive_files, warnings, analysis, notes, created_at";

/** Every stored version, newest first. Platform owner only. */
export const listPortalMasters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortalMasterView[]> => {
    await requirePlatformOwner(context as unknown as AuthContext);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("omada_portal_base_templates")
      .select(MASTER_COLUMNS)
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(toView);
  });


/**
 * Stores a new canonical version. The original file is written once and never
 * updated afterwards; activating a different version only flips a flag.
 */
export const uploadPortalMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { fileName: string; kind: "html" | "zip"; content: string; notes?: string }) => {
      if (!data?.content || typeof data.content !== "string") throw new Error("Choose a template file.");
      if (data.content.length > 12_000_000) throw new Error("That file is too large.");
      if (data.kind !== "html" && data.kind !== "zip") throw new Error("Upload the .zip or the index.html.");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<PortalMasterView> => {
    const ctx = context as unknown as AuthContext;
    await requirePlatformOwner(ctx);

    let masterHtml: string;
    let files: Record<string, string> = {};
    let names: string[] = [];
    const warnings: string[] = [];

    if (data.kind === "zip") {
      const entries = await readZipEntries(base64ToBytes(data.content));
      const source = masterFromArchive(entries.text, entries.names);
      masterHtml = source.html;
      files = source.files;
      names = source.names;
      warnings.push(...source.warnings);
    } else {
      masterHtml = data.content;
      names = [data.fileName || "index.html"];
      files = { "index.html": masterHtml };
    }

    const analysis = analyzeOmadaTemplate(masterHtml);
    if (!analysis.valid) throw new Error(analysis.errors.join(" "));
    warnings.push(...analysis.warnings);

    // Prove the master can actually be derived from before it becomes active.
    const derived = deriveFromMaster(masterHtml, files);
    if (!derived.html.trim()) throw new Error("This master produced an empty page and was not stored.");
    if (derived.missing.length) {
      warnings.push(`Assets referenced but not found in the upload: ${derived.missing.join(", ")}.`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: latest } = await supabaseAdmin
      .from("omada_portal_base_templates")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = Number((latest as { version?: number } | null)?.version ?? 0) + 1;

    // Only one active version: retire the current one first.
    await supabaseAdmin
      .from("omada_portal_base_templates")
      .update({ is_active: false })
      .eq("is_active", true);

    const { data: row, error } = await supabaseAdmin
      .from("omada_portal_base_templates")
      .insert({
        version,
        file_name: data.fileName?.slice(0, 200) || "index.html",
        original_file_name: data.fileName?.slice(0, 200) || "index.html",
        source_kind: data.kind,
        original_content: data.content,
        original_bytes: data.kind === "zip" ? base64ToBytes(data.content).length : byteSize(data.content),
        original_checksum: checksumOf(data.content),
        template_html: masterHtml,
        template_bytes: byteSize(masterHtml),
        checksum: checksumOf(masterHtml),
        analysis: analysis as never,
        archive_files: names.slice(0, 200) as never,
        warnings: warnings.slice(0, 40) as never,
        is_valid: true,
        is_active: true,
        notes: data.notes?.slice(0, 500) ?? null,
        uploaded_by: ctx.userId,
      })
      .select(MASTER_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return toView(row as Record<string, unknown>);
  });

/** Switches which stored version admins generate from. Nothing is rewritten. */
export const activatePortalMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data?.id) throw new Error("Choose a version.");
    return data;
  })
  .handler(async ({ data, context }): Promise<PortalMasterView[]> => {
    await requirePlatformOwner(context as unknown as AuthContext);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("omada_portal_base_templates")
      .select("id, is_valid")
      .eq("id", data.id)
      .maybeSingle();
    if (!target) throw new Error("That version no longer exists.");
    if ((target as { is_valid?: boolean }).is_valid !== true) {
      throw new Error("That version did not pass validation and cannot be activated.");
    }
    await supabaseAdmin
      .from("omada_portal_base_templates")
      .update({ is_active: false })
      .eq("is_active", true);
    const { error } = await supabaseAdmin
      .from("omada_portal_base_templates")
      .update({ is_active: true })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const { data: rows } = await supabaseAdmin
      .from("omada_portal_base_templates")
      .select(MASTER_COLUMNS)
      .order("version", { ascending: false });
    return ((rows ?? []) as Record<string, unknown>[]).map(toView);
  });

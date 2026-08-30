/**
 * canonical master -> derived page for ONE shop's exact Omada portal.
 *
 * Pure and deterministic: the same master, feature set and portal binding
 * always produce identical bytes, so the admin's preview, the stored artifact
 * and the downloaded file can never differ.
 */
import { byteSize, checksumOf, deriveFromMaster } from "./portal-master";
import {
  analyzeOmadaTemplate,
  generateWaveWalletPortal,
  generatedFileName,
  normalizeTemplateFeatures,
  type PortalTemplateFeatures,
  type TemplateAnalysis,
} from "./portal-template";

export interface MasterInput {
  version: number;
  checksum: string;
  html: string;
  /** Text files from the original archive, used to inline the master's scripts. */
  files: Record<string, string>;
  /** Cached analysis of the master; recomputed when absent. */
  analysis?: TemplateAnalysis | null;
}

export interface PortalBinding {
  origin: string;
  mappingId: string;
  shopName: string;
  shopSlug: string | null;
  portalId: string | null;
  portalName: string | null;
  siteId: string | null;
  siteName: string | null;
}

export interface GeneratedPortal {
  fileName: string;
  html: string;
  /** Real measured size — never an estimate. */
  bytes: number;
  checksum: string;
  masterVersion: number;
  masterChecksum: string;
  features: PortalTemplateFeatures;
  summary: string[];
  warnings: string[];
}

export function generatePortalFromMaster(
  master: MasterInput,
  featuresInput: Partial<PortalTemplateFeatures> | PortalTemplateFeatures,
  binding: PortalBinding,
): GeneratedPortal {
  const features = normalizeTemplateFeatures(featuresInput);
  const derived = deriveFromMaster(master.html, master.files);
  const analysis = master.analysis ?? analyzeOmadaTemplate(master.html);

  const html = generateWaveWalletPortal(derived.html, analysis, features, {
    origin: binding.origin,
    mappingId: binding.mappingId,
    shopName: binding.shopName,
    shopSlug: binding.shopSlug,
    portalName: binding.portalName,
    siteName: binding.siteName,
    portalId: binding.portalId,
    siteId: binding.siteId,
    masterVersion: master.version,
    masterChecksum: master.checksum,
  });

  const warnings = [...analysis.warnings];
  if (derived.missing.length) {
    warnings.push(`Assets the master references but did not ship: ${derived.missing.join(", ")}.`);
  }

  const summary = [
    `Derived from canonical master v${master.version} (${master.checksum}).`,
    `Bound to site "${binding.siteName ?? binding.siteId ?? "unknown"}" and portal "${
      binding.portalName ?? binding.portalId ?? "unknown"
    }" for ${binding.shopName}.`,
    `Manual voucher entry kept exactly as the master defines it.`,
    ...analysis.preserved,
    derived.inlined.length
      ? `Master scripts inlined verbatim: ${derived.inlined.join(", ")}.`
      : "No archive scripts needed inlining.",
    `Omada presentation removed: ${derived.removed.length} stylesheet/image reference(s).`,
  ];

  return {
    fileName: generatedFileName(binding.shopName, binding.portalName),
    html,
    bytes: byteSize(html),
    checksum: checksumOf(html),
    masterVersion: master.version,
    masterChecksum: master.checksum,
    features,
    summary,
    warnings,
  };
}

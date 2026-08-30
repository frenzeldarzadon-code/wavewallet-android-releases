/**
 * The canonical Omada portal master.
 *
 * The platform owner uploads the ORIGINAL template exported from Omada exactly
 * once (the .zip the controller produces, or its index.html). WaveWallet stores
 * that file untouched and treats it as the single source of truth: every
 * generated shop portal is derived FROM it, never from a hand-written copy of
 * Omada's runtime.
 *
 * Everything here is pure (apart from the zip reader, which only decompresses)
 * so the stored master can never be modified in place.
 */

/* ------------------------------------------------------------------ *
 * Bytes and fingerprints                                              *
 * ------------------------------------------------------------------ */

export function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Stable, dependency-free FNV-1a fingerprint used to prove the master is untouched. */
export function checksumOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}-${text.length}`;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ *
 * Zip reader (the shape Omada's "download customized page" produces)  *
 * ------------------------------------------------------------------ */

const TEXT_FILE = /\.(html?|css|js|json|txt|svg)$/i;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(
    new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
  );
  return new Uint8Array(await stream.arrayBuffer());
}

/**
 * Reads the archive without rewriting it. Only the entries WaveWallet needs to
 * understand the template are decoded; binary assets are reported by name only.
 */
export async function readZipEntries(
  bytes: Uint8Array,
): Promise<{ text: Record<string, string>; names: string[] }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text: Record<string, string> = {};
  const names: string[] = [];
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const flags = view.getUint16(offset + 6, true);
    let compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;

    // Streamed entries put the sizes in a trailing descriptor: find the next
    // local header instead of trusting a zero length.
    if ((flags & 0x08) !== 0 || compressedSize === 0) {
      let next = dataStart;
      while (next + 4 <= bytes.length && view.getUint32(next, true) !== 0x04034b50) {
        if (view.getUint32(next, true) === 0x02014b50) break;
        next += 1;
      }
      compressedSize = Math.max(0, next - dataStart - ((flags & 0x08) !== 0 ? 16 : 0));
    }

    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    if (name && !name.endsWith("/")) {
      names.push(name);
      if (TEXT_FILE.test(name)) {
        try {
          const content = method === 0 ? raw : await inflateRaw(raw);
          text[name] = decoder.decode(content);
        } catch {
          /* unreadable entry: reported by name only */
        }
      }
    }
    offset = dataStart + compressedSize;
    if ((flags & 0x08) !== 0) offset += 16;
  }

  if (names.length === 0) throw new Error("That archive could not be read as a zip file.");
  return { text, names };
}

/* ------------------------------------------------------------------ *
 * Canonical master assembly                                           *
 * ------------------------------------------------------------------ */

export interface MasterSource {
  /** index.html exactly as Omada shipped it. */
  html: string;
  /** Every readable text file in the archive, keyed by its path. */
  files: Record<string, string>;
  /** Every entry name in the archive, including binary assets. */
  names: string[];
  warnings: string[];
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Picks index.html out of an uploaded archive without altering any file. */
export function masterFromArchive(text: Record<string, string>, names: string[]): MasterSource {
  const entry =
    Object.keys(text).find((n) => baseName(n).toLowerCase() === "index.html") ??
    Object.keys(text).find((n) => /\.html?$/i.test(n));
  if (!entry) throw new Error("No index.html was found inside that archive.");
  const warnings: string[] = [];
  const missing = names.filter((n) => /\.(png|jpe?g|gif|webp|ico)$/i.test(n));
  if (missing.length) {
    warnings.push(
      `${missing.length} image asset(s) in the archive are dropped on purpose: the generated page uses a CSS-only background.`,
    );
  }
  return { html: text[entry]!, files: text, names, warnings };
}

/* ------------------------------------------------------------------ *
 * Derivation: assets in, visual layer out                             *
 * ------------------------------------------------------------------ */

const IMAGE_URL = /\.(png|jpe?g|gif|webp|bmp|ico)(\?[^)"']*)?$/i;

/**
 * Inlines the master's own stylesheet-free scripts so the generated page is a
 * single self-contained file. Script bodies are copied verbatim: Omada's
 * runtime is preserved exactly, never rewritten.
 */
export function inlineMasterAssets(
  html: string,
  files: Record<string, string>,
): { html: string; inlined: string[]; missing: string[] } {
  const inlined: string[] = [];
  const missing: string[] = [];
  const lookup = (src: string): string | null => {
    const wanted = baseName(src.split("?")[0] ?? src).toLowerCase();
    const key = Object.keys(files).find((n) => baseName(n).toLowerCase() === wanted);
    return key ? files[key]! : null;
  };

  const out = html.replace(
    /<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script\s*>/gi,
    (match, before: string, src: string, after: string) => {
      if (/^https?:|^\/\//i.test(src)) return match;
      const body = lookup(src);
      if (body === null) {
        // A controller-served script (for example /portal/js/portal.js) stays
        // referenced exactly as the master had it.
        if (src.startsWith("/")) return match;
        missing.push(src);
        return match;
      }
      inlined.push(baseName(src));
      const attrs = `${before} ${after}`.replace(/\s+/g, " ").trim();
      return `<script${attrs ? ` ${attrs}` : ""} data-ww-inlined="${baseName(src)}">\n${body}\n</script>`;
    },
  );
  return { html: out, inlined, missing };
}

/**
 * Removes ONLY the presentation layer Omada ships (its stylesheet, logo,
 * background images and other pictures). Forms, hidden inputs, scripts,
 * placeholders and every Omada mechanic are left exactly as they were.
 */
export function stripVisualLayer(html: string): { html: string; removed: string[] } {
  const removed: string[] = [];
  let out = html;

  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    if (/rel\s*=\s*["']?(stylesheet|icon|shortcut icon|apple-touch-icon)/i.test(tag)) {
      removed.push(tag.slice(0, 80));
      return "";
    }
    return tag;
  });

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    removed.push(tag.slice(0, 80));
    return "";
  });

  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, (block) => {
    removed.push("inline <style> block");
    return "";
  });

  out = out.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (match, _q, url: string) => {
    if (IMAGE_URL.test(url)) {
      removed.push(url);
      return "none";
    }
    return match;
  });

  out = out.replace(/\s(background|background-image)\s*:\s*[^;"']*none[^;"']*;?/gi, " ");

  return { html: out, removed };
}

/** Master -> generation-ready HTML. Pure, so preview and download agree. */
export function deriveFromMaster(
  masterHtml: string,
  files: Record<string, string>,
): { html: string; inlined: string[]; removed: string[]; missing: string[] } {
  const withScripts = inlineMasterAssets(masterHtml, files);
  const stripped = stripVisualLayer(withScripts.html);
  return {
    html: stripped.html,
    inlined: withScripts.inlined,
    missing: withScripts.missing,
    removed: stripped.removed,
  };
}

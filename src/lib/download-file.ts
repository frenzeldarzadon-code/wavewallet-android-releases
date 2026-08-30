/**
 * Small, dependency-free browser download helper.
 *
 * Mobile browsers (and Firefox) ignore a synthetic click on an anchor that was
 * never inserted into the document, and revoking the object URL in the same
 * tick can cancel the download before it starts. This helper does both things
 * correctly and reports failure so the UI can show a visible fallback link.
 */

/** Keeps the generated name but strips anything unsafe for a filesystem. */
export function sanitizeFileName(name: string, fallback = "portal.html"): string {
  const base = (name ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const safe = base.slice(0, 120);
  return safe || fallback;
}

export interface DownloadResult {
  ok: boolean;
  fileName: string;
  /** Object URL kept alive for a fallback link when the click was blocked. */
  url: string | null;
  error?: string;
}

/**
 * Downloads exact `content` bytes as `fileName`. Never transforms the content.
 */
export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType = "text/html;charset=utf-8",
): DownloadResult {
  const safeName = sanitizeFileName(fileName);
  if (!content) {
    return { ok: false, fileName: safeName, url: null, error: "There is nothing to download yet." };
  }
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return { ok: false, fileName: safeName, url: null, error: "Downloads are not available here." };
  }
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke later: revoking immediately cancels the download on some browsers.
    const revoke = url;
    setTimeout(() => URL.revokeObjectURL(revoke), 60_000);
    return { ok: true, fileName: safeName, url };
  } catch (e) {
    return {
      ok: false,
      fileName: safeName,
      url,
      error: (e as Error)?.message || "Your browser blocked the download.",
    };
  }
}

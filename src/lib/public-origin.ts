/**
 * The one public address a generated Omada portal, an external-portal URL and a
 * post-authentication hand-off link may ever point at.
 *
 * A captive-portal page lives inside the Omada controller, not in the browser
 * that generated it, so the address baked into it must NOT be whatever origin
 * the admin happened to be looking at (a preview build, a *.lovable.app host or
 * localhost). Those hosts are unreachable for a customer sitting behind the
 * hotspot. The canonical production origin is resolved server-side instead.
 */

/** Hosts that are development or platform previews, never a customer address. */
const NON_PUBLIC_HOST = /(^localhost$)|(^127\.)|(^0\.0\.0\.0$)|(\.local$)|(^id-preview--)|(-dev\.lovable\.app$)|(^project--)/i;

export function isPublicOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return !NON_PUBLIC_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, "");
  }
}

/**
 * Picks the address customers must be sent to.
 *
 * Order: an explicitly configured production origin always wins, then the
 * origin the request actually arrived on when that is a real public address,
 * and only then the caller's suggestion (kept so a self-hosted deployment
 * without configuration still works).
 */
export function resolvePublicOrigin(input: {
  configured?: string | null;
  request?: string | null;
  suggested?: string | null;
}): string {
  for (const candidate of [input.configured, input.request, input.suggested]) {
    if (isPublicOrigin(candidate)) return normalizeOrigin(candidate!);
  }
  const fallback = input.request || input.suggested || "";
  return fallback ? normalizeOrigin(fallback) : "";
}

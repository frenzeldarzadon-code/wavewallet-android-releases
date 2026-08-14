/**
 * Product feature flags.
 *
 * The Social Community and private Messages/DM features live in the Universe
 * layer — the global space above every ecosystem. Financial data stays
 * ecosystem-scoped; only identity and community are global.
 */
export const SOCIAL_ENABLED = true;

/** Canonical Universe destinations. */
export const UNIVERSE_PATHS = {
  feed: "/universe",
  messages: "/universe/messages",
  shops: "/universe/shops",
  profile: "/universe/profile",
} as const;

/** Legacy per-console paths that now redirect into the Universe. */
export const SOCIAL_PATHS = [
  "/app/social",
  "/app/messages",
  "/reseller/social",
  "/reseller/messages",
  "/admin/social",
] as const;

export function isSocialPath(path: string): boolean {
  return (SOCIAL_PATHS as readonly string[]).includes(path);
}

/**
 * Product feature flags.
 *
 * The Social Community and private Messages/DM features are complete and their
 * data is fully preserved in the database — they are simply switched off in the
 * live UI for now. Flipping `SOCIAL_ENABLED` back to `true` restores the
 * navigation entries and pages with no data loss and no migration.
 */
export const SOCIAL_ENABLED = false;

/** Paths that only make sense while the social layer is switched on. */
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

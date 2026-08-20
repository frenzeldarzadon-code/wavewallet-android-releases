import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Superseded by the single Approvals page, which already shows the same
 * platform-wide new-member queue. Kept as a redirect so old links and
 * bookmarks keep working — no functionality is removed.
 */
export const Route = createFileRoute("/super/applications")({
  beforeLoad: () => {
    throw redirect({ to: "/super/approvals" });
  },
});

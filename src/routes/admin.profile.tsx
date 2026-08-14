import { createFileRoute, redirect } from "@tanstack/react-router";

/** The global profile lives in the Universe; shop consoles keep only shop data. */
export const Route = createFileRoute("/admin/profile")({
  beforeLoad: () => {
    throw redirect({ to: "/universe/profile", replace: true });
  },
});

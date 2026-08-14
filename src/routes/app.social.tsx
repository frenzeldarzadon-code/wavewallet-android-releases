import { createFileRoute, redirect } from "@tanstack/react-router";

/** Community now lives in the Universe, above every ecosystem. */
export const Route = createFileRoute("/app/social")({
  beforeLoad: () => {
    throw redirect({ to: "/universe", replace: true });
  },
});

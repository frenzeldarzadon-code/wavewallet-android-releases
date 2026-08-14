import { createFileRoute, redirect } from "@tanstack/react-router";

/** Direct messages are Universe-level and private to their two participants. */
export const Route = createFileRoute("/reseller/messages")({
  beforeLoad: () => {
    throw redirect({ to: "/universe/messages", replace: true });
  },
});

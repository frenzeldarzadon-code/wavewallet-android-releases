import { createFileRoute, redirect } from "@tanstack/react-router";

/** Redeeming points is a customer feature — Universe Reward Shops owns it now. */
export const Route = createFileRoute("/reseller/rewards")({
  beforeLoad: () => {
    throw redirect({ to: "/universe/rewards", replace: true });
  },
});

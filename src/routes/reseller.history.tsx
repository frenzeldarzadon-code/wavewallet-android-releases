import { createFileRoute, redirect } from "@tanstack/react-router";

/** Consolidated into the Wallet Center — kept so old links keep working. */
export const Route = createFileRoute("/reseller/history")({
  beforeLoad: () => {
    throw redirect({ to: "/reseller/wallet" });
  },
});

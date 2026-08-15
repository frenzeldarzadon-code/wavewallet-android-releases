import { createFileRoute, redirect } from "@tanstack/react-router";

/** Consolidated into the Wallet Center — kept so old links keep working. */
export const Route = createFileRoute("/app/history")({
  beforeLoad: () => {
    throw redirect({ to: "/app" });
  },
});

/**
 * Retired customer Status Check.
 *
 * Customers now use Live Voucher Monitoring, which reads the same controller
 * but keeps a persistent, customer-scoped list. Old links land there; the
 * reseller and admin Status Check screens are untouched.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/app/omada")({
  beforeLoad: ({ search }) => {
    const code = (search as { code?: unknown } | undefined)?.code;
    throw redirect({
      to: "/app/monitor",
      search: typeof code === "string" && code ? { code } : {},
    });
  },
});

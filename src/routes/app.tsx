/**
 * Legacy per-shop customer console.
 *
 * Universe is now the customer portal, so a customer who lands anywhere under
 * /app is sent to the matching Universe destination. The shell still renders
 * for an authorized operator acting as a customer (support/delegation), which
 * is a management flow, not a customer one.
 */
import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { customerBottomNav, customerNav, withBadges } from "@/lib/navigation";
import { useMemberInbox } from "@/components/member-inbox-panel";
import { universeDestinationFor } from "@/lib/customer-portal";

export const Route = createFileRoute("/app")({
  validateSearch: (search: Record<string, unknown>): { code?: string | undefined } => ({
    code: typeof search["code"] === "string" && search["code"] ? search["code"] : undefined,
  }),
  component: CustomerLayout,
});

function CustomerLayout() {
  const session = useSession("customer");
  const { pending } = useMemberInbox();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { code } = Route.useSearch();

  const account = session.account;
  const redirectCustomer = session.ready && !!account && account.role === "customer" && !session.actingAs;
  useEffect(() => {
    if (!redirectCustomer) return;
    const dest = universeDestinationFor(pathname, {
      shopId: session.ecosystemDbId,
      shopSlug: session.ecosystem?.slug ?? null,
      code: code ?? null,
    });
    void navigate({
      to: dest.to as never,
      params: dest.params as never,
      search: dest.search as never,
      replace: true,
    });
  }, [redirectCustomer, pathname, code, navigate, session.ecosystemDbId, session.ecosystem?.slug]);

  if (!account || !session.ecosystem || redirectCustomer) return null;
  return (
    <AppShell
      session={session}
      nav={withBadges(customerNav(), { "/app/applications": pending })}
      bottomNav={customerBottomNav}
      title={session.ecosystem.name}
      subtitle={`Hi, ${account.name.split(" ")[0]}`}
    >
      <Outlet />
    </AppShell>
  );
}

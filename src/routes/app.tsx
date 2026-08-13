import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { customerBottomNav, customerNav } from "@/lib/navigation";

export const Route = createFileRoute("/app")({
  component: CustomerLayout,
});

function CustomerLayout() {
  const session = useSession("customer");
  if (!session.account || !session.ecosystem) return null;
  return (
    <AppShell
      session={session}
      nav={customerNav()}
      bottomNav={customerBottomNav}
      title={session.ecosystem.name}
      subtitle={`Hi, ${session.account.name.split(" ")[0]}`}
    >
      <Outlet />
    </AppShell>
  );
}

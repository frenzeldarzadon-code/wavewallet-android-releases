import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { adminBottomNav, adminNav, withBadges } from "@/lib/navigation";
import { useMemberInbox } from "@/components/member-inbox-panel";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const session = useSession("admin");
  const { pending } = useMemberInbox();

  // Never render a blank screen: the session resolves asynchronously, and an
  // admin whose active shop is not resolved yet gets a readable state instead.
  if (!session.ready) return <ConsoleNotice title="Loading your console…" />;
  if (!session.account) return null;
  if (!session.ecosystem) {
    return (
      <ConsoleNotice
        title="No active shop selected"
        body="Your admin membership is not currently the active shop for this login. Open the Universe shops page to switch back into your shop."
      />
    );
  }


  const nav = withBadges(adminNav(), { "/admin/applications": pending });
  return (
    <AppShell
      session={session}
      nav={nav}
      bottomNav={adminBottomNav}
      title={session.ecosystem.name}
      subtitle="Admin console"
    >
      <Outlet />
    </AppShell>
  );
}

/** Readable fallback while the console has no shop context to render yet. */
function ConsoleNotice({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-6">
      <div className="max-w-sm text-center">
        <p className="text-base font-semibold">{title}</p>
        {body ? <p className="mt-2 text-sm text-muted-foreground">{body}</p> : null}
      </div>
    </div>
  );
}


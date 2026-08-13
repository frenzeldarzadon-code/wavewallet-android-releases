import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  Gift,
  History,
  MessageSquare,
  Send,
  ShoppingBag,
  User,
  Users,
  Wallet,
} from "lucide-react";
import { AppShell, type NavItem } from "@/components/app-shell";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/app")({
  component: CustomerLayout,
});

const nav: NavItem[] = [
  { to: "/app", label: "Wallet", icon: Wallet },
  { to: "/app/shop", label: "Voucher shop", icon: ShoppingBag },
  { to: "/app/rewards", label: "Rewards", icon: Gift },
  { to: "/app/social", label: "Community", icon: Users },
  { to: "/app/messages", label: "Messages", icon: MessageSquare },
  { to: "/app/transfer", label: "Transfer", icon: Send },
  { to: "/app/history", label: "History", icon: History },
  { to: "/app/profile", label: "My profile", icon: User },
];

const bottomNav: NavItem[] = [
  { to: "/app", label: "Wallet", icon: Wallet },
  { to: "/app/shop", label: "Shop", icon: ShoppingBag },
  { to: "/app/social", label: "Community", icon: Users },
  { to: "/app/messages", label: "Messages", icon: MessageSquare },
  { to: "/app/profile", label: "Profile", icon: User },
];

function CustomerLayout() {
  const session = useSession("customer");
  if (!session.account || !session.ecosystem) return null;
  return (
    <AppShell
      session={session}
      nav={nav}
      bottomNav={bottomNav}
      title={session.ecosystem.name}
      subtitle={`Hi, ${session.account.name.split(" ")[0]}`}
    >
      <Outlet />
    </AppShell>
  );
}

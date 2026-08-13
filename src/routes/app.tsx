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
import { SOCIAL_ENABLED } from "@/lib/features";

export const Route = createFileRoute("/app")({
  component: CustomerLayout,
});

const socialNav: NavItem[] = [
  { to: "/app/social", label: "Community", icon: Users },
  { to: "/app/messages", label: "Messages", icon: MessageSquare },
];

const nav: NavItem[] = [
  { to: "/app", label: "Wallet", icon: Wallet },
  { to: "/app/shop", label: "Voucher shop", icon: ShoppingBag },
  { to: "/app/rewards", label: "Rewards", icon: Gift },
  ...(SOCIAL_ENABLED ? socialNav : []),
  { to: "/app/transfer", label: "Transfer", icon: Send },
  { to: "/app/history", label: "History", icon: History },
  { to: "/app/profile", label: "My profile", icon: User },
];

const bottomNav: NavItem[] = [
  { to: "/app", label: "Wallet", icon: Wallet },
  { to: "/app/shop", label: "Shop", icon: ShoppingBag },
  ...(SOCIAL_ENABLED
    ? socialNav.map((i) => ({ ...i, label: i.label === "Community" ? "Community" : "Messages" }))
    : [
        { to: "/app/rewards", label: "Rewards", icon: Gift } as NavItem,
        { to: "/app/history", label: "History", icon: History } as NavItem,
      ]),
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

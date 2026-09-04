import { createFileRoute } from "@tanstack/react-router";
import { Search, Store, Users } from "lucide-react";
import { UniverseShell } from "@/components/universe/universe-shell";
import { UniverseShopDiscovery } from "@/components/universe/universe-shop-discovery";
import { MemberDirectory } from "@/components/universe/member-directory";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/universe/search")({
  head: () => ({
    meta: [
      { title: "Search — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Search Universe shops and voucher names, then pick an authorized seller and open their storefront.",
      },
      { property: "og:title", content: "Search — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Find Universe shops, vouchers, sellers and members.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseSearch,
});

function UniverseSearch() {
  const session = useSession();
  return (
    <UniverseShell title="Search" subtitle="Shops, vouchers, sellers and members">
      <div className="space-y-4 px-4 sm:px-0">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">
              <Search className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight">
                How buying works in the Universe
              </h2>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sm text-muted-foreground">
                <li>Search a shop or a voucher name.</li>
                <li>Choose one of that shop's authorized sellers.</li>
                <li>Buy from the seller's storefront with your global Universe wallet.</li>
              </ol>
            </div>
          </div>
        </section>

        <Tabs defaultValue="shops">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="shops" className="gap-1.5">
              <Store className="size-4" /> Shops &amp; vouchers
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-1.5">
              <Users className="size-4" /> Members
            </TabsTrigger>
          </TabsList>
          <TabsContent value="shops" className="mt-3">
            <UniverseShopDiscovery />
          </TabsContent>
          <TabsContent value="members" className="mt-3">
            <MemberDirectory />
          </TabsContent>
        </Tabs>
      </div>
    </UniverseShell>
  );
}

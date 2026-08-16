import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MembersDirectory } from "@/components/super/members-directory";
import { InviteMemberCard } from "@/components/invite-member-card";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageSection } from "@/components/ui-kit";
import { fetchEcosystemNames } from "@/lib/credit-management";

export const Route = createFileRoute("/super/members")({
  head: () => ({
    meta: [
      { title: "Shop Members — WaveWallet Super Admin" },
      { name: "description", content: "Browse every account across all shops with balances, roles, account access and manual coin." },
      { property: "og:title", content: "Shop Members — WaveWallet Super Admin" },
      { property: "og:description", content: "Browse every account across all shops with balances, roles, account access and manual coin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperMembers,
});

function SuperMembers() {
  const [shops, setShops] = useState<Map<string, string>>(new Map());
  const [shopId, setShopId] = useState("");

  useEffect(() => {
    void fetchEcosystemNames().then(setShops).catch(() => undefined);
  }, []);

  const options = useMemo(() => [...shops.entries()], [shops]);

  return (
    <>
      <MembersDirectory />

      <PageSection
        title="Invite into a shop"
        description="Pick the shop the invitation is for, then search the Universe directory. The invited member still has to accept."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-1.5">
            <Label htmlFor="invite-shop">Shop</Label>
            <Select value={shopId} onValueChange={setShopId}>
              <SelectTrigger id="invite-shop" className="h-11">
                <SelectValue placeholder="Choose a shop" />
              </SelectTrigger>
              <SelectContent>
                {options.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </PageSection>

      <InviteMemberCard ecosystemId={shopId || null} />
    </>
  );
}

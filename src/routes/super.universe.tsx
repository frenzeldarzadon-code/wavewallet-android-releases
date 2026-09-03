import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { UniverseUsersCard } from "@/components/super/universe-users-card";
import { fetchEcosystemNames } from "@/lib/credit-management";

export const Route = createFileRoute("/super/universe")({
  head: () => ({
    meta: [
      { title: "Universe Users — ONE WAVE Super Admin" },
      {
        name: "description",
        content:
          "Universe members who belong to no shop yet: assign them to a shop as a customer, or remove an account that holds no coins and no pending money.",
      },
      { property: "og:title", content: "Universe Users — ONE WAVE Super Admin" },
      {
        property: "og:description",
        content: "Assign shop-less Universe members to a shop, or safely remove empty accounts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperUniverseUsers,
});

function SuperUniverseUsers() {
  const [shops, setShops] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void fetchEcosystemNames().then(setShops).catch(() => undefined);
  }, []);

  const options = useMemo(
    () => [...shops.entries()].map(([id, name]) => ({ id, name })),
    [shops],
  );

  return <UniverseUsersCard shops={options} />;
}

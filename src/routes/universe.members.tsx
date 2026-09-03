import { createFileRoute } from "@tanstack/react-router";
import { MemberDirectory } from "@/components/universe/member-directory";
import { UniverseShell } from "@/components/universe/universe-shell";

export const Route = createFileRoute("/universe/members")({
  head: () => ({
    meta: [
      { title: "Find Members — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Search the ONE WAVE Universe for members by name or @handle, and narrow by province, city or municipality and barangay.",
      },
      { property: "og:title", content: "Find Members — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Search Universe members by name, @handle or area.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseMembers,
});

function UniverseMembers() {
  return (
    <UniverseShell title="Members" subtitle="Find anyone in the Universe">
      <div className="px-4 sm:px-0">
        <MemberDirectory />
      </div>
    </UniverseShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { Hash } from "lucide-react";
import { SocialPage } from "@/components/social/social-page";
import { UniverseShell } from "@/components/universe/universe-shell";

/** Posts carrying one hashtag — the destination every #tag in the feed links to. */
export const Route = createFileRoute("/universe/tag/$tag")({
  head: ({ params }) => ({
    meta: [
      { title: `#${params.tag} — ONE WAVE Universe` },
      {
        name: "description",
        content: `Universe posts tagged #${params.tag} across the ONE WAVE community.`,
      },
      { property: "og:title", content: `#${params.tag} — ONE WAVE Universe` },
      { property: "og:description", content: `Community posts tagged #${params.tag}.` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseTag,
});

function UniverseTag() {
  const { tag } = Route.useParams();
  const clean = tag.replace(/^#+/, "").toLowerCase();
  return (
    <UniverseShell title={`#${clean}`} subtitle="Posts with this hashtag">
      <div className="space-y-4">
        <div className="px-4 sm:px-0">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary">
              <Hash className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight">#{clean}</h1>
              <p className="text-xs text-muted-foreground">
                Everything the Universe shared with this tag, newest first.
              </p>
            </div>
          </div>
        </div>
        <SocialPage hashtag={clean} />
      </div>
    </UniverseShell>
  );
}

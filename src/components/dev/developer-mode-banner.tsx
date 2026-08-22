/**
 * "Developer Mode Active" indicator. Visible only to a Super Admin who turned
 * Developer Mode on; ordinary members never render it.
 */
import { Link } from "@tanstack/react-router";
import { Code2 } from "lucide-react";

export function DeveloperModeBanner({ inspecting }: { inspecting?: string }) {
  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-primary px-4 py-2 text-primary-foreground">
      <div className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
        <Code2 className="size-4 shrink-0" />
        <span>
          Developer Mode Active — layout changes apply to the whole role
          {inspecting ? ` (inspecting ${inspecting})` : ""}
        </span>
      </div>
      <Link
        to="/super/developer"
        className="inline-flex items-center gap-1.5 rounded-full bg-background/15 px-3 py-1 text-xs font-semibold hover:bg-background/25"
      >
        Open manager
      </Link>
    </div>
  );
}

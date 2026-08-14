import { Link } from "@tanstack/react-router";
import { parseMentions, profilePath } from "@/lib/mentions";
import { cn } from "@/lib/utils";

/**
 * Post/comment body with clickable @handle mentions. Mentions link to the
 * mentioned member's public Universe profile; everything else stays plain text.
 */
export function MentionText({ body, className }: { body: string; className?: string }) {
  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm", className)}>
      {parseMentions(body).map((seg, i) =>
        seg.kind === "mention" ? (
          <Link
            key={`${seg.handle}-${i}`}
            to="/universe/u/$handle"
            params={{ handle: seg.handle }}
            className="font-medium text-primary hover:underline"
          >
            @{seg.handle}
          </Link>
        ) : (
          <span key={`t-${i}`}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

/** Compact author row: avatar + name + clickable unique @handle. */
export function handleHref(handle: string): string {
  return profilePath(handle);
}

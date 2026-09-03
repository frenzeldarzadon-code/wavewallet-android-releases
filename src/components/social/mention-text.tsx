import { Link } from "@tanstack/react-router";
import { parseMentions } from "@/lib/mentions";
import { cn } from "@/lib/utils";

/**
 * Post/comment body with clickable @handle mentions and #hashtags. Mentions
 * link to the member's public Universe profile, hashtags to the Universe tag
 * page; everything else stays plain text.
 */
export function MentionText({
  body,
  className,
  linkClassName,
}: {
  body: string;
  className?: string;
  /** Overrides link colour, e.g. on a styled background. */
  linkClassName?: string;
}) {
  const link = cn("font-medium text-primary hover:underline", linkClassName);
  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm", className)}>
      {parseMentions(body).map((seg, i) =>
        seg.kind === "mention" ? (
          <Link
            key={`${seg.handle}-${i}`}
            to="/universe/u/$handle"
            params={{ handle: seg.handle }}
            className={link}
          >
            @{seg.handle}
          </Link>
        ) : seg.kind === "hashtag" ? (
          <Link
            key={`${seg.tag}-${i}`}
            to="/universe/tag/$tag"
            params={{ tag: seg.tag }}
            className={link}
          >
            #{seg.tag}
          </Link>
        ) : (
          <span key={`t-${i}`}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

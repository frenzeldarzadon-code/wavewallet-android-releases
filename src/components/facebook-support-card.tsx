import { Facebook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { facebookLabel, isFacebookUrl } from "@/lib/facebook";

interface Props {
  /** Raw URL from the ecosystem or platform settings — may be empty/invalid. */
  url: string | null | undefined;
  pageName?: string | null;
  title?: string;
  message?: string;
  /** Shown when nothing is configured. */
  emptyHint?: string;
}

/**
 * Read-only "Contact us on Facebook" card. Renders a sensible fallback instead of
 * a broken link when the page has not been configured yet.
 */
export function FacebookSupportCard({
  url,
  pageName,
  title = "Contact us",
  message,
  emptyHint = "No Facebook support page has been set yet. Please reach out through your usual contact.",
}: Props) {
  const raw = (url ?? "").trim();
  const href = isFacebookUrl(raw) ? raw : "";
  const label = href ? facebookLabel(href, pageName) : "";

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Facebook className="size-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
        {href ? (
          <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
            <a href={href} target="_blank" rel="noreferrer noopener">
              <Facebook className="size-4" /> Contact us on Facebook
              {label ? ` · ${label}` : ""}
            </a>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        )}
      </CardContent>
    </Card>
  );
}

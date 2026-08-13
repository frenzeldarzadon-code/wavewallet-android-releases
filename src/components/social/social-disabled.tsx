/**
 * Placeholder used while the Social Community and Messages features are
 * switched off. It never links anywhere broken — the navigation entries are
 * removed too, so this only appears if someone types the URL directly.
 */
import { Link } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function SocialDisabled({ backTo }: { backTo: "/app" | "/reseller" | "/admin" }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <MessagesSquare className="size-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold">Community is temporarily unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The community feed and messages are switched off for now. Nothing has been deleted —
            posts, replies and conversations are preserved for when they are turned back on.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={backTo}>Back to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

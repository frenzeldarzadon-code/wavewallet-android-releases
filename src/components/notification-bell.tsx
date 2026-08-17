/**
 * Header bell: unread count plus the most recent alerts.
 *
 * Reads only the signed-in person's own notifications. It never shows a
 * balance and never decides anything about a transaction — the wording comes
 * from the server, after the money movement was committed.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fetchNotifications, markRead, notificationLink, type Notification } from "@/lib/notifications";

function when(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    void fetchNotifications(15)
      .then(setRows)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const unread = rows.filter((r) => !r.read_at).length;

  const openRow = async (n: Notification) => {
    setOpen(false);
    if (!n.read_at) {
      await markRead([n.id]).catch(() => undefined);
      setRows((rs) =>
        rs.map((r) => (r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)),
      );
    }
    void navigate({ to: notificationLink(n) });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", className)}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-4.5" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <Link
            to="/universe/notifications"
            onClick={() => setOpen(false)}
            className="text-xs font-medium text-primary"
          >
            See all
          </Link>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet</p>
          ) : (
            rows.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void openRow(n)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/60",
                  !n.read_at && "bg-accent/40",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    n.read_at ? "bg-transparent" : "bg-primary",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  {n.body ? (
                    <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                  ) : null}
                  <span className="block text-[11px] text-muted-foreground">
                    {when(n.created_at)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

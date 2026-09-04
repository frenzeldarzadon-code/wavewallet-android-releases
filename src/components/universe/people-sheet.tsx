/**
 * "People" bottom sheet — pick any Universe member without leaving the page.
 *
 * Two sources, one list:
 *   • Online / recently active members (member_presence via
 *     `universe_online_members`) — online first, then most recent.
 *   • Universe-wide name/@handle search (`universe_directory`) for anyone else.
 *
 * No shop scoping: the Universe IS the customer portal. Presence is the same
 * mechanism the seller list uses (`presenceLabel`), never fabricated.
 */
import { Loader2, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MemberAvatar } from "@/components/member-avatar";
import { cn } from "@/lib/utils";
import { displayHandle } from "@/lib/profile";
import { presenceLabel, presenceTone, PRESENCE_HEARTBEAT_MS } from "@/lib/presence";
import { fetchOnlineMembers, type OnlineMember } from "@/lib/universe-social";
import { searchDirectory, EMPTY_FILTERS } from "@/lib/universe-directory";

export interface PersonRow {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  online: boolean;
  lastSeenAt: string | null;
}

/** Green dot for online, amber for the last hour, muted otherwise. */
export function PresenceDot({ person, className }: { person: PersonRow; className?: string }) {
  const tone = presenceTone(person);
  return (
    <span
      aria-hidden
      className={cn(
        "absolute bottom-0 right-0 size-3 rounded-full border-2 border-card",
        tone === "online"
          ? "bg-success"
          : tone === "recent"
            ? "bg-warning"
            : "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

export function PersonListItem({
  person,
  onClick,
  trailing,
  now,
}: {
  person: PersonRow;
  onClick?: () => void;
  trailing?: ReactNode;
  now?: Date;
}) {
  const label = presenceLabel(person, now);
  const body = (
    <>
      <span className="relative shrink-0">
        <MemberAvatar path={person.avatar_path} name={person.full_name} className="size-10" />
        <PresenceDot person={person} />
      </span>
      <span className="min-w-0 flex-1 text-left leading-tight">
        <span className="block truncate text-sm font-semibold">{person.full_name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {displayHandle(person.handle) ?? "Member"}
          {" · "}
          <span className={person.online ? "font-medium text-success" : undefined}>{label}</span>
        </span>
      </span>
      {trailing}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent/50"
    >
      {body}
    </button>
  ) : (
    <div className="flex min-h-14 w-full items-center gap-3 px-4 py-2">{body}</div>
  );
}

/** Live "now" so labels like "Online 3 min ago" keep ticking while the sheet is open. */
export function useTicker(active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), PRESENCE_HEARTBEAT_MS);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** Loads presence-ordered members; refreshes each heartbeat while active. */
export function useOnlineMembers(active: boolean) {
  const [rows, setRows] = useState<OnlineMember[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () =>
      void fetchOnlineMembers()
        .then((r) => alive && setRows(r))
        .catch((e: Error) => {
          if (alive) {
            setRows([]);
            toast.error("Could not load who is online", { description: e.message });
          }
        });
    load();
    const t = window.setInterval(load, PRESENCE_HEARTBEAT_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [active]);
  return rows;
}

/** Debounced Universe-wide name/@handle search (2+ characters). */
export function usePeopleSearch(query: string) {
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRows(null);
      setBusy(false);
      return;
    }
    let alive = true;
    setBusy(true);
    const t = window.setTimeout(() => {
      void searchDirectory({ ...EMPTY_FILTERS, query: q }, 30)
        .then(
          (r) =>
            alive &&
            setRows(
              r.map((m) => ({
                id: m.id,
                full_name: m.full_name,
                handle: m.handle,
                avatar_path: m.avatar_path,
                online: false,
                lastSeenAt: null,
              })),
            ),
        )
        .catch((e: Error) => alive && toast.error("Search failed", { description: e.message }))
        .finally(() => alive && setBusy(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query]);
  return { rows, busy };
}

export function PeopleSheet({
  open,
  onOpenChange,
  title = "People",
  description = "Online members first. Search anyone in the Universe by name or @handle.",
  onSelect,
  trailing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  description?: string;
  onSelect?: (person: PersonRow) => void;
  /** Optional per-row action (e.g. Add friend). */
  trailing?: (person: PersonRow) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const now = useTicker(open);
  const online = useOnlineMembers(open);
  const search = usePeopleSearch(query);

  // Merge presence into search results where we know it.
  const presenceById = useMemo(() => new Map((online ?? []).map((m) => [m.id, m])), [online]);
  const searched = useMemo(
    () =>
      search.rows?.map((p) => {
        const known = presenceById.get(p.id);
        return known ? { ...p, online: known.online, lastSeenAt: known.lastSeenAt } : p;
      }) ?? null,
    [search.rows, presenceById],
  );

  const onlineNow = (online ?? []).filter((m) => m.online);
  const recent = (online ?? []).filter((m) => !m.online);

  const section = (heading: string, list: PersonRow[]) =>
    list.length === 0 ? null : (
      <section aria-label={heading}>
        <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {heading} · {list.length}
        </p>
        <div className="divide-y divide-border">
          {list.map((p) => (
            <PersonListItem
              key={p.id}
              person={p}
              now={now}
              {...(onSelect ? { onClick: () => onSelect(p) } : {})}
              {...(trailing ? { trailing: trailing(p) } : {})}
            />
          ))}
        </div>
      </section>
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[88vh] flex-col rounded-t-2xl p-0">
        <SheetHeader className="border-b border-border px-4 pb-3 pt-4 text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
          <div className="relative pt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or @handle"
              className="h-11 pl-9 text-base"
              autoCapitalize="none"
              autoCorrect="off"
              aria-label="Search Universe members"
            />
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {query.trim().length >= 2 ? (
            search.busy && !searched ? (
              <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Searching…
              </p>
            ) : searched && searched.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Users className="size-4" /> No members match “{query.trim()}”.
              </p>
            ) : (
              section("Results", searched ?? [])
            )
          ) : online === null ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking who is around…
            </p>
          ) : online.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Nobody has been active in the last 7 days. Search by name or @handle instead.
            </p>
          ) : (
            <>
              {section("Online now", onlineNow)}
              {section("Recently active", recent)}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

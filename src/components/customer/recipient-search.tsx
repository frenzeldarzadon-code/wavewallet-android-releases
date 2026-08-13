/**
 * Type-ahead recipient picker for credit transfers.
 *
 * Matches by name, @handle, email or phone. Visibility and authorization are
 * decided by `lookup_transfer_recipient` in the database — this component only
 * debounces, ranks the returned matches nearest-first and shows enough identity
 * to pick the right person.
 */
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MemberAvatar } from "@/components/member-avatar";
import { cn } from "@/lib/utils";
import { lookupRecipient, type RecipientMatch } from "@/lib/wallet";
import {
  MIN_RECIPIENT_QUERY,
  rankRecipients,
  recipientIdentityLine,
} from "@/lib/recipient-search";

export function RecipientSearch({
  selected,
  onSelect,
}: {
  selected: RecipientMatch | null;
  onSelect: (match: RecipientMatch | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<RecipientMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_RECIPIENT_QUERY) {
      setMatches([]);
      setSearched(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await lookupRecipient(term);
        if (cancelled) return;
        setMatches(rankRecipients(rows, term));
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSearched(true);
        }
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="space-y-2">
      <Label htmlFor="recipient-query">Recipient</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="recipient-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, @handle, email or mobile"
          className="h-11 pl-9"
          autoComplete="off"
          aria-label="Search recipients by name, handle, email or phone"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {matches.length > 0 ? (
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-1">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  selected?.id === m.id ? "bg-brand-soft" : "hover:bg-muted",
                )}
              >
                <MemberAvatar path={m.avatar_path ?? null} name={m.full_name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.full_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {recipientIdentityLine(m)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && searched && matches.length === 0 && !error ? (
        <p className="text-xs text-muted-foreground">
          No member of your shop matches that name, handle, email or mobile.
        </p>
      ) : null}
    </div>
  );
}

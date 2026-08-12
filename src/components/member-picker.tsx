/**
 * Recipient picker for admin credit / points actions.
 *
 * Searches by name, email or phone through the `search_members` RPC, which
 * scopes results in the database: an admin only ever sees their own shop, the
 * platform owner sees every shop and each row shows which shop it belongs to.
 * Each result shows enough identity to avoid crediting the wrong person.
 */
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui-kit";
import {
  MIN_SEARCH_LENGTH,
  searchMembers,
  type MemberSearchResult,
} from "@/lib/member-admin";
import { peso, roleLabel, type Role } from "@/lib/wavewallet";

interface Props {
  /** Pin the search to one shop (admins are pinned server-side regardless). */
  ecosystemId?: string | null;
  /** Show the shop name on each row — used by the platform owner. */
  showEcosystem?: boolean;
  placeholder?: string;
  onSelect: (member: MemberSearchResult) => void;
}

export function MemberPicker({
  ecosystemId,
  showEcosystem = false,
  placeholder = "Search by name, email or phone",
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchMembers(term, ecosystemId ?? null);
        if (!cancelled) {
          setResults(rows);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, ecosystemId]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
          aria-label="Search members"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {query.trim().length > 0 && query.trim().length < MIN_SEARCH_LENGTH ? (
        <p className="text-xs text-muted-foreground">
          Type at least {MIN_SEARCH_LENGTH} characters to search.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m)}
                className="flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.full_name}</span>
                  <StatusBadge tone={m.status === "active" ? "success" : "danger"}>
                    {roleLabel(m.role as Role)}
                  </StatusBadge>
                  {showEcosystem && m.ecosystem_name ? (
                    <span className="text-xs text-muted-foreground">{m.ecosystem_name}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {m.email} · {m.phone}
                </span>
                <span className="text-xs text-muted-foreground">
                  Balance {peso(m.credit_balance)} · {m.points_balance} pts
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && query.trim().length >= MIN_SEARCH_LENGTH && results.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">No matching member found.</p>
      ) : null}
    </div>
  );
}

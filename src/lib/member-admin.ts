/**
 * Admin / Super Admin member administration.
 *
 * Two capabilities live here:
 *  1. `searchMembers` — identity search used when picking a credit recipient.
 *     Scope is decided in the database (`search_members` is SECURITY DEFINER):
 *     an admin can only ever see their own ecosystem, the platform owner sees
 *     every shop and the shop name comes back with each row.
 *  2. Validation helpers for the profile editor. The real authorization and
 *     uniqueness checks are enforced by `admin_update_member_profile`; the
 *     helpers below only give fast, friendly feedback in the UI.
 *
 * Nothing here touches credits, points, commissions, discounts or reversals.
 */
import { supabase } from "@/integrations/supabase/client";

export interface MemberSearchResult {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  email: string;
  phone: string;
  masked_email: string;
  status: string;
  role: string;
  ecosystem_id: string | null;
  ecosystem_name: string | null;
  credit_balance: number;
  points_balance: number;
}

/** Shortest query the database will answer — keeps the picker from listing everyone. */
export const MIN_SEARCH_LENGTH = 2;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const isValidEmail = (email: string) => EMAIL_RE.test(normalizeEmail(email));

/** Digits-only form used for forgiving phone matching. */
export const digitsOf = (value: string) => value.replace(/[^0-9]/g, "");

/**
 * Client-side mirror of the database matcher — case-insensitive, partial match
 * on name, @handle, email or phone. Used to filter an already-loaded list
 * instantly while the server search debounces.
 */
export function memberMatches(
  member: Pick<MemberSearchResult, "full_name" | "email" | "phone"> & {
    handle?: string | null;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = digitsOf(q);
  const handleQuery = q.replace(/^@+/, "");
  return (
    member.full_name.toLowerCase().includes(q) ||
    member.email.toLowerCase().includes(q) ||
    (!!member.handle && handleQuery !== "" && member.handle.toLowerCase().includes(handleQuery)) ||
    (digits !== "" && digitsOf(member.phone).includes(digits))
  );
}

/**
 * Ordering for member/customer lists.
 *
 * With no search term the list is plain A–Z. While searching, the nearest
 * authorized match comes first — exact name or @handle, then prefix matches,
 * then broader matches — with alphabetical tie-breaking. Visibility itself is
 * decided by the database; this only orders rows already returned.
 */
export function memberSortScore(
  member: Pick<MemberSearchResult, "full_name"> & { handle?: string | null },
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = member.full_name.toLowerCase();
  const handle = (member.handle ?? "").toLowerCase();
  const h = q.replace(/^@+/, "");
  if (handle && handle === h) return 0;
  if (name === q) return 1;
  if (name.startsWith(q)) return 2;
  if (handle && handle.startsWith(h)) return 3;
  if (name.includes(q)) return 4;
  return 5;
}

export function sortMembersForList<
  T extends Pick<MemberSearchResult, "full_name"> & { handle?: string | null },
>(members: T[], query: string): T[] {
  return [...members].sort((a, b) => {
    const diff = memberSortScore(a, query) - memberSortScore(b, query);
    return diff !== 0 ? diff : a.full_name.localeCompare(b.full_name);
  });
}

/**
 * A one-line, unambiguous description of a member so nobody credits the wrong
 * person: @handle, email and phone (plus the shop when searching across
 * ecosystems). Resellers only ever receive masked contact details.
 */
export function memberIdentityLine(m: MemberSearchResult, withEcosystem = false): string {
  const parts = [
    m.handle ? `@${m.handle}` : null,
    m.email || m.masked_email,
    m.phone,
  ].filter(Boolean) as string[];
  if (withEcosystem && m.ecosystem_name) parts.push(m.ecosystem_name);
  return parts.join(" · ");
}

/** What actually changed between the stored profile and the edited form. */
export interface ProfileEdit {
  fullName: string;
  phone: string;
  email: string;
}

export function diffProfile(before: ProfileEdit, after: ProfileEdit): Partial<ProfileEdit> {
  const changes: Partial<ProfileEdit> = {};
  if (after.fullName.trim() !== before.fullName.trim()) changes.fullName = after.fullName.trim();
  if (after.phone.trim() !== before.phone.trim()) changes.phone = after.phone.trim();
  if (normalizeEmail(after.email) !== normalizeEmail(before.email)) {
    changes.email = normalizeEmail(after.email);
  }
  return changes;
}

/** Returns an error message, or null when the edit is safe to submit. */
export function validateProfileEdit(edit: ProfileEdit): string | null {
  if (!edit.fullName.trim()) return "A full name is required";
  if (!edit.phone.trim()) return "A phone number is required";
  if (digitsOf(edit.phone).length < 7) return "Enter a valid phone number";
  if (!isValidEmail(edit.email)) return "Enter a valid email address";
  return null;
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

export async function searchMembers(
  query: string,
  ecosystemId?: string | null,
): Promise<MemberSearchResult[]> {
  if (query.trim().length < MIN_SEARCH_LENGTH) return [];
  const { data, error } = await supabase.rpc("search_members", {
    _query: query.trim(),
    ...(ecosystemId ? { _ecosystem_id: ecosystemId } : {}),
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MemberSearchResult[]).map((m) => ({
    ...m,
    credit_balance: Number(m.credit_balance ?? 0),
    points_balance: Number(m.points_balance ?? 0),
  }));
}

/** True when the email is already used by another live account. */
export async function emailTaken(email: string, excludeUserId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("member_email_taken", {
    _email: normalizeEmail(email),
    _exclude: excludeUserId,
  });
  if (error) return false;
  return Boolean(data);
}

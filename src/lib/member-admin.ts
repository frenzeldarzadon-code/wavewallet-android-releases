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
  email: string;
  phone: string;
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
 * on name, email or phone. Used to filter an already-loaded list instantly
 * while the server search debounces.
 */
export function memberMatches(
  member: Pick<MemberSearchResult, "full_name" | "email" | "phone">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = digitsOf(q);
  return (
    member.full_name.toLowerCase().includes(q) ||
    member.email.toLowerCase().includes(q) ||
    (digits !== "" && digitsOf(member.phone).includes(digits))
  );
}

/**
 * A one-line, unambiguous description of a member so an admin cannot credit
 * the wrong person: name, role, email and phone (plus the shop when searching
 * across ecosystems).
 */
export function memberIdentityLine(m: MemberSearchResult, withEcosystem = false): string {
  const parts = [m.email, m.phone].filter(Boolean);
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

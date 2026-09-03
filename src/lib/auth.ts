/**
 * Real authentication + tenant context, backed by the Cloud database.
 *
 * Authorization lives in the database (RLS policies + SECURITY DEFINER RPCs).
 * Everything here is read-only convenience for the UI: the client can never
 * grant itself a role, pick an ecosystem, or read another tenant's rows.
 */
import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizePhone,
  resolveLoginEmail,
  signupAuthEmail,
} from "@/lib/account-identifiers";
import { fetchActingSession, type ActingSession } from "@/lib/impersonation";
import type { Role } from "@/lib/wavewallet";

export interface DbEcosystem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_name?: string | null;
  signup_enabled: boolean;
  signup_token: string;
  plan_name: string;
  plan_price: number;
  subscription_state:
    | "pending"
    | "awaiting_approval"
    | "active"
    | "rejected"
    | "expired"
    | "suspended";
  grace_period_days: number;
  current_period_end: string | null;
  payment_reference: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  facebook_page_url?: string | null;
  facebook_page_name?: string | null;
}

export interface DbProfile {
  id: string;
  ecosystem_id: string | null;
  full_name: string;
  email: string;
  phone: string;
  status: "active" | "suspended";
  deleted_at?: string | null;
  reseller_discount_percent: number;
  reseller_id: string | null;
  joined_at: string;
}

export interface Wallets {
  credits: number;
  points: number;
  pointsHeld: number;
}

export interface AuthContext {
  userId: string;
  role: Role;
  profile: DbProfile;
  ecosystem: DbEcosystem | null;
  wallets: Wallets;
  /** True when the ecosystem may run normal operations (subscription within grace). */
  subscriptionOk: boolean;
  /**
   * Set while an authorized operator is acting as another member. The context
   * above then describes the TARGET account; the operator's own identity stays
   * here so the UI can never hide who is really signed in.
   */
  actingAs?: {
    session: ActingSession;
    operatorId: string;
    operatorName: string;
    operatorRole: Role;
  } | null;
}

/**
 * Mirrors the database `subscription_is_free()` rule: a shop the platform owner
 * priced at zero pays nothing. Demo/review shops are excluded — their price is
 * only 0 because they have not subscribed yet.
 */
export function isFreeSubscription(
  eco: Pick<DbEcosystem, "plan_price"> & { is_review?: boolean | null } | null,
): boolean {
  if (!eco) return false;
  if (eco.is_review) return false;
  return Number(eco.plan_price ?? 0) <= 0;
}

/** Mirrors the database `subscription_ok()` rule so the UI can gate without a round trip. */
export function isSubscriptionOk(eco: DbEcosystem | null): boolean {
  if (!eco) return false;
  if (eco.subscription_state !== "active") return false;
  if (!eco.current_period_end) return true;
  // A deliberately zero-priced shop owes nothing, so it never expires and is
  // never frozen for non-payment (mirrors `subscription_is_free` in the DB).
  if (isFreeSubscription(eco)) return true;
  const end = new Date(eco.current_period_end).getTime();
  return end + eco.grace_period_days * 86_400_000 > Date.now();
}

/** Loads profile + role + ecosystem for the currently signed-in user. */
export async function loadAuthContext(): Promise<AuthContext | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  // An authorized operator may be acting as one of their members. The delegation
  // itself lives in the database; here we only mirror it so the member UI renders
  // the target's account. Reads still pass through the operator's own RLS rights.
  const acting = await fetchActingSession();
  const subjectId = acting?.targetId ?? user.id;

  const [{ data: profile }, { data: roles }, { data: operatorProfile }, { data: operatorRoles }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", subjectId).maybeSingle(),
      supabase.from("user_roles").select("role, ecosystem_id").eq("user_id", subjectId),
      acting
        ? supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      acting
        ? supabase.from("user_roles").select("role").eq("user_id", user.id)
        : Promise.resolve({ data: null }),
    ]);
  if (!profile) return null;
  // A deleted (anonymised) customer keeps no access: their roles are revoked and
  // their login is banned server-side. Sign the stale session out immediately.
  if ((profile as { deleted_at?: string | null }).deleted_at) {
    await supabase.auth.signOut();
    return null;
  }

  const order: Role[] = ["super_admin", "admin", "reseller", "subreseller", "customer"];
  const role =
    order.find((r) => (roles ?? []).some((x) => x.role === r)) ?? ("customer" as Role);

  let ecosystem: DbEcosystem | null = null;
  const ecosystemId =
    profile.ecosystem_id ?? (roles ?? []).find((r) => r.ecosystem_id)?.ecosystem_id ?? null;
  if (ecosystemId) {
    const { data } = await supabase
      .from("ecosystems")
      .select("*")
      .eq("id", ecosystemId)
      .maybeSingle();
    ecosystem = (data as DbEcosystem | null) ?? null;
  }

  const [{ data: credit }, { data: points }, { data: status }] = await Promise.all([
    // The wallet that serves the ACTIVE shop: the database decides — global
    // Universe wallet for Universe shops, shop wallet for New Generation shops.
    supabase
      .rpc("wallet_view", {
        _user_id: subjectId,
        ...(ecosystemId ? { _ecosystem_id: ecosystemId } : {}),
      })
      .then((r) => ({ data: (r.data as { balance: number }[] | null)?.[0] ?? null })),
    ecosystemId
      ? supabase
          .from("points_accounts")
          .select("balance, held")
          .eq("user_id", subjectId)
          .eq("ecosystem_id", ecosystemId)
          .maybeSingle()
      : supabase
          .from("points_accounts")
          .select("balance, held")
          .eq("user_id", subjectId)
          .is("ecosystem_id", null)
          .maybeSingle(),
    // Authoritative operational check (subscription state + period end + grace) computed
    // in the database. Used for route UX only — data access is still authorized by RLS.
    supabase.rpc("my_operational_status"),
  ]);
  const operational = Array.isArray(status) ? status[0]?.operational : undefined;

  return {
    userId: subjectId,
    role,
    profile: profile as DbProfile,
    ecosystem,
    wallets: {
      credits: Number(credit?.balance ?? 0),
      points: points?.balance ?? 0,
      pointsHeld: points?.held ?? 0,
    },
    subscriptionOk:
      role === "super_admin" ? true : (operational ?? isSubscriptionOk(ecosystem)),
    actingAs: acting
      ? {
          session: acting,
          operatorId: user.id,
          operatorName:
            (operatorProfile as { full_name?: string } | null)?.full_name ?? "Operator",
          operatorRole:
            order.find((r) => (operatorRoles ?? []).some((x) => x.role === r)) ?? "admin",
        }
      : null,
  };
}

/**
 * Sign in with an email address OR a mobile number, plus the password. The
 * identifier is translated locally — nothing is looked up, so no account can be
 * probed from the login form.
 */
export async function signInWithPassword(identifier: string, password: string) {
  requireOnline();
  const authEmail = resolveLoginEmail(identifier);
  if (!authEmail) throw new Error("Enter your email address or mobile number.");
  const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
  if (error) throw new Error(friendlyAuthError(error.message));
  return loadAuthContext();
}

export interface CustomerSignupInput {
  /** Optional: only set when signing up through a shop's /join link. */
  ecosystemSlug?: string;
  fullName: string;
  email: string;
  phone: string;
  password: string;
  /** Address to barangay level. Street and house number are optional. */
  province: string;
  cityMunicipality: string;
  barangay: string;
  street?: string;
  houseNumber?: string;
}

/**
 * Public signup. This always creates the person's ONE global account: the role
 * is decided by a database trigger and shop membership is requested separately
 * and requires approval. Email and phone are both optional individually, but at
 * least one must be present — a phone-only account authenticates through a
 * deterministic, non-deliverable address.
 */
export async function signUpCustomerAccount(input: CustomerSignupInput) {
  requireOnline();
  const { data, error } = await supabase.auth.signUp({
    email: signupAuthEmail({ email: input.email, phone: input.phone }),
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
      data: {
        full_name: input.fullName.trim(),
        phone: normalizePhone(input.phone),
        province: input.province.trim(),
        city_municipality: input.cityMunicipality.trim(),
        barangay: input.barangay.trim(),
        street: (input.street ?? "").trim(),
        house_number: (input.houseNumber ?? "").trim(),
        ...(input.ecosystemSlug ? { ecosystem_slug: input.ecosystemSlug.toLowerCase() } : {}),
      },
    },
  });
  if (error) throw new Error(friendlyAuthError(error.message));
  return { needsEmailConfirmation: !data.session };
}

/**
 * Invited operator onboarding. No ecosystem slug is sent: the database trigger
 * grants the admin role only when the signup email matches a pending, unexpired
 * invitation. A non-invited email simply cannot complete this flow.
 */
export async function signUpInvitedOperator(input: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
}) {
  requireOnline();
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
      data: { full_name: input.fullName.trim(), phone: (input.phone ?? "").trim() },
    },
  });
  if (error) throw new Error(friendlyAuthError(error.message));
  return { needsEmailConfirmation: !data.session };
}

/** Turns raw auth/database errors into wording a shop customer can act on. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("duplicate"))
    return "That email or mobile number already has an account. Sign in instead.";
  if (m.includes("valid ecosystem invite link"))
    return "This signup link is no longer active. Ask your operator for their current link.";
  // WaveWallet adds no password rules of its own; only the provider's own
  // minimum can still reject one, so show what it actually said.
  if (m.includes("password should be at least")) return "Password must contain at least 6 characters.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Please wait a minute and try again.";
  // Deliberately generic: never reveal whether the identifier exists.
  if (m.includes("invalid login credentials") || m.includes("invalid credentials"))
    return "Those sign-in details are not correct. Check and try again.";
  return message;
}


export interface SignupEcosystem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

/** Public, anonymous-safe lookup of the shop behind a /join/{slug} link. */
export async function fetchSignupEcosystem(slug: string): Promise<SignupEcosystem | null> {
  const { data, error } = await supabase.rpc("get_signup_ecosystem", { _slug: slug });
  if (error) return null;
  return (data?.[0] as SignupEcosystem | undefined) ?? null;
}

export async function signOutEverywhere() {
  await supabase.auth.signOut();
}

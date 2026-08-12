/**
 * Real authentication + tenant context, backed by the Cloud database.
 *
 * Authorization lives in the database (RLS policies + SECURITY DEFINER RPCs).
 * Everything here is read-only convenience for the UI: the client can never
 * grant itself a role, pick an ecosystem, or read another tenant's rows.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/wavewallet";

export interface DbEcosystem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  signup_enabled: boolean;
  signup_token: string;
  subscription_status: string;
  plan_name: string;
  plan_price: number;
  subscription_active_until: string | null;
}

export interface DbProfile {
  id: string;
  ecosystem_id: string | null;
  full_name: string;
  email: string;
  phone: string;
  status: "active" | "suspended";
  reseller_discount_percent: number;
  reseller_id: string | null;
  joined_at: string;
}

export interface AuthContext {
  userId: string;
  role: Role;
  profile: DbProfile;
  ecosystem: DbEcosystem | null;
}

/** Loads profile + role + ecosystem for the currently signed-in user. */
export async function loadAuthContext(): Promise<AuthContext | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role, ecosystem_id").eq("user_id", user.id),
  ]);
  if (!profile) return null;

  const order: Role[] = ["super_admin", "admin", "reseller", "customer"];
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

  return { userId: user.id, role, profile: profile as DbProfile, ecosystem };
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(error.message);
  return loadAuthContext();
}

export interface CustomerSignupInput {
  ecosystemSlug: string;
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

/**
 * Public signup. The role is decided by a database trigger (always `customer`)
 * and the ecosystem is resolved server-side from the invite slug — neither can
 * be forged from the browser.
 */
export async function signUpCustomerAccount(input: CustomerSignupInput) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      emailRedirectTo: `${window.location.origin}/`,
      data: {
        full_name: input.fullName.trim(),
        phone: input.phone.trim(),
        ecosystem_slug: input.ecosystemSlug.toLowerCase(),
      },
    },
  });
  if (error) throw new Error(error.message);
  return { needsEmailConfirmation: !data.session };
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

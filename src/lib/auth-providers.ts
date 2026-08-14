/**
 * Sign-in providers for the one global WaveWallet identity.
 *
 * A person has exactly one login identity in the Universe. Social sign-in adds
 * an *identity* to that account — it never creates a second WaveWallet user.
 * Providers that are not configured in the auth environment are reported as
 * unavailable and their buttons stay disabled; we never pretend a provider
 * works.
 */
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export type ProviderId = "google";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Configured and usable right now. */
  available: boolean;
  /** Shown to the user when `available` is false. */
  unavailableReason?: string;
}

/**
 * Google is the only social login offered. It is enabled through Lovable Cloud
 * managed social login and links to the person's existing account when the
 * verified Google email matches, so no duplicate identity is created.
 */
export const PROVIDERS: ProviderInfo[] = [{ id: "google", label: "Google", available: true }];

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? { id, label: id, available: false };
}

export interface LinkedIdentity {
  id: string;
  provider: string;
  email: string | null;
}

/** True when the account can still sign in without `provider`. */
export function hasAlternativeLogin(identities: LinkedIdentity[], provider: string): boolean {
  return identities.some((i) => i.provider !== provider);
}

/**
 * Why unlinking is not allowed, or null when it is safe.
 *
 * The rule is deliberately strict: an account must always keep at least one
 * usable way to sign in. Email/password counts as an identity of its own.
 */
export function unlinkBlockedReason(
  identities: LinkedIdentity[],
  provider: string,
): string | null {
  if (!identities.some((i) => i.provider === provider)) return "That login is not connected.";
  if (!hasAlternativeLogin(identities, provider)) {
    return "This is your only way to sign in. Connect another login first.";
  }
  return null;
}

/** Human label for an identity row. */
export function identityLabel(provider: string): string {
  if (provider === "email") return "Email & password";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

// ------------------------------------------------------------------ actions

/**
 * Start a social sign-in. Supabase matches the verified provider email to an
 * existing user, so signing in with Google after registering by email lands on
 * the same WaveWallet account instead of creating a duplicate.
 */
export async function signInWithProvider(id: ProviderId): Promise<{ redirected: boolean }> {
  const info = providerInfo(id);
  if (!info.available) throw new Error(info.unavailableReason ?? "That login is not available.");
  const result = await lovable.auth.signInWithOAuth("google", {
    redirect_uri: window.location.origin,
  });
  if ("error" in result && result.error) throw result.error;
  return { redirected: Boolean((result as { redirected?: boolean }).redirected) };
}

export async function fetchLinkedIdentities(): Promise<LinkedIdentity[]> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw new Error(error.message);
  return (data?.identities ?? []).map((i) => ({
    id: i.identity_id ?? i.id,
    provider: i.provider,
    email: (i.identity_data?.["email"] as string | undefined) ?? null,
  }));
}

export async function linkProvider(id: ProviderId): Promise<void> {
  const info = providerInfo(id);
  if (!info.available) throw new Error(info.unavailableReason ?? "That login is not available.");
  const { error } = await supabase.auth.linkIdentity({
    provider: id,
    options: { redirectTo: `${window.location.origin}/universe/profile` },
  });
  if (error) throw new Error(error.message);
}

export async function unlinkProvider(identity: LinkedIdentity): Promise<void> {
  const all = await fetchLinkedIdentities();
  const blocked = unlinkBlockedReason(all, identity.provider);
  if (blocked) throw new Error(blocked);
  const { data } = await supabase.auth.getUserIdentities();
  const target = (data?.identities ?? []).find(
    (i) => (i.identity_id ?? i.id) === identity.id,
  );
  if (!target) throw new Error("That login is not connected.");
  const { error } = await supabase.auth.unlinkIdentity(target);
  if (error) throw new Error(error.message);
}

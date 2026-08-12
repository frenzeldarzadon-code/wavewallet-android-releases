/**
 * First-time platform-owner (Super Admin) bootstrap — server only.
 *
 * SECURITY MODEL
 * - The browser never chooses a role. It can only ask the server to run the
 *   bootstrap; the `super_admin` role is granted by the database signup trigger
 *   and only when an unexpired, matching bootstrap claim exists.
 * - The claim row is a single-row table with a boolean primary key, so two
 *   concurrent bootstraps can never both succeed: the second insert violates
 *   the primary key and is rejected inside the same transaction.
 * - Passwords are never stored or logged here. The account is created through
 *   the ordinary Supabase Auth email/password signup, so Auth owns hashing,
 *   verification, confirmation emails and password resets.
 * - Demo/QA accounts are flagged (`profiles.is_demo`) and are ignored when
 *   deciding whether a real production owner already exists.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface BootstrapInput {
  fullName: string;
  email: string;
  password: string;
  origin: string;
  source: string;
}

function publicClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const url = process.env["SUPABASE_URL"]!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

/** Anonymous-safe eligibility check (also enforced again during the claim). */
export async function bootstrapAvailable(): Promise<boolean> {
  const { data, error } = await publicClient().rpc("super_admin_bootstrap_available");
  if (error) return false;
  return data === true;
}

export async function runBootstrap(
  input: BootstrapInput,
): Promise<{ needsEmailConfirmation: boolean; email: string }> {
  const email = input.email.trim().toLowerCase();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Atomic, race-safe claim. Fails if a real owner already exists or another
  // bootstrap is already in flight / completed.
  const { error: claimError } = await supabaseAdmin.rpc("claim_super_admin_bootstrap", {
    _email: email,
    _source: input.source,
  });
  if (claimError) {
    throw new Error(
      claimError.message.includes("already")
        ? "Initial Super Admin setup has already been completed."
        : claimError.message,
    );
  }

  try {
    const { data, error } = await publicClient().auth.signUp({
      email,
      password: input.password,
      options: {
        emailRedirectTo: `${input.origin}/`,
        data: { full_name: input.fullName.trim(), phone: "" },
      },
    });
    if (error) throw new Error(error.message);
    return { needsEmailConfirmation: !data.session, email };
  } catch (e) {
    // Signup failed — release the claim so setup can be retried.
    await supabaseAdmin.rpc("release_super_admin_bootstrap", { _email: email });
    throw e instanceof Error ? e : new Error("Could not create the owner account.");
  }
}

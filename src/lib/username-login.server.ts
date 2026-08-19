/**
 * Server-only helpers for username sign-in.
 *
 * Everything here runs with the service role, so it never leaves the server:
 * it resolves a username to the account behind it and throttles repeated
 * failures. Plaintext passwords are passed straight to the authentication
 * provider and are never stored, logged or returned.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Failures allowed for one username inside the window before it is locked. */
export const MAX_FAILED_ATTEMPTS = 8;
export const ATTEMPT_WINDOW_MINUTES = 15;

/** Publishable-key client used only to exchange credentials for a session. */
export function publishableClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
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

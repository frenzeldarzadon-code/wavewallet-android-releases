/**
 * Server entry points for username + password sign-in.
 *
 * This is an ADDITIONAL sign-in method: email, phone and Google logins are
 * untouched. The username never becomes the account's email — it is a separate
 * mapping, so an existing member can be given a username without losing any
 * login they already use.
 *
 * SECURITY: the browser is never told whether a username exists, plaintext
 * passwords are only ever forwarded to the authentication provider, and
 * repeated failures for the same username are throttled.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  loginPasswordIssue,
  loginUsernameIssue,
  normalizeLoginUsername,
} from "@/lib/username-login";

const GENERIC = "Incorrect username or password.";

export const signInWithUsername = createServerFn({ method: "POST" })
  .inputValidator((input: { username: string; password: string }) => {
    const username = normalizeLoginUsername(input?.username ?? "");
    const password = input?.password ?? "";
    if (!username || !password) throw new Error(GENERIC);
    return { username, password };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { publishableClient, MAX_FAILED_ATTEMPTS, ATTEMPT_WINDOW_MINUTES } = await import(
      "@/lib/username-login.server"
    );

    const since = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60_000).toISOString();
    const { count } = await supabaseAdmin
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("username", data.username)
      .eq("succeeded", false)
      .gte("attempted_at", since);
    if ((count ?? 0) >= MAX_FAILED_ATTEMPTS) {
      throw new Error(
        `Too many failed attempts. Try again in ${ATTEMPT_WINDOW_MINUTES} minutes or ask your shop admin to reset your password.`,
      );
    }

    const fail = async () => {
      await supabaseAdmin
        .from("login_attempts")
        .insert({ username: data.username, succeeded: false });
      throw new Error(GENERIC);
    };

    const { data: row } = await supabaseAdmin
      .from("login_usernames")
      .select("user_id")
      .eq("username", data.username)
      .maybeSingle();
    if (!row) return await fail();

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
    const email = authUser?.user?.email;
    if (!email) return await fail();

    const { data: signIn, error } = await publishableClient().auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (error || !signIn.session) return await fail();

    await supabaseAdmin.from("login_attempts").insert({ username: data.username, succeeded: true });

    return {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    };
  });

/**
 * Admin-side credential management. Authority is decided in the database
 * (`can_manage_login_credential`), so a shop admin can only ever touch members
 * of their own shop; the platform owner may touch anyone.
 */
export const setLoginCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; username: string; password?: string }) => {
    const userId = (input?.userId ?? "").trim();
    const username = normalizeLoginUsername(input?.username ?? "");
    const password = input?.password ?? "";
    if (!userId) throw new Error("A member must be selected.");
    const problem = loginUsernameIssue(username);
    if (problem) throw new Error(problem);
    if (password) {
      const p = loginPasswordIssue(password);
      if (p) throw new Error(p);
    }
    return { userId, username, password };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: allowed, error: authzError } = await supabase.rpc(
      "can_manage_login_credential",
      { _actor: userId, _target: data.userId },
    );
    if (authzError) throw new Error(authzError.message);
    if (!allowed) {
      throw new Error("You can only manage login credentials for members of your own shop.");
    }

    const { data: saved, error } = await supabase.rpc("set_login_username", {
      _target: data.userId,
      _username: data.username,
    });
    if (error) throw new Error(error.message);

    if (data.password) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        password: data.password,
      });
      if (pwError) throw new Error(pwError.message);
      // Audit WHO changed WHAT — never the password itself.
      await supabase.rpc("log_operator_action", {
        _target: data.userId,
        _action: "Login password set by shop admin",
        _entity: "login_username",
        _entity_id: data.userId,
        _eco: null as unknown as string,
        _details: { method: "username_login" },
      });
    }

    return { username: (saved as string) ?? data.username };
  });

export const clearLoginCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    const userId = (input?.userId ?? "").trim();
    if (!userId) throw new Error("A member must be selected.");
    return { userId };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("clear_login_username", {
      _target: data.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

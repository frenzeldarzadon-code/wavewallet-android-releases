/**
 * Operator-set passwords.
 *
 * Only the platform owner may set another account's password, and the check is
 * made on the server against the database — the browser is never trusted. The
 * password itself is handed straight to the authentication provider, which
 * stores only a salted hash; it is never written to the database, the audit
 * log, or any response body.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isStrongPassword } from "@/lib/password-policy";

export const setMemberPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; password: string }) => {
    const userId = (input?.userId ?? "").trim();
    const password = input?.password ?? "";
    if (!userId) throw new Error("A member must be selected.");
    if (!isStrongPassword(password)) {
      throw new Error("The new password does not meet the password policy.");
    }
    return { userId, password };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isOwner, error: roleError } = await supabase.rpc("is_super_admin", {
      _user_id: userId,
    });
    if (roleError) throw new Error(roleError.message);
    if (!isOwner) throw new Error("Only the platform owner can set another account's password.");
    if (userId === data.userId) {
      throw new Error("Change your own password from your profile's security section.");
    }

    const { data: target, error: readError } = await supabase
      .from("profiles")
      .select("id, ecosystem_id, deleted_at")
      .eq("id", data.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!target || target.deleted_at) throw new Error("Member not found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (authError) throw new Error(authError.message);

    // Audit WHO changed WHAT and WHEN — never the password or any part of it.
    await supabase.rpc("log_operator_action", {
      _target: data.userId,
      _action: "Password set by platform owner",
      _entity: "auth_user",
      _entity_id: data.userId,
      _eco: (target.ecosystem_id ?? null) as unknown as string,
      _details: { method: "admin_set_password" },
    });

    return { ok: true as const };
  });

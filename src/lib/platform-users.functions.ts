/**
 * Platform-owner account deletion.
 *
 * The database anonymises the profile and keeps every financial record; this
 * server function additionally removes the login itself, so the same email or
 * mobile number is free to register again later. The caller is re-verified as
 * the platform owner on the server — the browser is never trusted for this.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deletePlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; reason?: string; override?: boolean }) => {
    if (!input?.userId) throw new Error("A member is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isOwner, error: roleError } = await supabase.rpc("is_super_admin", {
      _user_id: userId,
    });
    if (roleError) throw new Error(roleError.message);
    if (!isOwner) throw new Error("Only the platform owner can delete a platform account");

    // Blocks on any non-zero balance or outstanding money movement. With
    // `override` the owner additionally waives the non-financial rules.
    const { error } = await supabase.rpc("superadmin_delete_platform_user", {
      _user: data.userId,
      ...(data.reason ? { _reason: data.reason } : {}),
      ...(data.override ? { _override: true } : {}),
    });
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    // The account is already unusable if this fails; surface it so the owner
    // knows the email may still be taken.
    if (authError) {
      return { ok: true as const, loginReleased: false, message: authError.message };
    }
    return { ok: true as const, loginReleased: true, message: "" };
  });

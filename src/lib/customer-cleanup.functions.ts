/**
 * Server-side customer account deletion.
 *
 * Authorization is enforced by the database (`delete_customer_account` is a
 * SECURITY DEFINER function that only accepts the ecosystem's admin or the
 * platform owner, and only for eligible plain customers). After the profile is
 * anonymised, the auth login is disabled with the admin API so the deleted
 * customer can no longer sign in. Financial history is never touched.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteCustomerAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; reason?: string }) => {
    if (!input?.userId) throw new Error("A customer must be selected.");
    return { userId: input.userId, reason: (input.reason ?? "").trim() || undefined };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("delete_customer_account", {
      _user_id: data.userId,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);

    // Identity is already anonymised and roles revoked; now block the login.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: "876000h",
      email: `deleted+${data.userId}@deleted.invalid`,
      user_metadata: { deleted: true },
    });

    return { ok: true as const };
  });

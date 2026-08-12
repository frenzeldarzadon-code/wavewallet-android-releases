/**
 * Server-side member identity update (name / phone / email).
 *
 * Why a server function: changing the email has to move BOTH the profile row
 * and the auth login, otherwise the account can no longer sign in with the
 * address the admin sees. The auth side needs the admin API, which never
 * reaches the browser.
 *
 * Order of operations keeps profile and auth consistent:
 *   1. the database authorizes the caller and validates uniqueness (dry run),
 *   2. the auth email is moved (already-confirmed, so no lockout),
 *   3. the profile row is updated and the change is audit-logged,
 *   4. if step 3 fails, the auth email is rolled back to the old address.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface UpdateMemberProfileInput {
  userId: string;
  fullName: string;
  phone: string;
  email: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const updateMemberProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateMemberProfileInput) => {
    const userId = (input?.userId ?? "").trim();
    const fullName = (input?.fullName ?? "").trim();
    const phone = (input?.phone ?? "").trim();
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!userId) throw new Error("A member must be selected.");
    if (!fullName) throw new Error("A full name is required.");
    if (!phone) throw new Error("A phone number is required.");
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
    return { userId, fullName, phone, email };
  })
  .handler(async ({ data, context }) => {
    // 1. Authorization + current identity, as the signed-in admin (RLS applies).
    const { data: allowed, error: permError } = await context.supabase.rpc(
      "can_manage_member_profile",
      { _actor: context.userId, _target: data.userId },
    );
    if (permError) throw new Error(permError.message);
    if (!allowed) throw new Error("You are not allowed to edit this member.");

    const { data: current, error: readError } = await context.supabase
      .from("profiles")
      .select("email, full_name, phone, deleted_at")
      .eq("id", data.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current || current.deleted_at) throw new Error("Member not found.");

    const emailChanged = (current.email ?? "").toLowerCase() !== data.email;

    if (emailChanged) {
      const { data: taken } = await context.supabase.rpc("member_email_taken", {
        _email: data.email,
        _exclude: data.userId,
      });
      if (taken) throw new Error("That email address is already used by another account.");
    }

    // 2. Move the auth login first — it is the strictest uniqueness check.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (emailChanged) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        email: data.email,
        email_confirm: true,
      });
      if (authError) {
        throw new Error(
          /already/i.test(authError.message)
            ? "That email address is already used by another account."
            : authError.message,
        );
      }
    }

    // 3. Profile + audit log, authorized again in the database.
    const { data: result, error } = await context.supabase.rpc("admin_update_member_profile", {
      _user_id: data.userId,
      _full_name: data.fullName,
      _phone: data.phone,
      _email: data.email,
    });

    if (error) {
      // 4. Roll the login back so profile and auth never drift apart.
      if (emailChanged && current.email) {
        await supabaseAdmin.auth.admin.updateUserById(data.userId, {
          email: current.email,
          email_confirm: true,
        });
      }
      throw new Error(error.message);
    }

    return { ok: true as const, emailChanged, result };
  });

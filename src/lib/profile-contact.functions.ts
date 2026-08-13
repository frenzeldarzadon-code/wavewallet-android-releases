/**
 * Self-service contact details (phone + email).
 *
 * A member may only ever change their OWN row: the server function ignores any
 * caller-supplied id and uses the authenticated user id. Changing the email has
 * to move both the profile row and the auth login, so the auth side is updated
 * first (admin API, server only) and rolled back if the profile update fails.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface UpdateOwnContactInput {
  phone: string;
  email: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const updateOwnContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateOwnContactInput) => {
    const phone = (input?.phone ?? "").trim();
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!phone) throw new Error("A phone number is required.");
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
    return { phone, email };
  })
  .handler(async ({ data, context }) => {
    const { data: current, error: readError } = await context.supabase
      .from("profiles")
      .select("email, deleted_at")
      .eq("id", context.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current || current.deleted_at) throw new Error("Profile not found.");

    const emailChanged = (current.email ?? "").toLowerCase() !== data.email;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (emailChanged) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
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

    const { error } = await context.supabase.rpc("update_own_contact", {
      _phone: data.phone,
      _email: data.email,
    });

    if (error) {
      if (emailChanged && current.email) {
        await supabaseAdmin.auth.admin.updateUserById(context.userId, {
          email: current.email,
          email_confirm: true,
        });
      }
      throw new Error(error.message);
    }

    return { ok: true as const, emailChanged };
  });

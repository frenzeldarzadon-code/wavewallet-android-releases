/**
 * Super Admin account assistance.
 *
 * The platform owner can help a member back into their account WITHOUT ever
 * seeing a credential: passwords live only inside the authentication provider.
 * The only assistance available is a secure, self-service reset link sent to
 * the member's own verified email address — and every attempt is audited.
 */
import { supabase } from "@/integrations/supabase/client";
import { isRealEmail, normalizePhone } from "@/lib/account-identifiers";

export interface AssistableMember {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  ecosystem_id: string | null;
}

/** The identifiers an operator is allowed to see (never a credential). */
export function visibleIdentifiers(m: Pick<AssistableMember, "email" | "phone">) {
  return {
    email: isRealEmail(m.email) ? m.email : null,
    phone: normalizePhone(m.phone || "") || null,
  };
}

/** Why a reset link cannot be sent, or null when it can. */
export function resetBlockedReason(m: Pick<AssistableMember, "email">): string | null {
  return isRealEmail(m.email)
    ? null
    : "This account has no email address, so a reset link cannot be sent. Ask the member to contact the official support page.";
}

/**
 * Sends the member a password-reset link and records the assistance in the
 * operator audit trail. The link goes to the member's own inbox — the operator
 * never receives it and never sees the password.
 */
export async function sendAccountRecovery(member: AssistableMember): Promise<void> {
  const blocked = resetBlockedReason(member);
  if (blocked) throw new Error(blocked);
  const { error } = await supabase.auth.resetPasswordForEmail(member.email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new Error(error.message);
  await supabase.rpc("log_operator_action", {
    _target: member.id,
    _action: "Account recovery link sent",
    _entity: "auth_user",
    _entity_id: member.id,
    // Platform-level members have no shop; the audit row accepts a null shop.
    _eco: (member.ecosystem_id ?? null) as unknown as string,
    _details: { method: "password_reset_email", to: member.email.trim().toLowerCase() },
  });
}

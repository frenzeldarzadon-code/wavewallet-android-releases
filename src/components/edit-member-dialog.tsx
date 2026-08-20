/**
 * Admin / Super Admin editor for a member's identity fields.
 * Only name, phone and email — never roles, balances, discounts or commissions.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { diffProfile, validateProfileEdit, type ProfileEdit } from "@/lib/member-admin";
import { updateMemberProfile } from "@/lib/member-admin.functions";
import { LoginCredentialCard } from "@/components/login-credential-card";
import { supabase } from "@/integrations/supabase/client";

export interface EditableMember {
  id: string;
  full_name: string;
  email: string;
  phone: string;
}

interface Props {
  member: EditableMember | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function EditMemberDialog({ member, onClose, onSaved }: Props) {
  const [form, setForm] = useState<ProfileEdit>({ fullName: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  // The username already on file, if any. A password is never read back.
  const [loginUsername, setLoginUsername] = useState<string | null>(null);

  useEffect(() => {
    if (member) {
      setForm({ fullName: member.full_name, phone: member.phone, email: member.email });
    }
  }, [member]);

  useEffect(() => {
    if (!member) return;
    let active = true;
    setLoginUsername(null);
    void supabase
      .from("login_usernames")
      .select("username")
      .eq("user_id", member.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setLoginUsername((data as { username: string } | null)?.username ?? null);
      });
    return () => {
      active = false;
    };
  }, [member]);

  const submit = async () => {
    if (!member) return;
    const problem = validateProfileEdit(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    const before: ProfileEdit = {
      fullName: member.full_name,
      phone: member.phone,
      email: member.email,
    };
    if (Object.keys(diffProfile(before, form)).length === 0) {
      toast.info("Nothing changed.");
      onClose();
      return;
    }
    setBusy(true);
    try {
      const res = await updateMemberProfile({
        data: {
          userId: member.id,
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim().toLowerCase(),
        },
      });
      toast.success(
        res.emailChanged
          ? "Profile updated. The member now signs in with the new email."
          : "Profile updated.",
      );
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(member)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit member details</DialogTitle>
          <DialogDescription>
            Update the name, phone number or email for {member?.full_name}. Changing the email also
            changes the address they sign in with. Every change is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="member-name">Full name</Label>
            <Input
              id="member-name"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-phone">Phone number</Label>
            <Input
              id="member-phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-email">Email address</Label>
            <Input
              id="member-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          {member ? (
            <LoginCredentialCard
              userId={member.id}
              current={loginUsername}
              onSaved={(u) => setLoginUsername(u || null)}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

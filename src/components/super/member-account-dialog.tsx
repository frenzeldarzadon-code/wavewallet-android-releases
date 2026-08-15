/**
 * Platform-owner account management for one member.
 *
 * Shows who the account belongs to (username, status, role, shops and the
 * wallets held in each), lets the owner correct the username, and lets them
 * set a brand-new password. The existing password can never be recovered —
 * only replaced — because it is stored as a salted hash inside the
 * authentication provider.
 */
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MemberAvatar } from "@/components/member-avatar";
import { PasswordField } from "@/components/password-field";
import { RoleBadge } from "@/components/role-badge";
import { setMemberPassword } from "@/lib/account-credentials.functions";
import {
  fetchMemberShopAccounts,
  setMemberUsername,
  type MemberShopAccount,
} from "@/lib/account-credentials";
import { newPasswordIssue } from "@/lib/password-policy";
import { resetBlockedReason, sendAccountRecovery } from "@/lib/account-assistance";
import type { PlatformMember } from "@/lib/platform-members";

interface Props {
  member: PlatformMember | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function MemberAccountDialog({ member, onClose, onSaved }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accounts, setAccounts] = useState<MemberShopAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<null | "username" | "password" | "link">(null);
  const applyPassword = useServerFn(setMemberPassword);

  useEffect(() => {
    if (!member) return;
    setUsername(member.handle ?? "");
    setPassword("");
    setConfirm("");
    setLoading(true);
    fetchMemberShopAccounts(member.id)
      .then(setAccounts)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [member]);

  const saveUsername = async () => {
    if (!member) return;
    setBusy("username");
    try {
      const saved = await setMemberUsername(member.id, username);
      toast.success(`Username updated to @${saved}.`);
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const savePassword = async () => {
    if (!member) return;
    const problem = newPasswordIssue(password, confirm);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy("password");
    try {
      await applyPassword({ data: { userId: member.id, password } });
      setPassword("");
      setConfirm("");
      toast.success(
        `New password set for ${member.full_name}. Share it with them privately — it is not stored anywhere.`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sendLink = async () => {
    if (!member) return;
    setBusy("link");
    try {
      await sendAccountRecovery({
        id: member.id,
        full_name: member.full_name,
        email: member.email,
        phone: member.phone,
        ecosystem_id: member.ecosystem_id,
      });
      toast.success("Recovery link sent to the member's own email.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const linkBlocked = member ? resetBlockedReason(member) : null;

  return (
    <Dialog open={Boolean(member)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage account</DialogTitle>
          <DialogDescription>
            You are editing another person's credentials. Every change is recorded in the audit
            log under your name — the password itself is never stored or logged.
          </DialogDescription>
        </DialogHeader>

        {member ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <MemberAvatar
                name={member.full_name}
                path={member.avatar_path}
                className="size-10"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{member.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.handle ? `@${member.handle} · ` : ""}
                  {member.email || "No email on file"}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <RoleBadge role={member.role} showCustomer />
                  <Badge variant="outline">{member.status}</Badge>
                  <Badge variant="outline">
                    {member.shop_count ?? 0} shop{(member.shop_count ?? 0) === 1 ? "" : "s"}
                  </Badge>
                </div>
              </div>
            </div>

            <section className="space-y-2">
              <p className="text-sm font-semibold">Shops and wallets</p>
              {loading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : accounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This account belongs to no shop yet — Universe access only.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {accounts.map((a) => (
                    <li
                      key={a.ecosystem_id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{a.ecosystem_name}</span>
                        <span className="text-muted-foreground"> · {a.role}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="font-semibold text-primary">
                          {a.credit_balance.toLocaleString()} cr
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {a.points_balance.toLocaleString()} pts
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Separator />

            <section className="space-y-2">
              <Label htmlFor="member-username">Username (@handle)</Label>
              <div className="flex gap-2">
                <Input
                  id="member-username"
                  className="h-11"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                />
                <Button
                  className="h-11"
                  onClick={() => void saveUsername()}
                  disabled={busy !== null || username.trim() === (member.handle ?? "")}
                >
                  {busy === "username" ? "Saving…" : "Save"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                3–20 letters, numbers, dots or underscores. Usernames are unique across the whole
                platform. Wallets, points, vouchers, history, roles and shop membership are
                untouched by a username change.
              </p>
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Existing passwords cannot be viewed — they are stored only as one-way hashes. Set
                  a new one and share it with the member privately.
                </p>
              </div>
              <PasswordField
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                requirements
              />
              <PasswordField
                label="Confirm new password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
              />
              <Button
                className="h-11 w-full"
                onClick={() => void savePassword()}
                disabled={busy !== null || !password || !confirm}
              >
                <KeyRound className="size-4" />
                {busy === "password" ? "Setting password…" : "Set new password"}
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={busy !== null || linkBlocked !== null}
                title={linkBlocked ?? "Let the member choose their own password by email"}
                onClick={() => void sendLink()}
              >
                {busy === "link" ? "Sending…" : "Email a self-service reset link instead"}
              </Button>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

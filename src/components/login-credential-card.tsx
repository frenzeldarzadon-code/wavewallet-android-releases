/**
 * Username + password sign-in credential — an ADDITIONAL way in.
 *
 * A shop admin can set (or reset) a member's login username and password from
 * Customer Details; a member can change their own from their profile. A stored
 * password is never read back: it can only be replaced. The database decides
 * who may manage whose credential.
 */
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordField } from "@/components/password-field";
import {
  LOGIN_PASSWORD_HINT,
  LOGIN_USERNAME_HINT,
  loginPasswordIssue,
  loginUsernameIssue,
  normalizeLoginUsername,
} from "@/lib/username-login";
import { clearLoginCredential, setLoginCredential } from "@/lib/username-login.functions";

interface Props {
  userId: string;
  /** The username already on file, when there is one. */
  current?: string | null;
  /** Wording changes slightly for "someone else's" credential. */
  self?: boolean;
  onSaved?: (username: string) => void;
}

export function LoginCredentialCard({ userId, current, self, onSaved }: Props) {
  const [username, setUsername] = useState(current ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const nameIssue = username ? loginUsernameIssue(username) : null;
  const passIssue = password ? loginPasswordIssue(password, confirm) : null;

  const save = async () => {
    const problem = loginUsernameIssue(username) ?? (password ? loginPasswordIssue(password, confirm) : null);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await setLoginCredential({
        data: { userId, username: normalizeLoginUsername(username), password },
      });
      setPassword("");
      setConfirm("");
      setUsername(res.username);
      onSaved?.(res.username);
      toast.success(self ? "Your login username is saved." : "Login credential saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the credential.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await clearLoginCredential({ data: { userId } });
      setUsername("");
      toast.success("Username sign-in removed. Other sign-in methods still work.");
      onSaved?.("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the username.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="size-4 text-primary" />
          {self ? "Your username sign-in" : "Username sign-in"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {self
            ? "Sign in with a username and password instead of your email or mobile number. Your other sign-in methods keep working."
            : "Give this member a username and password to sign in with. Email, mobile and Google sign-in keep working, and no existing password can ever be read back."}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="cred-username">Username</Label>
          <Input
            id="cred-username"
            className="h-11"
            value={username}
            placeholder="Enter username"
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">{LOGIN_USERNAME_HINT}</p>
          {nameIssue ? <p className="text-[11px] text-destructive">{nameIssue}</p> : null}
        </div>
        <PasswordField
          id="cred-password"
          label={current ? "New password (optional)" : "Password"}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <p className="-mt-1 text-[11px] text-muted-foreground">{LOGIN_PASSWORD_HINT}</p>
        <PasswordField
          id="cred-confirm"
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          placeholder="Repeat the password"
          autoComplete="new-password"
        />
        {passIssue ? <p className="text-[11px] text-destructive">{passIssue}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : current ? "Update credential" : "Create credential"}
          </Button>
          {current ? (
            <Button variant="outline" onClick={() => void remove()} disabled={busy}>
              Remove username sign-in
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

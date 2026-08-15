/**
 * Self-service account security: change your own username (@handle) and your
 * own password. The current password is re-checked before a new one is
 * accepted, and no password ever leaves the browser except to the
 * authentication provider.
 */
import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection } from "@/components/ui-kit";
import { PasswordField } from "@/components/password-field";
import { changeOwnPassword } from "@/lib/account-credentials";
import { newPasswordIssue } from "@/lib/password-policy";

export function AccountSecurityCard({ username }: { username: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const issue = next || confirm ? newPasswordIssue(next, confirm) : null;

  const submit = async () => {
    if (!current) {
      toast.error("Enter your current password.");
      return;
    }
    if (issue) {
      toast.error(issue);
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword(current, next, confirm);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Your password has been changed.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      title="Account & security"
      description="Your username and password. Changing them never affects your wallets, points, vouchers or history."
    >
      <Card>
        <CardContent className="space-y-5 p-4 sm:p-5">
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
            <ShieldCheck className="mt-0.5 size-4 text-success" />
            <p className="text-xs text-muted-foreground">
              Your username is{" "}
              <span className="font-medium text-foreground">
                {username ? `@${username}` : "not set yet"}
              </span>
              . Change it in the “Social handle” field above and press Save changes. Passwords are
              stored as one-way hashes — nobody, including your operator, can read yours.
            </p>
          </div>

          <div className="space-y-3">
            <PasswordField
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />
            <PasswordField
              label="New password"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              requirements
            />
            <PasswordField
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              onEnter={() => void submit()}
            />
            {issue ? <p className="text-xs text-destructive">{issue}</p> : null}
            <Button
              className="h-11 w-full"
              onClick={() => void submit()}
              disabled={busy || !current || !next || !confirm || Boolean(issue)}
            >
              <KeyRound className="size-4" />
              {busy ? "Updating…" : "Change password"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageSection>
  );
}

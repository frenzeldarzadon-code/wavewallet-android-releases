/**
 * "Access Account" confirmation. Entering an account is a server-side
 * delegation: the operator keeps their own login and every action is written to
 * the audit trail under both identities.
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { startImpersonation } from "@/lib/impersonation";
import { homeFor } from "@/lib/session";
import { roleLabel, type Role } from "@/lib/wavewallet";

export interface AccessTarget {
  id: string;
  name: string;
  role: Role;
}

export function AccessAccountDialog({
  target,
  onClose,
}: {
  target: AccessTarget | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await startImpersonation(target.id, reason);
      toast.success(`You are now acting as ${target.name}`);
      onClose();
      setReason("");
      navigate({ to: homeFor(target.role), replace: true });
      // The member workspace reads the delegated account on load.
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not access that account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Access {target?.name}&rsquo;s account</DialogTitle>
          <DialogDescription>
            You will see and use this {target ? roleLabel(target.role).toLowerCase() : "member"}{" "}
            account as they do. Every action is permanently logged under your own name, never
            theirs. Passwords and security settings stay out of reach.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="access-reason">Reason (optional)</Label>
          <Textarea
            id="access-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Helping the member complete a voucher purchase"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            The session ends automatically after 60 minutes, or when you tap “Exit account”.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void enter()} disabled={busy}>
            {busy ? "Opening…" : "Enter account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

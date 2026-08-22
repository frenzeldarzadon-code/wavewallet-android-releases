/**
 * Add / edit a MANUAL Spending Tracker entry.
 *
 * Automatic entries (admin cashback per reseller, Admin Discount, Admin
 * Purchases) are derived from real transactions and are never editable here.
 */
import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dayKey,
  saveManualEntry,
  validateManualEntry,
  type EntryKind,
  type SpendingCategory,
  type SpendingEntry,
} from "@/lib/spending-tracker";
import {
  newClientRef,
  submitNewEntry,
  updateQueuedEntry,
} from "@/lib/offline-spending";


const NONE = "__none__";

export function EntryDialog({
  open,
  onOpenChange,
  kind,
  ecosystemId,
  categories,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: EntryKind;
  ecosystemId: string;
  categories: SpendingCategory[];
  editing?: SpendingEntry | null;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [date, setDate] = useState(dayKey(new Date()));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * Idempotency key for the entry being written. Minted once when the form is
   * opened for a NEW entry and kept across retries, so a resend after a lost
   * response returns the existing row instead of creating a second one.
   */
  const clientRef = useRef<string>(newClientRef());

  useEffect(() => {
    if (!open) return;
    setAmount(editing ? String(editing.amount) : "");
    setDescription(editing?.description ?? "");
    setNotes(editing?.notes ?? "");
    setDate(editing ? dayKey(new Date(editing.occurredAt)) : dayKey(new Date()));
    const cat = editing?.categoryKey.startsWith("cat:")
      ? editing.categoryKey.slice(4)
      : NONE;
    setCategoryId(cat);
    // A queued entry keeps the key it was created with; a new form gets one.
    clientRef.current = editing?.sync ? editing.id : newClientRef();
  }, [open, editing]);

  const options = categories.filter((c) => c.kind === kind && !c.auto_key);

  async function submit() {
    const problem = validateManualEntry({ amount, description, date });
    if (problem) {
      toast.error(problem);
      return;
    }
    const chosen = categoryId === NONE ? null : categoryId;
    const payload = {
      ecosystemId,
      kind,
      amount: Number(amount),
      description: description.trim(),
      categoryId: chosen,
      categoryName: categories.find((c) => c.id === chosen)?.name ?? null,
      occurredAt: new Date(`${date}T12:00:00`),
      notes: notes.trim() || null,
    };
    setBusy(true);
    try {
      if (editing?.sync) {
        // Still only on this device — edit the queued copy, keeping the same
        // idempotency key so the eventual sync stays a single entry.
        updateQueuedEntry(editing.id, {
          amount: payload.amount,
          description: payload.description,
          categoryId: chosen,
          categoryName: payload.categoryName,
          occurredAt: payload.occurredAt.toISOString(),
          notes: payload.notes,
          lastError: null,
        });
        toast.success("Saved on this device. It will sync when you are back online.");
      } else if (editing) {
        await saveManualEntry(
          { ...payload, clientRef: null },
          editing.id,
        );
        toast.success("Entry updated.");
      } else {
        const status = await submitNewEntry({ ...payload, clientRef: clientRef.current });
        toast.success(
          status === "saved"
            ? kind === "income"
              ? "Income added."
              : "Expense added."
            : status === "queued-offline"
              ? "Saved offline. It will sync automatically when you reconnect."
              : "Connection problem — saved on this device and will sync automatically.",
        );
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit" : "Add"} {kind === "income" ? "income" : "expense"}
          </DialogTitle>
          <DialogDescription>
            Reporting only — this never changes any wallet balance, coin ledger or
            member earnings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="entryAmount">Amount (₱)</Label>
            <Input
              id="entryAmount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entryDescription">Description</Label>
            <Input
              id="entryDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={kind === "income" ? "e.g. Load rebate" : "e.g. Internet bill"}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="entryDate">Date</Label>
              <Input
                id="entryDate"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent className="pointer-events-auto">
                  <SelectItem value={NONE}>Uncategorized</SelectItem>
                  {options.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entryNotes">Notes (optional)</Label>
            <Textarea
              id="entryNotes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

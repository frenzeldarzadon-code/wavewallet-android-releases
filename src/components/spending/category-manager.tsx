/**
 * Category list for the Spending Tracker.
 *
 * Automatic categories (one per reseller, Direct sales, Admin Discount, Admin
 * Purchases) may be RENAMED but never deleted, and renaming never breaks the
 * link back to the reseller they report on. Manual categories are fully
 * editable.
 */
import { useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createCategory,
  deleteCategory,
  renameCategory,
  type EntryKind,
  type SpendingCategory,
} from "@/lib/spending-tracker";

export function CategoryManager({
  open,
  onOpenChange,
  ecosystemId,
  categories,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ecosystemId: string;
  categories: SpendingCategory[];
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<EntryKind>("income");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = categories.filter((c) => c.kind === kind);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
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
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Automatic categories are kept in step with your shop and can be renamed
            but not removed.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={kind} onValueChange={(v) => setKind(v as EntryKind)}>
          <TabsList className="w-full">
            <TabsTrigger className="flex-1" value="income">
              Income
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="expense">
              Expense
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {rows.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <Input
                defaultValue={c.name}
                disabled={busy}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) void run(() => renameCategory(c.id, v));
                }}
              />
              {c.auto_key ? (
                <span
                  className="shrink-0 text-muted-foreground"
                  title="Automatic category — cannot be deleted"
                >
                  <Lock className="size-4" />
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  onClick={() => void run(() => deleteCategory(c.id))}
                  aria-label={`Delete ${c.name}`}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-1.5 border-t border-border pt-3">
          <Label htmlFor="newCategory">New {kind} category</Label>
          <div className="flex gap-2">
            <Input
              id="newCategory"
              value={newName}
              placeholder={kind === "income" ? "e.g. Other rebates" : "e.g. Electricity"}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              disabled={busy || !newName.trim()}
              onClick={() =>
                void run(async () => {
                  await createCategory(ecosystemId, kind, newName);
                  setNewName("");
                })
              }
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

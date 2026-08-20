/**
 * Platform-owner action: record a real GCash payment a paired phone missed.
 *
 * Creating the record credits nothing and approves nothing. It only adds the
 * payment to the "Incoming payments awaiting review" queue, exactly as a
 * captured listener notification would.
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { recordManualGcashPayment } from "@/lib/manual-gcash-recovery";

interface ShopOption {
  id: string;
  name: string;
  number: string;
}

const ALL_SHOPS = "__all__";

export function ManualRecoveryDialog({ onRecorded }: { onRecorded: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [shopId, setShopId] = useState<string>(ALL_SHOPS);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [receivingNumber, setReceivingNumber] = useState("");
  const [senderNumber, setSenderNumber] = useState("");
  const [senderName, setSenderName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { data, error } = await supabase
        .from("ecosystems")
        .select("id, name, cash_in_gcash_number, archived_at")
        .order("name");
      if (error) {
        toast.error("Could not load shops", { description: error.message });
        return;
      }
      const rows = (data ?? []) as Array<{
        id: string;
        name: string | null;
        cash_in_gcash_number: string | null;
        archived_at: string | null;
      }>;
      setShops(
        rows
          .filter((s) => !s.archived_at && s.cash_in_gcash_number)
          .map((s) => ({
            id: s.id,
            name: s.name ?? "Shop",
            number: s.cash_in_gcash_number ?? "",
          })),
      );
    })();
  }, [open]);

  const chooseShop = (value: string) => {
    setShopId(value);
    const shop = shops.find((s) => s.id === value);
    if (shop) setReceivingNumber(shop.number);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const result = await recordManualGcashPayment({
        amountPhp: Number(amount),
        reference,
        receivedAt,
        receivingNumber,
        ecosystemId: shopId === ALL_SHOPS ? null : shopId,
        senderNumber,
        senderName,
        note,
      });
      toast.success(
        `Payment ${result.gcash_reference} recorded for review. No wallet was credited.`,
      );
      setOpen(false);
      setAmount("");
      setReference("");
      setReceivedAt("");
      setSenderNumber("");
      setSenderName("");
      setNote("");
      onRecorded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record that payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Record missed payment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a missed GCash payment</DialogTitle>
          <DialogDescription>
            For real money that arrived while the listener phone was offline. This never credits a
            wallet and never approves a Cash In — the payment simply joins the review queue below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="mr-shop">Shop that received it</Label>
            <Select value={shopId} onValueChange={chooseShop}>
              <SelectTrigger id="mr-shop">
                <SelectValue placeholder="Choose the shop" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SHOPS}>Any shop on this receiving number</SelectItem>
                {shops.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} · {s.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="mr-receiving">Receiving GCash number</Label>
            <Input
              id="mr-receiving"
              inputMode="tel"
              value={receivingNumber}
              placeholder="GCash number the payment was sent from"
              onChange={(e) => setReceivingNumber(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="mr-amount">Amount (PHP)</Label>
              <Input
                id="mr-amount"
                inputMode="decimal"
                value={amount}
                placeholder="1000"
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mr-ref">GCash reference</Label>
              <Input
                id="mr-ref"
                value={reference}
                placeholder="Reference number from the GCash notification"
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="mr-when">Received on</Label>
            <Input
              id="mr-when"
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="mr-sender">Sender number (if known)</Label>
              <Input
                id="mr-sender"
                inputMode="tel"
                value={senderNumber}
                placeholder="Receiving GCash number"
                onChange={(e) => setSenderNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mr-sender-name">Sender name (if known)</Label>
              <Input
                id="mr-sender-name"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="mr-note">Audit note (optional)</Label>
            <Input
              id="mr-note"
              value={note}
              placeholder="Why this payment is being recovered"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Recording…" : "Record for review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Send Universe coins — inline bottom sheet inside the Wallet Center.
 *
 * Reworked from the old shop-scoped "Send coins" area: same pick → amount →
 * confirm → done rhythm, minus every shop/upline/community concept. The
 * recipient is any active Universe member (searched by name or @handle), the
 * money comes from the sender's ONE global Universe Wallet and lands in the
 * recipient's global Universe Wallet. Nothing here is an authorization layer —
 * `transfer_universe_coins` re-checks every rule and the ledger refuses
 * negative balances.
 */
import { ArrowRight, Check, Info, Loader2, Search, Send, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MemberAvatar } from "@/components/member-avatar";
import { useOnline } from "@/lib/pwa";
import { cn } from "@/lib/utils";
import { peso } from "@/lib/wavewallet";
import {
  MAX_TRANSFER_NOTE,
  MIN_UNIVERSE_RECIPIENT_QUERY,
  balanceAfterTransfer,
  newTransferKey,
  parseCoinAmount,
  recipientLabel,
  searchUniverseRecipients,
  sendUniverseCoins,
  validateUniverseTransfer,
  type UniverseRecipient,
} from "@/lib/universe-transfer";

type Step = "pick" | "amount" | "confirm" | "done";

export function UniverseSendCoinsSheet({
  open,
  onOpenChange,
  senderId,
  balance,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  senderId: string;
  /** Sender's current global Universe wallet balance. */
  balance: number;
  /** Called after a successful transfer so the parent can refresh balance + history. */
  onSent: () => void | Promise<void>;
}) {
  const online = useOnline();
  const [step, setStep] = useState<Step>("pick");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<UniverseRecipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<UniverseRecipient | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tx: string; amount: number; balanceAfter: number } | null>(
    null,
  );
  // One key per attempt: a retry after a network blip returns the same transfer.
  const keyRef = useRef<string>(newTransferKey());
  const amountInputRef = useRef<HTMLInputElement>(null);

  const amount = parseCoinAmount(amountRaw);
  const problem = validateUniverseTransfer({
    senderId,
    recipientId: recipient?.id ?? null,
    amount,
    balance,
    note,
  });

  const reset = () => {
    setStep("pick");
    setQuery("");
    setMatches([]);
    setSearched(false);
    setSearchError(null);
    setRecipient(null);
    setAmountRaw("");
    setNote("");
    setError(null);
    setResult(null);
    keyRef.current = newTransferKey();
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  // Debounced Universe-wide search.
  useEffect(() => {
    if (!open || step !== "pick") return;
    const term = query.trim();
    if (term.length < MIN_UNIVERSE_RECIPIENT_QUERY) {
      setMatches([]);
      setSearched(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const rows = await searchUniverseRecipients(term);
        if (cancelled) return;
        setMatches(rows.filter((r) => r.id !== senderId));
        setSearchError(null);
      } catch (e) {
        if (!cancelled) setSearchError((e as Error).message);
      } finally {
        if (!cancelled) {
          setSearching(false);
          setSearched(true);
        }
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, open, step, senderId]);

  useEffect(() => {
    if (step === "amount") window.setTimeout(() => amountInputRef.current?.focus(), 60);
  }, [step]);

  const quickAmounts = useMemo(() => [20, 50, 100, 200].filter((v) => v <= balance), [balance]);

  const submit = async () => {
    if (!recipient || problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await sendUniverseCoins({
        recipientId: recipient.id,
        amount,
        note,
        clientKey: keyRef.current,
      });
      setResult({ tx, amount, balanceAfter: balanceAfterTransfer(balance, amount) });
      setStep("done");
      await onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col gap-0 rounded-t-3xl border-t px-0 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 sm:rounded-3xl sm:border sm:bottom-6"
      >
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-muted" aria-hidden />
        <SheetHeader className="px-5 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Send className="size-4 text-primary" />
            {step === "done" ? "Coins sent" : "Send Universe coins"}
          </SheetTitle>
          <SheetDescription>
            {step === "done"
              ? "Wallet-to-wallet transfer complete."
              : `From your Universe Wallet · available ${peso(balance)}. Any Universe member, no shop needed.`}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
          {step === "pick" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="usc-query">Recipient</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="usc-query"
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or @handle"
                    className="h-12 rounded-xl pl-9 text-base"
                    autoComplete="off"
                    aria-label="Search Universe members by name or handle"
                  />
                  {searching ? (
                    <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
              </div>

              {searchError ? <p className="text-xs text-destructive">{searchError}</p> : null}

              {matches.length > 0 ? (
                <ul className="space-y-1 rounded-2xl border border-border bg-card p-1">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setRecipient(m);
                          setStep("amount");
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted active:bg-brand-soft"
                      >
                        <MemberAvatar path={m.avatar_path} name={m.full_name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {m.full_name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {m.handle ? `@${m.handle}` : "Universe member"}
                          </span>
                        </span>
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {!searching && searched && matches.length === 0 && !searchError ? (
                <p className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  No Universe member matches that name or @handle.
                </p>
              ) : null}

              {query.trim().length < MIN_UNIVERSE_RECIPIENT_QUERY ? (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  Type at least {MIN_UNIVERSE_RECIPIENT_QUERY} characters. Coins go straight from
                  your Universe Wallet to theirs — this is not a purchase and earns no cashback.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === "amount" && recipient ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-brand-soft px-3 py-2.5">
                <MemberAvatar path={recipient.avatar_path} name={recipient.full_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{recipient.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {recipient.handle ? `@${recipient.handle}` : "Universe member"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRecipient(null);
                    setStep("pick");
                  }}
                >
                  Change
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="usc-amount">Amount (Universe coins)</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">
                    ₱
                  </span>
                  <Input
                    id="usc-amount"
                    ref={amountInputRef}
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={amountRaw}
                    onChange={(e) => setAmountRaw(e.target.value.replace(/[^0-9.,]/g, ""))}
                    placeholder="0.00"
                    className="h-14 rounded-xl pl-9 text-2xl font-bold tabular-nums"
                    aria-describedby="usc-amount-hint"
                  />
                </div>
                <p
                  id="usc-amount-hint"
                  className="flex justify-between text-xs text-muted-foreground"
                >
                  <span>Available {peso(balance)}</span>
                  {amount > 0 ? (
                    <span>After: {peso(balanceAfterTransfer(balance, amount))}</span>
                  ) : null}
                </p>
              </div>

              {quickAmounts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {quickAmounts.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmountRaw(String(v))}
                      className={cn(
                        "h-9 rounded-full border px-4 text-xs font-semibold transition-colors",
                        amount === v
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {peso(v)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAmountRaw(String(balance))}
                    className="h-9 rounded-full border border-border bg-card px-4 text-xs font-semibold text-muted-foreground hover:bg-muted"
                  >
                    Max
                  </button>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="usc-note">Note (optional)</Label>
                <Input
                  id="usc-note"
                  value={note}
                  maxLength={MAX_TRANSFER_NOTE}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Load for this week"
                  className="h-11 rounded-xl"
                />
              </div>

              {problem && amount > 0 ? <p className="text-xs text-destructive">{problem}</p> : null}
            </div>
          ) : null}

          {step === "confirm" && recipient ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-4 text-center shadow-[var(--shadow-card)]">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  You are sending
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-primary">{peso(amount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">Universe coins</p>
                <div className="mx-auto mt-4 flex max-w-xs items-center justify-center gap-3">
                  <MemberAvatar path={recipient.avatar_path} name={recipient.full_name} />
                  <div className="min-w-0 text-left">
                    <p className="truncate text-sm font-semibold">{recipient.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {recipientLabel(recipient)}
                    </p>
                  </div>
                </div>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">From</dt>
                  <dd className="font-medium">Your Universe Wallet</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Balance after</dt>
                  <dd className="font-medium tabular-nums">
                    {peso(balanceAfterTransfer(balance, amount))}
                  </dd>
                </div>
                {note.trim() ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Note</dt>
                    <dd className="truncate font-medium">{note.trim()}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Send {peso(amount)} to {recipientLabel(recipient)}? This is a wallet-to-wallet
                transfer, not a purchase — no cashback or rewards apply, and you cannot undo it
                yourself.
              </p>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>
          ) : null}

          {step === "done" && result && recipient ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="size-7" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{peso(result.amount)}</p>
                <p className="text-sm text-muted-foreground">
                  sent to{" "}
                  <span className="font-medium text-foreground">{recipientLabel(recipient)}</span>
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Wallet className="size-4" /> Universe Wallet now
                  </span>
                  <span className="font-semibold tabular-nums text-success">
                    {peso(result.balanceAfter)}
                  </span>
                </div>
                <p className="mt-1 text-left text-[11px] text-muted-foreground">Ref {result.tx}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 pt-4">
          {step === "amount" ? (
            <Button
              className="h-12 w-full rounded-xl text-base"
              disabled={!!problem || !online}
              onClick={() => setStep("confirm")}
            >
              Review transfer <ArrowRight className="size-4" />
            </Button>
          ) : null}
          {step === "confirm" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-12 rounded-xl"
                disabled={busy}
                onClick={() => setStep("amount")}
              >
                Back
              </Button>
              <Button
                className="h-12 rounded-xl"
                disabled={busy || !online || !!problem}
                onClick={() => void submit()}
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="size-4" /> Confirm & send
                  </>
                )}
              </Button>
            </div>
          ) : null}
          {step === "done" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-12 rounded-xl" onClick={reset}>
                Send again
              </Button>
              <Button className="h-12 rounded-xl" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          ) : null}
          {!online ? (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              You are offline — reconnect to send coins.
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

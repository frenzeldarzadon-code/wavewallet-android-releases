/**
 * Prominent, database-driven display of the ACTIVE receiving accounts a payer
 * may use for cash in. Presentation only — no accounting, conversion or
 * approval logic lives here.
 */
import { Banknote, CreditCard, Landmark, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui-kit";
import { PaymentQrPreview } from "@/components/money/payment-qr";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/lib/wallet-money";

const ICONS: Record<string, typeof Wallet> = {
  cash: Banknote,
  ewallet: Wallet,
  bank: Landmark,
  other: CreditCard,
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-base font-semibold leading-snug sm:text-lg">{value}</p>
    </div>
  );
}

export function PaymentMethodCards({
  methods,
  selectedId,
  onSelect,
}: {
  methods: PaymentMethod[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  if (methods.length === 0) {
    return (
      <EmptyState
        title="No payment methods available"
        description="This shop has not published any receiving accounts yet. Please check back later."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {methods.map((m) => {
        const Icon = ICONS[m.method_type] ?? CreditCard;
        const selected = selectedId === m.id;
        return (
          <Card
            key={m.id}
            onClick={onSelect ? () => onSelect(m.id) : undefined}
            className={cn(
              "border-2 shadow-[var(--shadow-card)] transition-colors",
              onSelect ? "cursor-pointer" : "",
              selected ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <div>
                  <p className="text-lg font-bold">{m.name}</p>
                  {m.label?.trim() ? (
                    <p className="text-xs text-muted-foreground">{m.label.trim()}</p>
                  ) : null}
                  <span className="mt-0.5 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {paymentMethodScopeLabel(m)}
                  </span>
                </div>
              </div>
              <Field label="Payment method" value={m.name} />
              <Field label="Account name" value={m.account_name?.trim() || "—"} />
              <Field label="Account number" value={m.account_number?.trim() || "—"} />
              {m.notes?.trim() ? <Field label="Notes" value={m.notes.trim()} /> : null}
              {m.instructions?.trim() ? (
                <p className="whitespace-pre-line rounded-md bg-muted/60 p-2 text-sm text-muted-foreground">
                  {m.instructions.trim()}
                </p>
              ) : null}
              {m.qr_path ? (
                <PaymentQrPreview path={m.qr_path} name={m.name} compact={!selected} />
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

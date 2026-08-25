import { Card, CardContent } from "@/components/ui/card";

export function OmadaVoucherStatusPanel({ ecosystemId }: { ecosystemId: string | null }) {
  if (!ecosystemId) return null;
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-4 text-sm text-muted-foreground">Loading…</CardContent>
    </Card>
  );
}

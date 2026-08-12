import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RANGE_OPTIONS } from "@/lib/reports";

/**
 * Shared reporting range picker: preset windows plus an optional custom
 * from/to range. Purely presentational — the caller owns the state.
 */
export function ReportRangePicker({
  range,
  onRangeChange,
  from,
  to,
  onFromChange,
  onToChange,
  onExport,
  exportLabel = "Export CSV",
  busy,
}: {
  range: string;
  onRangeChange: (value: string) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onExport?: () => void;
  exportLabel?: string;
  busy?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={range} onValueChange={onRangeChange} className="min-w-0">
          <TabsList className="flex w-full flex-wrap justify-start">
            {RANGE_OPTIONS.map((r) => (
              <TabsTrigger key={r.id} value={r.id}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {onExport ? (
          <Button variant="outline" size="sm" onClick={onExport} disabled={busy} className="shrink-0">
            <Download className="size-4" /> {exportLabel}
          </Button>
        ) : null}
      </div>

      {range === "custom" ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rangeFrom">From</Label>
              <Input
                id="rangeFrom"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => onFromChange(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rangeTo">To</Label>
              <Input
                id="rangeTo"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => onToChange(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

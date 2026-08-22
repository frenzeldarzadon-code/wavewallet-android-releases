import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RANGE_OPTIONS,
  monthValue,
  quarterValue,
  yearChoices,
  yearValue,
} from "@/lib/reports";

/**
 * Shared reporting range picker: preset windows, calendar Month / Quarter /
 * Year periods, and a custom from/to range. Purely presentational — the caller
 * owns the state. Calendar periods reuse the `from` field to carry their
 * selection (`YYYY-MM`, `YYYY-Qn`, `YYYY`).
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
  const years = yearChoices();
  const quarter = /^\d{4}-Q[1-4]$/.test(from) ? from : quarterValue();
  const qYear = quarter.slice(0, 4);
  const qPart = quarter.slice(5);
  const year = /^\d{4}$/.test(from) ? from : yearValue();

  function selectRange(id: string) {
    // Give each calendar period a sensible default selection when switching.
    if (id === "month") onFromChange(monthValue());
    else if (id === "quarter") onFromChange(quarterValue());
    else if (id === "year") onFromChange(yearValue());
    else if (range === "month" || range === "quarter" || range === "year") onFromChange("");
    onRangeChange(id);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={range} onValueChange={selectRange} className="min-w-0">
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

      {range === "month" ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rangeMonth">Month</Label>
              <Input
                id="rangeMonth"
                type="month"
                value={/^\d{4}-\d{2}$/.test(from) ? from : monthValue()}
                onChange={(e) => onFromChange(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {range === "quarter" ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Quarter</Label>
              <Select value={qPart} onValueChange={(v) => onFromChange(`${qYear}-${v}`)}>
                <SelectTrigger id="rangeQuarter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="pointer-events-auto">
                  <SelectItem value="Q1">Q1 · Jan–Mar</SelectItem>
                  <SelectItem value="Q2">Q2 · Apr–Jun</SelectItem>
                  <SelectItem value="Q3">Q3 · Jul–Sep</SelectItem>
                  <SelectItem value="Q4">Q4 · Oct–Dec</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Select value={qYear} onValueChange={(v) => onFromChange(`${v}-${qPart}`)}>
                <SelectTrigger id="rangeQuarterYear">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="pointer-events-auto">
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {range === "year" ? (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Select value={year} onValueChange={onFromChange}>
                <SelectTrigger id="rangeYear">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="pointer-events-auto">
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      ) : null}

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

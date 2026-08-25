/**
 * Omada Open API connection test (read-only).
 *
 * Runs the Super Admin-gated `omadaProbe` server function, which authenticates
 * to the Omada controller with the client-credentials flow using server-side
 * secrets only. No secret, token or voucher code ever reaches the browser.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui-kit";
import { omadaProbe } from "@/lib/omada.functions";

type Report = Awaited<ReturnType<typeof omadaProbe>>;

export function OmadaConnectionCard() {
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const next = await omadaProbe();
      setReport(next);
    } catch (error) {
      toast.error("Omada connection test failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Omada integration</CardTitle>
        <CardDescription>
          Read-only connection check against the Omada controller. Credentials live only in
          backend secrets (OMADA_BASE_URL, OMADA_ID / OMADA_OMADAC_ID, OMADA_CLIENT_ID,
          OMADA_CLIENT_SECRET) and are never shown here. This does not touch voucher products
          or Code Inventory.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button disabled={running} onClick={() => void run()}>
          {running ? "Testing…" : "Test Omada connection"}
        </Button>

        {report && !report.configured ? (
          <p className="text-sm text-destructive">
            Missing backend secrets: {report.missing.join(", ")}. Add them in Project Settings →
            Secrets.
          </p>
        ) : null}

        {report?.configured ? (
          <ul className="space-y-2">
            {report.steps.map((step) => (
              <li key={step.step} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{step.step}</span>
                  <StatusBadge tone={step.ok ? "success" : "danger"}>
                    {step.ok ? "Passed" : "Failed"}
                  </StatusBadge>
                </div>
                <p className="mt-1 break-words text-xs text-muted-foreground">{step.detail}</p>
              </li>
            ))}
            {report.steps.length === 0 ? (
              <li className="text-sm text-muted-foreground">No results returned.</li>
            ) : null}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

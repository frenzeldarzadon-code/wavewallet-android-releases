import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { auditEvents, ecosystems, shortDateTime } from "@/lib/wavewallet";

export const Route = createFileRoute("/super/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — ONE WAVE Super Admin" },
      { name: "description", content: "Immutable log of Super Admin shop access and platform-level changes." },
      { property: "og:title", content: "Audit Trail — ONE WAVE Super Admin" },
      { property: "og:description", content: "Immutable log of Super Admin shop access and platform-level changes." },
    ],
  }),
  component: SuperAudit,
});

function SuperAudit() {
  return (
    <PageSection devSlot="audit.audit-trail"
      title="Audit trail"
      description="Every Super Admin shop access and platform change is recorded."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="divide-y divide-border px-0 py-0">
          {auditEvents.map((e) => {
            const eco = ecosystems.find((x) => x.id === e.ecosystemId);
            return (
              <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.actor} · {e.target}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {eco ? <StatusBadge tone="brand">{eco.name}</StatusBadge> : <StatusBadge>Platform</StatusBadge>}
                  <span className="text-[11px] text-muted-foreground">{shortDateTime(e.at)}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </PageSection>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { RetailOrdersPanel } from "@/components/retail/retail-orders-panel";
export const Route = createFileRoute("/tmp-orders-preview")({
  component: () => (
    <div className="mx-auto max-w-3xl p-3">
      <RetailOrdersPanel ecosystemId="00000000-0000-0000-0000-000000000001" />
    </div>
  ),
});

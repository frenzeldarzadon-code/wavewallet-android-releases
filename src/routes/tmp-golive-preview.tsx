import { createFileRoute } from "@tanstack/react-router";
import { GoLiveCard } from "@/components/subscription/go-live-card";

export const Route = createFileRoute("/tmp-golive-preview")({
  component: () => (
    <div className="p-4">
      <GoLiveCard
        ecosystemId="0b0aee09-64ad-402c-a98e-146a1dfb9779"
        shopName="Preview"
        isLive
        initialIntent="renew"
      />
    </div>
  ),
});

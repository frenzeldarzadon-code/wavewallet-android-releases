import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { UniverseSendCoinsSheet } from "@/components/wallet/universe-send-coins-sheet";

export const Route = createFileRoute("/dev-send-sheet")({
  ssr: false,
  component: () => {
    const [open, setOpen] = useState(true);
    return (
      <div className="p-4">
        <button type="button" onClick={() => setOpen(true)}>open</button>
        <UniverseSendCoinsSheet
          open={open}
          onOpenChange={setOpen}
          senderId="me"
          balance={2628}
          onSent={() => {}}
        />
      </div>
    );
  },
});

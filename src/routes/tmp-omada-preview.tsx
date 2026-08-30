import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/tmp-omada-preview")({
  component: () => (
    <div className="p-4">
      <Tabs defaultValue="connection" className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5">
          {["Connection", "Devices", "Generate", "Status", "Portal"].map((t) => (
            <TabsTrigger key={t} value={t.toLowerCase()} className="h-9 flex-auto px-3 text-xs sm:text-sm">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  ),
});

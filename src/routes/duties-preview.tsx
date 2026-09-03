import { createFileRoute } from "@tanstack/react-router";
import { CodAssignmentsCard } from "@/components/retail/cod-assignments-card";
export const Route = createFileRoute("/duties-preview")({ component: () => <div className="mx-auto max-w-md p-3"><CodAssignmentsCard available={200} /></div> });

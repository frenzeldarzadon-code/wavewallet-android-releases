import { createFileRoute } from "@tanstack/react-router";
import { CodAssignmentsCard } from "@/components/retail/cod-assignments-card";
export const Route = createFileRoute("/__duties-preview")({ component: () => <div className="mx-auto max-w-md p-3"><CodAssignmentsCard available={100} /></div> });

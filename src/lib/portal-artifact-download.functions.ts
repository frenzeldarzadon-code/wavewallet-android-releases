import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { issuePortalArtifactDownload } from "./portal-artifact-download.server";

export const getPortalArtifactDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mappingId: string }) => {
    if (!data?.ecosystemId || !data?.mappingId) throw new Error("A shop and portal are required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const secret = process.env["LOVABLE_API_KEY"];
    if (!secret) throw new Error("Portal downloads are temporarily unavailable.");
    return issuePortalArtifactDownload(context as never, data, secret);
  });
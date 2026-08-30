import { createFileRoute } from "@tanstack/react-router";
import {
  portalArtifactResponse,
  verifyPortalArtifactDownload,
} from "@/lib/portal-artifact-download.server";

export const Route = createFileRoute("/api/portal-template-download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env["LOVABLE_API_KEY"];
        if (!secret) return new Response("Download unavailable.", { status: 503 });
        const token = new URL(request.url).searchParams.get("t") ?? "";
        const claims = verifyPortalArtifactDownload(token, secret);
        if (!claims) return new Response("This download link is invalid or expired.", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("omada_portal_templates")
          .select("file_name, generated_checksum, generated_html")
          .eq("mapping_id", claims.mappingId)
          .eq("ecosystem_id", claims.ecosystemId)
          .eq("generated_checksum", claims.checksum)
          .maybeSingle();
        if (!row?.generated_html || !row.file_name) {
          return new Response("The generated portal page is no longer available.", { status: 404 });
        }
        return portalArtifactResponse(row.generated_html, row.file_name);
      },
    },
  },
});
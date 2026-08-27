/** TEMPORARY diagnostic route — removed after the investigation. */
import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
  const url = new URL(request.url);
  if (url.searchParams.get("t") !== "probe-9139618") return new Response("no", { status: 401 });
  const code = url.searchParams.get("code") ?? "9139618";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { openOmadaSession } = await import("@/lib/omada-api.server");
  const { listAuthorizedClients, loadOmadaSpec, voucherCapabilities, listAllVoucherGroups, findVoucherByCode } =
    await import("@/lib/omada-vouchers.server");
  const session = await openOmadaSession(
    supabaseAdmin as never,
    "3a972878-ff7b-4dfb-8a5b-b681b1c81205",
  );
  const clients = await listAuthorizedClients(session);
  const caps = voucherCapabilities(await loadOmadaSpec(session));
  const groups = await listAllVoucherGroups(session, caps);
  let voucher: unknown = null;
  for (const g of groups) {
    const id = String((g as Record<string, unknown>)["id"] ?? "");
    if (!id) continue;
    const hit = await findVoucherByCode(session, caps, id, code);
    if (hit) {
      voucher = hit;
      break;
    }
  }
  return new Response(
    JSON.stringify({ clientCount: clients.length, sample: clients, voucher }, null, 2),
    { headers: { "content-type": "application/json" } },
  );
}

export const Route = createFileRoute("/api/public/omada-probe-tmp")({
  server: { handlers: { GET: handle } },
});

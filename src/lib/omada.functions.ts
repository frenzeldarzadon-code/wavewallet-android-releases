/**
 * Super Admin-only, read-only Omada connectivity probe.
 *
 * Isolated proof of concept: it touches no WaveWallet table and performs no
 * write of any kind against the Omada controller.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const omadaProbe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isOwner, error } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (error) throw new Error(error.message);
    if (!isOwner) throw new Error("Only the platform owner can run the Omada probe");

    const { runOmadaProbe } = await import("./omada.server");
    return runOmadaProbe();
  });

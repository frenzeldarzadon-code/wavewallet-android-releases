import { createServerFn } from "@tanstack/react-start";
import type { HandoffResolution } from "./portal-handoff";
import { HANDOFF_EXPIRED } from "./portal-handoff";

/**
 * Public: the customer arriving from a hotspot is not signed in yet. The token
 * is validated server-side and only ever yields the shop's public identity.
 */
export const resolvePortalHandoff = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => ({
    token: typeof data?.token === "string" ? data.token.slice(0, 2048) : "",
  }))
  .handler(async ({ data }): Promise<HandoffResolution> => {
    const secret = process.env["LOVABLE_API_KEY"];
    if (!secret || !data.token) return { ok: false, reason: HANDOFF_EXPIRED };
    const { redeemPortalHandoff } = await import("./portal-handoff.server");
    return redeemPortalHandoff(data.token, secret);
  });

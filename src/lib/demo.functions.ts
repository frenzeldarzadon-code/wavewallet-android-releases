import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const roleSchema = z.object({
  // Super Admin is the private platform-owner account: never demo-provisionable.
  role: z.enum(["customer", "reseller", "subreseller", "admin"]),
});


/** Preview-only: returns one-time credentials for a seeded demo account. */
export const startDemoSession = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => roleSchema.parse(data))
  .handler(async ({ data }) => {
    const { provisionDemo } = await import("@/lib/demo.server");
    const request = getRequest();
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return provisionDemo(data.role, host);
  });

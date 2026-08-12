import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const inputSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});

function requestOrigin(): string {
  const request = getRequest();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const proto =
    request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Is the one-time platform-owner setup still available? */
export const superAdminSetupAvailable = createServerFn({ method: "GET" }).handler(async () => {
  const { bootstrapAvailable } = await import("@/lib/bootstrap.server");
  return { available: await bootstrapAvailable() };
});

/** Creates the very first real Super Admin. Role is granted server-side. */
export const createInitialSuperAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const { runBootstrap } = await import("@/lib/bootstrap.server");
    const origin = requestOrigin();
    return runBootstrap({
      fullName: data.fullName,
      email: data.email,
      password: data.password,
      origin,
      source: origin,
    });
  });

/**
 * Preview-only demo account provisioning.
 *
 * SECURITY MODEL
 * - This module runs on the server only and is gated to the Lovable preview /
 *   local dev hosts. On a published production host it refuses to do anything,
 *   so it can never act as a production backdoor.
 * - There is no master password and no auth bypass: demo users are ordinary
 *   Supabase accounts that sign in through the normal password flow. Their
 *   password is rotated to a fresh random value on every provision call, so
 *   nothing reusable is hardcoded in the codebase.
 * - Demo users live in their own isolated ecosystem ("DEMO — Preview Shop").
 *   Existing RLS still applies to them, so they can never read another
 *   ecosystem's real customers, credits, points, vouchers or subscriptions.
 * - The demo super admin can see every ecosystem by design (that is the role),
 *   which is why the super-admin demo is only ever reachable from preview.
 *
 * Omada API is never used here; demo voucher codes are seeded exactly the way
 * an operator would import them manually.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const DEMO_SLUG = "demo-preview";
export const DEMO_ECOSYSTEM_NAME = "DEMO — Preview Shop";

export type DemoRole = "customer" | "reseller" | "subreseller" | "admin" | "super_admin";

const DEMO_USERS: Record<DemoRole, { email: string; name: string; phone: string }> = {
  customer: { email: "demo.customer@wavewallet.demo", name: "Demo Customer", phone: "0900 000 0001" },
  reseller: { email: "demo.reseller@wavewallet.demo", name: "Demo Reseller", phone: "0900 000 0002" },
  subreseller: {
    email: "demo.subreseller@wavewallet.demo",
    name: "Demo Subreseller",
    phone: "0900 000 0005",
  },
  admin: { email: "demo.admin@wavewallet.demo", name: "Demo Operator", phone: "0900 000 0003" },
  super_admin: { email: "demo.super@wavewallet.demo", name: "Demo Platform Owner", phone: "0900 000 0004" },
};

/**
 * Preview hosts only. `project--<id>.lovable.app` (production) and custom
 * domains deliberately fall through to `false`.
 */
export function isPreviewHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0]!;
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost")) return true;
  if (h.startsWith("id-preview--") && h.endsWith(".lovable.app")) return true;
  if (h.endsWith("-dev.lovable.app")) return true;
  if (h.endsWith(".lovableproject.com")) return true;
  return false;
}

function randomPassword(): string {
  return `Demo-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}!`;
}

async function ensureEcosystem(): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("ecosystems")
    .select("id")
    .eq("slug", DEMO_SLUG)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data, error } = await supabaseAdmin
    .from("ecosystems")
    .insert({
      name: DEMO_ECOSYSTEM_NAME,
      slug: DEMO_SLUG,
      description: "Sample data for preview only. Nothing here is a real customer, code or payment.",
      contact_email: "demo@wavewallet.demo",
      contact_phone: "0900 000 0000",
      signup_enabled: true,
      signup_token: "demo-preview-token",
      plan_name: "DEMO plan (not billed)",
      plan_price: 0,
      subscription_state: "active",
      grace_period_days: 7,
      current_period_end: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      credits_per_point: 10,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (data?.id) return data.id;

  // The auth user can exist without (or ahead of) its profile mirror — for
  // example after a partially completed provision. Fall back to the auth
  // directory so we never try to create a duplicate account.
  for (let page = 1; page <= 20; page++) {
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = list.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (list.users.length < 200) return null;
  }
  return null;
}


async function ensureUser(role: DemoRole, ecosystemId: string): Promise<string> {
  const spec = DEMO_USERS[role];
  const existing = await findUserIdByEmail(spec.email);
  if (existing) return existing;

  // Operator roles are granted the same way real operators are onboarded: through
  // a pending invitation the signup trigger validates. No special-case role write.
  // A pending invite may already exist from an earlier, interrupted provision —
  // refresh it instead of inserting a duplicate (a unique index forbids two).
  if (role === "admin" || role === "super_admin") {
    const invite = {
      email: spec.email,
      ecosystem_id: role === "admin" ? ecosystemId : null,
      role,
      status: "pending" as const,
      invited_by_name: "Preview demo",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const { data: pending } = await supabaseAdmin
      .from("admin_invitations")
      .select("id")
      .eq("email", spec.email)
      .eq("status", "pending")
      .maybeSingle();
    if (pending?.id) {
      await supabaseAdmin.from("admin_invitations").update(invite).eq("id", pending.id);
    } else {
      const { error: inviteError } = await supabaseAdmin.from("admin_invitations").insert(invite);
      if (inviteError) throw new Error(inviteError.message);
    }
  }


  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: spec.email,
    password: randomPassword(),
    email_confirm: true,
    user_metadata: {
      full_name: spec.name,
      phone: spec.phone,
      demo: true,
      ...(role === "customer" || role === "reseller" || role === "subreseller"
        ? { ecosystem_slug: DEMO_SLUG }
        : {}),
    },
  });
  if (error || !data.user) throw new Error(error?.message ?? "Could not create the demo account");

  if (role === "reseller" || role === "subreseller") {
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user.id).eq("role", "customer");
    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.user.id, role, ecosystem_id: ecosystemId });
    await supabaseAdmin
      .from("profiles")
      // Credit-LOADING commission is reseller-only. Customer-purchase credit-back
      // applies to both roles and inherits the shop default (sale_commission_percent = null).
      .update({
        reseller_discount_percent: role === "reseller" ? 15 : 8,
        reseller_commission_percent: role === "reseller" ? 20 : 0,
        sale_commission_percent: null,
      })
      .eq("id", data.user.id);
  }
  return data.user.id;
}

async function seedSampleData(ecosystemId: string, ids: Record<DemoRole, string>) {
  const { count } = await supabaseAdmin
    .from("voucher_products")
    .select("id", { count: "exact", head: true })
    .eq("ecosystem_id", ecosystemId);
  if ((count ?? 0) > 0) return; // already seeded

  // Customer belongs to the demo reseller so reseller screens have someone to manage.
  await supabaseAdmin
    .from("profiles")
    .update({ reseller_id: ids.reseller })
    .eq("id", ids.customer);

  // --- Sample wallets (ledger-driven, exactly like production) ---
  const seedCredit = async (userId: string, amount: number, reason: string) => {
    const { data: acct } = await supabaseAdmin
      .from("credit_accounts")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!acct) return;
    await supabaseAdmin.from("credit_ledger").insert({
      account_id: acct.id,
      user_id: userId,
      ecosystem_id: ecosystemId,
      direction: "coin",
      amount,
      balance_after: 0,
      reason,
      reference: "DEMO",
      tx_id: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    });
  };
  await seedCredit(ids.customer, 850, "DEMO — sample coin load");
  await seedCredit(ids.reseller, 5000, "DEMO — sample reseller float");
  await seedCredit(ids.subreseller, 1500, "DEMO — sample subreseller float");

  const { data: pAcct } = await supabaseAdmin
    .from("points_accounts")
    .select("id")
    .eq("user_id", ids.customer)
    .maybeSingle();
  if (pAcct) {
    await supabaseAdmin.from("points_ledger").insert({
      account_id: pAcct.id,
      user_id: ids.customer,
      ecosystem_id: ecosystemId,
      direction: "coin",
      amount: 12,
      balance_after: 0,
      reason: "DEMO — sample points earned (10 coins = 1 pt)",
      reference: "DEMO",
      tx_id: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      entry_type: "earn",
      credits_basis: 120,
      credits_per_point_used: 10,
      points_rule_version: 1,
    });
  }

  // --- Sample voucher catalogue + manually imported codes ---
  const { data: products } = await supabaseAdmin
    .from("voucher_products")
    .insert([
      {
        ecosystem_id: ecosystemId,
        name: "DEMO 1-Day Unlimited",
        description: "Sample product — 24 hours of sample access.",
        credit_price: 50,
        points_price: 60,
        active: true,
      },
      {
        ecosystem_id: ecosystemId,
        name: "DEMO 3-Hour Pass",
        description: "Sample product — short session pass.",
        credit_price: 20,
        points_price: 25,
        active: true,
      },
      {
        ecosystem_id: ecosystemId,
        name: "DEMO Weekly Saver",
        description: "Sample promo product for testing discounts.",
        credit_price: 250,
        promo_price: 199,
        promo_note: "DEMO promo",
        active: true,
      },
    ])
    .select("id, name");

  for (const p of products ?? []) {
    const codes = Array.from({ length: 8 }, (_, i) => ({
      ecosystem_id: ecosystemId,
      product_id: p.id,
      code: `DEMO-${p.name.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
      status: "unused",
    }));
    await supabaseAdmin.from("voucher_codes").insert(codes);
  }

  // --- Sample rewards catalogue ---
  await supabaseAdmin.from("reward_products").insert([
    {
      ecosystem_id: ecosystemId,
      name: "DEMO Tumbler",
      description: "Sample physical reward for preview testing.",
      points_price: 40,
      stock: 5,
      active: true,
    },
    {
      ecosystem_id: ecosystemId,
      name: "DEMO Cap",
      description: "Sample physical reward — no image on purpose.",
      points_price: 25,
      stock: 3,
      active: true,
    },
  ]);

  await supabaseAdmin.from("audit_logs").insert({
    ecosystem_id: ecosystemId,
    actor_name: "Preview demo",
    action: "Seeded demo sample data",
    target: DEMO_ECOSYSTEM_NAME,
    metadata: { note: "Preview environment only — no real customer data" },
  });
}

export interface DemoCredentials {
  email: string;
  password: string;
  role: DemoRole;
  label: string;
}

/** Provisions (or refreshes) a demo account and returns one-time sign-in credentials. */
export async function provisionDemo(role: DemoRole, host: string | null): Promise<DemoCredentials> {
  if (!isPreviewHost(host)) {
    throw new Error("Demo access is only available in the Lovable preview environment.");
  }
  const ecosystemId = await ensureEcosystem();

  const ids = {} as Record<DemoRole, string>;
  for (const r of ["admin", "reseller", "subreseller", "customer", "super_admin"] as DemoRole[]) {
    ids[r] = await ensureUser(r, ecosystemId);
  }
  await seedSampleData(ecosystemId, ids);

  // Rotate the password every time: nothing long-lived is ever shared or stored.
  const password = randomPassword();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(ids[role], { password });
  if (error) throw new Error(error.message);

  return { email: DEMO_USERS[role].email, password, role, label: DEMO_USERS[role].name };
}

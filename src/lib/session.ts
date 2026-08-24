import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadAuthContext, type AuthContext, type DbEcosystem } from "@/lib/auth";
import { endImpersonation } from "@/lib/impersonation";
import { ecosystems, type Account, type Ecosystem, type Role } from "@/lib/wavewallet";

const KEY = "wavewallet.session";

/** Local-only UI state (super admin impersonation). Never an authorization source. */
export interface Session {
  accountId: string;
  superAdminMode?: boolean;
  ecosystemId?: string | null;
}

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function writeSession(s: Session | null) {
  if (typeof window === "undefined") return;
  if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
  else window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("wavewallet:session"));
}

export const homeFor = (role: Role) =>
  role === "super_admin"
    ? "/super"
    : role === "admin"
      ? "/admin"
      : role === "reseller" || role === "subreseller"
        ? "/reseller"
        : "/app";

/**
 * Where a member lands right after signing in. Their last valid active shop is
 * remembered by the database (`profiles.active_ecosystem_id`, re-authorized on
 * every load), and selling members open straight in that shop's Voucher Shop.
 */
export const shopHomeFor = (role: Role) =>
  role === "customer"
    ? "/app/shop"
    : role === "reseller" || role === "subreseller"
      ? "/reseller/shop"
      : homeFor(role);

/** The My Shops screen — the only shop list an ordinary member ever sees. */
export const MY_SHOPS_PATH = "/universe/shops";

export interface LandingMembership {
  ecosystemId: string;
  role: Role;
  isActive: boolean;
}

/**
 * Landing decision for a member who belongs to shops.
 *
 * - no shop at all → the Universe, which is open to everyone
 * - exactly one shop → open it (switching first when it is not the active one)
 * - several shops with a last-used one → open that one
 * - several shops and no last-used one → My Shops, so nothing is guessed
 *
 * Universe stays reachable from navigation; it is simply not the default for
 * members who belong to a shop.
 */
export function landingForMemberships(list: LandingMembership[]): {
  to: string;
  switchTo: string | null;
} {
  if (list.length === 0) return { to: "/universe", switchTo: null };
  const active = list.find((m) => m.isActive);
  if (list.length === 1) {
    const only = list[0]!;
    return { to: shopHomeFor(only.role), switchTo: only.isActive ? null : only.ecosystemId };
  }
  if (active) return { to: shopHomeFor(active.role), switchTo: null };
  return { to: MY_SHOPS_PATH, switchTo: null };
}


/** Subresellers share the reseller workspace — the database still authorizes every action. */
const roleSatisfies = (role: Role, required: Role) =>
  role === required ||
  role === "super_admin" ||
  (required === "reseller" && role === "subreseller");

export interface ResolvedSession {
  ready: boolean;
  session: Session | null;
  account: Account | null;
  ecosystem: Ecosystem | null;
  /** Real database id of the ecosystem — use this for every Cloud query. */
  ecosystemDbId: string | null;
  /** Subscription is active (or inside its grace period). */
  subscriptionOk: boolean;
  /** Present while an authorized operator is acting as this account. */
  actingAs: AuthContext["actingAs"];
  /** Leaves the acted-as account and returns the operator to their own console. */
  exitActingAs: () => void;
  reload: () => void;
  signOut: () => void;
}

/** Maps a database ecosystem row onto the UI ecosystem shape. */
function toEcosystem(row: DbEcosystem): Ecosystem {
  const demo = ecosystems.find((e) => e.slug === row.slug);
  const base: Ecosystem =
    demo ??
    ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      facebookPageName: "",
      facebookPageUrl: "",
      facebookSupportMessage: "",
      pointsPerPeso: 10,
      createdAt: new Date().toISOString(),
      subscription: {
        id: row.id,
        ecosystemId: row.id,
        planName: row.plan_name,
        priceMonthly: Number(row.plan_price),
        status: row.subscription_state,
        currentPeriodEnd: row.current_period_end ?? new Date().toISOString(),
        gracePeriodDays: row.grace_period_days,
      },
    } as unknown as Ecosystem);

  return {
    ...base,
    name: row.name,
    slug: row.slug,
    // Always mirror the stored value, so clearing the description in Shop
    // settings is reflected after reload instead of falling back to a preset.
    description: row.description ?? "",

    contactEmail: row.contact_email ?? base.contactEmail,
    contactName: row.contact_name ?? "",
    contactPhone: row.contact_phone ?? base.contactPhone,
    // Configured by the platform owner per ecosystem — never hard-coded.
    facebookPageUrl: row.facebook_page_url ?? "",
    facebookPageName: row.facebook_page_name ?? "",
    subscription: {
      ...base.subscription,
      planName: row.plan_name,
      priceMonthly: Number(row.plan_price),
      status: row.subscription_state,
      gracePeriodDays: row.grace_period_days,
      currentPeriodEnd: row.current_period_end ?? base.subscription.currentPeriodEnd,
      ...(row.payment_reference ? { paymentReference: row.payment_reference } : {}),
      ...(row.submitted_at ? { submittedAt: row.submitted_at } : {}),
      ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
    },
  };
}

function toAccount(ctx: AuthContext, ecosystem: Ecosystem | null): Account {
  return {
    id: ctx.profile.id,
    ecosystemId: ecosystem?.id ?? null,
    role: ctx.role,
    name: ctx.profile.full_name || ctx.profile.email,
    email: ctx.profile.email,
    phone: ctx.profile.phone,
    resellerId: ctx.profile.reseller_id,
    discountPercent: ctx.profile.reseller_discount_percent,
    creditBalance: ctx.wallets.credits,
    pointsBalance: ctx.wallets.points,
    pointsHeld: ctx.wallets.pointsHeld,
    status: ctx.profile.status,
    joinedAt: ctx.profile.joined_at,
  };
}

/**
 * Authenticated session + tenant scope. Route gating here is UX only —
 * the database enforces who may read or write what.
 */
export function useSession(requiredRole?: Role): ResolvedSession {
  const navigate = useNavigate();
  const [local, setLocal] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<AuthContext | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const sync = () => setLocal(readSession());
    sync();

    const load = () => {
      loadAuthContext()
        .then((c) => {
          if (!active) return;
          setCtx(c);
          setReady(true);
        })
        .catch(() => active && setReady(true));
    };
    load();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") load();
    });
    window.addEventListener("wavewallet:session", sync);
    window.addEventListener("storage", sync);
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("wavewallet:session", sync);
      window.removeEventListener("storage", sync);
    };
  }, [version]);

  // Super Admin Mode: a platform owner may work inside any tenant. The impersonated
  // ecosystem is loaded from the database (RLS lets super admins read every row);
  // it never widens permissions — the database still authorizes each statement.
  const [impersonated, setImpersonated] = useState<DbEcosystem | null>(null);
  const targetEcoId = local?.ecosystemId ?? null;
  useEffect(() => {
    let active = true;
    if (!ctx || ctx.role !== "super_admin" || !targetEcoId) {
      setImpersonated(null);
      return;
    }
    supabase
      .from("ecosystems")
      .select("*")
      .eq("id", targetEcoId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setImpersonated((data as DbEcosystem | null) ?? null);
      });
    return () => {
      active = false;
    };
  }, [ctx, targetEcoId]);

  const activeEco = impersonated ?? ctx?.ecosystem ?? null;
  const ecosystem = activeEco ? toEcosystem(activeEco) : null;
  const account = ctx ? toAccount(ctx, ecosystem) : null;

  useEffect(() => {
    if (!ready) return;
    if (!account) {
      navigate({ to: "/", replace: true });
      return;
    }
    if (requiredRole && !roleSatisfies(account.role, requiredRole)) {
      navigate({ to: homeFor(account.role), replace: true });
    }
  }, [ready, account, requiredRole, navigate]);

  const signOut = useCallback(async () => {
    // Never leave a delegation open behind a sign-out.
    await endImpersonation().catch(() => undefined);
    writeSession(null);
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }, [navigate]);

  const operatorRole = ctx?.actingAs?.operatorRole;
  const exitActingAs = useCallback(async () => {
    await endImpersonation();
    setVersion((n) => n + 1);
    navigate({ to: homeFor(operatorRole ?? "admin"), replace: true });
  }, [navigate, operatorRole]);

  return {
    ready,
    subscriptionOk: ctx?.role === "super_admin" ? true : (ctx?.subscriptionOk ?? false),
    reload: () => setVersion((n) => n + 1),
    session: account ? { accountId: account.id, ...(local ?? {}) } : null,
    account,
    ecosystem,
    ecosystemDbId: activeEco?.id ?? null,
    actingAs: ctx?.actingAs ?? null,
    exitActingAs: () => void exitActingAs(),
    signOut,
  };
}

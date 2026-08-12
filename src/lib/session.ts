import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadAuthContext, type AuthContext, type DbEcosystem } from "@/lib/auth";
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
  role === "super_admin" ? "/super" : role === "admin" ? "/admin" : role === "reseller" ? "/reseller" : "/app";

export interface ResolvedSession {
  ready: boolean;
  session: Session | null;
  account: Account | null;
  ecosystem: Ecosystem | null;
  /** Real database id of the ecosystem — use this for every Cloud query. */
  ecosystemDbId: string | null;
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
        status: "active",
        currentPeriodEnd: row.subscription_active_until ?? new Date().toISOString(),
        graceDays: 5,
        history: [],
      },
    } as unknown as Ecosystem);

  return {
    ...base,
    name: row.name,
    slug: row.slug,
    description: row.description ?? base.description,
    contactEmail: row.contact_email ?? base.contactEmail,
    contactPhone: row.contact_phone ?? base.contactPhone,
    subscription: {
      ...base.subscription,
      planName: row.plan_name,
      priceMonthly: Number(row.plan_price),
      currentPeriodEnd: row.subscription_active_until ?? base.subscription.currentPeriodEnd,
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
    creditBalance: 0,
    pointsBalance: 0,
    pointsHeld: 0,
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
  }, []);

  const ecosystem = ctx?.ecosystem ? toEcosystem(ctx.ecosystem) : null;
  const account = ctx ? toAccount(ctx, ecosystem) : null;

  useEffect(() => {
    if (!ready) return;
    if (!account) {
      navigate({ to: "/", replace: true });
      return;
    }
    if (requiredRole && account.role !== requiredRole && account.role !== "super_admin") {
      navigate({ to: homeFor(account.role), replace: true });
    }
  }, [ready, account, requiredRole, navigate]);

  const signOut = useCallback(async () => {
    writeSession(null);
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  }, [navigate]);

  return {
    ready,
    session: account ? { accountId: account.id, ...(local ?? {}) } : null,
    account,
    ecosystem,
    ecosystemDbId: ctx?.ecosystem?.id ?? null,
    signOut,
  };
}

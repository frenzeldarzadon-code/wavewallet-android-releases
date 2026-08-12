import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { accounts, ecosystems, type Account, type Role } from "@/lib/wavewallet";

const KEY = "wavewallet.session";

export interface Session {
  accountId: string;
  /** Set when a super admin is impersonating a tenant ecosystem. */
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
  ecosystem: (typeof ecosystems)[number] | null;
  signOut: () => void;
}

/**
 * Demo session hook. Replaced by Supabase auth + user_roles later; the shape
 * (account + tenant scope) is what the rest of the app depends on.
 */
export function useSession(requiredRole?: Role): ResolvedSession {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setSession(readSession());
    sync();
    setReady(true);
    window.addEventListener("wavewallet:session", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("wavewallet:session", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const account = session ? (accounts.find((a) => a.id === session.accountId) ?? null) : null;

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

  const ecosystemId = session?.ecosystemId ?? account?.ecosystemId ?? null;
  const ecosystem = ecosystems.find((e) => e.id === ecosystemId) ?? null;

  const signOut = useCallback(() => {
    writeSession(null);
    navigate({ to: "/", replace: true });
  }, [navigate]);

  return { ready, session, account, ecosystem, signOut };
}

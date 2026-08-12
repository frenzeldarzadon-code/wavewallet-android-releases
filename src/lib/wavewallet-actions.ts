/**
 * Mutations for the WaveWallet demo store.
 *
 * Every mutation goes through an authorization guard here — the UI never
 * decides who is allowed to do what, it only renders the result. When Lovable
 * Cloud is added these functions map 1:1 to RLS-protected RPCs:
 *   - `assertCan` becomes a `has_role(auth.uid(), ...)` + ecosystem_id check
 *   - `logAudit` becomes an insert into `audit_events`
 */
import {
  accounts,
  auditEvents,
  ecosystems,
  type Account,
  type Ecosystem,
} from "@/lib/wavewallet";
import { useEffect, useState } from "react";

export class PermissionError extends Error {}

const DATA_EVENT = "wavewallet:data";

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DATA_EVENT));
}

/** Re-renders a component whenever the demo store mutates. */
export function useDataVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((n) => n + 1);
    window.addEventListener(DATA_EVENT, bump);
    return () => window.removeEventListener(DATA_EVENT, bump);
  }, []);
  return v;
}

/* ------------------------------------------------------------------ */
/* Authorization                                                       */
/* ------------------------------------------------------------------ */

/**
 * Throws unless the actor may administer the given ecosystem.
 * Super admins pass for any ecosystem; admins only for their own.
 */
export function assertCanAdminister(actorId: string | undefined, ecosystemId: string): Account {
  const actor = actorId ? accounts.find((a) => a.id === actorId) : undefined;
  if (!actor || actor.status !== "active") throw new PermissionError("Not signed in.");
  if (actor.role === "super_admin") return actor;
  if (actor.role === "admin" && actor.ecosystemId === ecosystemId) return actor;
  throw new PermissionError("You do not have permission to manage this ecosystem.");
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export function logAudit(entry: {
  actor: string;
  action: string;
  target: string;
  ecosystemId?: string;
}) {
  auditEvents.unshift({
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    ...entry,
  });
  notify();
}

/* ------------------------------------------------------------------ */
/* Signup / login                                                      */
/* ------------------------------------------------------------------ */

export const ecosystemBySlug = (slug: string): Ecosystem | undefined =>
  ecosystems.find((e) => e.slug.toLowerCase() === slug.toLowerCase());

export const signupPath = (slug: string) => `/join/${slug}`;

export const signupUrl = (slug: string) =>
  `${typeof window === "undefined" ? "https://wavewallet.app" : window.location.origin}${signupPath(slug)}`;

export interface SignupInput {
  ecosystemSlug: string;
  name: string;
  email: string;
  phone: string;
}

/**
 * Public signup. Always creates a `customer` scoped to the ecosystem behind
 * the invite link — role is never accepted from the client.
 */
export function signUpCustomer(input: SignupInput): Account {
  const eco = ecosystemBySlug(input.ecosystemSlug);
  if (!eco) throw new PermissionError("That signup link is not valid.");

  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) throw new PermissionError("Enter your full name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PermissionError("Enter a valid email address.");
  if (accounts.some((a) => a.email.toLowerCase() === email))
    throw new PermissionError("An account already exists for that email.");

  const account: Account = {
    id: `acc_cus_${Date.now().toString(36)}`,
    ecosystemId: eco.id,
    role: "customer", // never client-controlled
    name: input.name.trim(),
    email,
    phone: input.phone.trim(),
    resellerId: null,
    creditBalance: 0,
    pointsBalance: 0,
    status: "active",
    joinedAt: new Date().toISOString(),
  };
  accounts.push(account);
  logAudit({
    actor: account.name,
    action: "Customer signed up via ecosystem link",
    target: `${account.email} — ${eco.name}`,
    ecosystemId: eco.id,
  });
  return account;
}

export function findAccountByLogin(identifier: string): Account | undefined {
  const v = identifier.trim().toLowerCase();
  if (!v) return undefined;
  const digits = v.replace(/\D/g, "");
  return accounts.find(
    (a) => a.email.toLowerCase() === v || (digits.length >= 7 && a.phone.replace(/\D/g, "") === digits),
  );
}

/* ------------------------------------------------------------------ */
/* Role management                                                     */
/* ------------------------------------------------------------------ */

export const MIN_DISCOUNT = 0;
export const MAX_DISCOUNT = 50;

/**
 * Promotes an existing customer to reseller in place — the account row keeps
 * its id, so credits, points, purchases and ledger history are preserved.
 */
export function promoteToReseller(
  actorId: string | undefined,
  customerId: string,
  discountPercent: number,
): Account {
  const target = accounts.find((a) => a.id === customerId);
  if (!target || !target.ecosystemId) throw new PermissionError("Customer not found.");
  const actor = assertCanAdminister(actorId, target.ecosystemId);
  if (target.role !== "customer") throw new PermissionError("Only customers can be promoted to reseller.");
  const discount = clampDiscount(discountPercent);

  target.role = "reseller";
  target.discountPercent = discount;
  target.resellerId = null; // a reseller is no longer under another reseller

  logAudit({
    actor: actor.name,
    action: `Promoted customer to reseller (${discount}% discount)`,
    target: `${target.name} — balances preserved: ₱${target.creditBalance} credits, ${target.pointsBalance} pts`,
    ecosystemId: target.ecosystemId,
  });
  notify();
  return target;
}

export function setResellerDiscount(
  actorId: string | undefined,
  resellerId: string,
  discountPercent: number,
): Account {
  const target = accounts.find((a) => a.id === resellerId);
  if (!target || !target.ecosystemId) throw new PermissionError("Reseller not found.");
  const actor = assertCanAdminister(actorId, target.ecosystemId);
  if (target.role !== "reseller") throw new PermissionError("That account is not a reseller.");
  const discount = clampDiscount(discountPercent);
  const previous = target.discountPercent ?? 0;
  target.discountPercent = discount;

  logAudit({
    actor: actor.name,
    action: `Updated reseller discount ${previous}% → ${discount}%`,
    target: target.name,
    ecosystemId: target.ecosystemId,
  });
  notify();
  return target;
}

function clampDiscount(n: number) {
  if (Number.isNaN(n)) throw new PermissionError("Enter a valid discount percentage.");
  if (n < MIN_DISCOUNT || n > MAX_DISCOUNT)
    throw new PermissionError(`Discount must be between ${MIN_DISCOUNT}% and ${MAX_DISCOUNT}%.`);
  return Math.round(n);
}

/**
 * The member's own "Applications & Invites" inbox.
 *
 * Two independent things live here:
 *  - Applications the member SUBMITTED to a shop (pending / approved / rejected).
 *  - Invitations a shop SENT to the member, waiting for accept or decline.
 *
 * Everything is read-only convenience: the database decides which rows exist,
 * refuses duplicate pending invitations, refuses invites to existing members,
 * and re-authorizes every accept/decline. Accepting creates a membership in
 * that ONE shop and never moves credits, points, cashback or history.
 */
import {
  fetchMyApplications,
  fetchMyMemberships,
  type Membership,
  type MyApplicationRow,
} from "@/lib/memberships";
import { fetchMyInvitations, type MyInvitation } from "@/lib/shop-invitations";

export interface MemberInbox {
  applications: MyApplicationRow[];
  invitations: MyInvitation[];
  memberships: Membership[];
}

export const emptyInbox: MemberInbox = {
  applications: [],
  invitations: [],
  memberships: [],
};

/** Loads both sections plus memberships (to label "already a member"). */
export async function fetchMemberInbox(): Promise<MemberInbox> {
  const [applications, invitations, memberships] = await Promise.all([
    fetchMyApplications(),
    fetchMyInvitations(),
    fetchMyMemberships(),
  ]);
  return { applications, invitations, memberships };
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** True when the member already holds an active membership in that shop. */
export function isAlreadyMember(memberships: Membership[], ecosystemId: string): boolean {
  return memberships.some(
    (m) => m.ecosystemId === ecosystemId && m.membershipState === "active",
  );
}

/**
 * Invitations worth acting on: pending, not expired, and not for a shop the
 * member already belongs to. Shop isolation is preserved — every invitation is
 * evaluated on its own shop, never merged across shops.
 */
export function actionableInvitations(
  invitations: MyInvitation[],
  memberships: Membership[] = [],
  now = new Date(),
): MyInvitation[] {
  return invitations.filter(
    (i) =>
      i.status === "pending" &&
      (!i.expires_at || new Date(i.expires_at).getTime() > now.getTime()) &&
      !isAlreadyMember(memberships, i.ecosystem_id),
  );
}

/** Invitations that arrived for a shop the member already joined. */
export function redundantInvitations(
  invitations: MyInvitation[],
  memberships: Membership[],
): MyInvitation[] {
  return invitations.filter(
    (i) => i.status === "pending" && isAlreadyMember(memberships, i.ecosystem_id),
  );
}

/** Applications still awaiting a decision. */
export function pendingApplications(applications: MyApplicationRow[]): MyApplicationRow[] {
  return applications.filter((a) => a.status === "pending");
}

/**
 * Badge count for the "Applications & Invites" tab: pending applications plus
 * actionable invitations. Zero means no badge is shown.
 */
export function inboxPendingCount(inbox: MemberInbox, now = new Date()): number {
  return (
    pendingApplications(inbox.applications).length +
    actionableInvitations(inbox.invitations, inbox.memberships, now).length
  );
}

/** Newest first, so the most recent invitation is answered first. */
export function sortByNewest<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** Only one invitation per shop can be pending; guards a doubled render. */
export function dedupeByShop(invitations: MyInvitation[]): MyInvitation[] {
  const seen = new Set<string>();
  return sortByNewest(invitations).filter((i) => {
    if (seen.has(i.ecosystem_id)) return false;
    seen.add(i.ecosystem_id);
    return true;
  });
}

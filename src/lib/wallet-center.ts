/**
 * Wallet Center data layer — one place for every wallet the signed-in person
 * owns, the history of each, and every transfer they are allowed to make.
 *
 * Nothing here is an authorization layer. `my_shop_wallets` / `my_memberships`
 * only describe the caller's own memberships, `wallet_upward_recipients` is
 * decided entirely in the database, and `transfer_credits_in_shop` re-checks
 * shop membership, the roles inside that shop and the parent/admin
 * relationship before moving a single credit. The helpers below simply keep
 * the UI honest so the button state matches what the database would accept.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchMyMemberships } from "@/lib/memberships";
import { fetchMyShopWallets } from "@/lib/shop-transfers";
import { friendlyWalletError } from "@/lib/wallet";
import type { Role } from "@/lib/wavewallet";

export interface WalletShop {
  ecosystemId: string;
  ecosystemName: string;
  balance: number;
  /** Role held inside THIS shop — roles never span shops. */
  role: Role | null;
}

export interface UpwardRecipient {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  /** 'reseller' = the sender's own parent reseller, 'admin' = an admin of that shop. */
  relation: "reseller" | "admin";
}

/** Anyone the caller may send credits to inside ONE shop, as decided by the database. */
export interface ShopRecipient {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  /** Role held inside this shop. */
  role: Role | null;
  /** How they relate to the caller: admin / reseller (my parent) / subreseller (my downline) / customer. */
  relation: string;
}


/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Total credits held across every shop wallet. */
export const totalWalletBalance = (shops: WalletShop[]): number =>
  round2(shops.reduce((sum, s) => sum + Number(s.balance || 0), 0));

/** Balance the source wallet is left with after a transfer. Never negative. */
export const projectedBalance = (balance: number, amount: number): number =>
  round2(Math.max(0, (Number(balance) || 0) - (Number(amount) || 0)));

/** Only a subreseller of the selected shop has an upward path. */
export const canSendUpward = (shop: WalletShop | null): boolean =>
  shop?.role === "subreseller";

/** The one reason a shop-scoped transfer cannot be submitted, or null. */
export function validateInShopTransfer(input: {
  ecosystemId: string | null;
  recipientId: string | null;
  amount: number;
  balance: number;
}): string | null {
  const { ecosystemId, recipientId, amount, balance } = input;
  if (!ecosystemId) return "Choose which shop wallet to send from.";
  if (!recipientId) return "Choose a recipient.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter a positive amount.";
  if (amount > balance) return "That is more than this shop wallet holds.";
  return null;
}

/** Human label for an upward recipient. */
export const upwardRelationLabel = (relation: UpwardRecipient["relation"]): string =>
  relation === "reseller" ? "My reseller" : "Shop admin";

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

/** Every shop wallet the caller owns, with the role they hold in that shop. */
export async function fetchWalletShops(): Promise<WalletShop[]> {
  const [wallets, memberships] = await Promise.all([fetchMyShopWallets(), fetchMyMemberships()]);
  const roleOf = new Map(memberships.map((m) => [m.ecosystemId, m.role]));
  return wallets.map((w) => ({
    ecosystemId: w.ecosystemId,
    ecosystemName: w.ecosystemName,
    balance: Number(w.balance ?? 0),
    role: roleOf.get(w.ecosystemId) ?? null,
  }));
}

/**
 * Who a subreseller may send credits UP to inside one shop: their own parent
 * reseller (only when that reseller is active in the same shop) and every
 * active admin of that shop. Empty for anyone else — the database decides.
 */
export async function fetchUpwardRecipients(ecosystemId: string): Promise<UpwardRecipient[]> {
  const { data, error } = await supabase.rpc("wallet_upward_recipients", {
    _ecosystem_id: ecosystemId,
  });
  if (error) return [];
  return ((data ?? []) as unknown as UpwardRecipient[]).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    handle: r.handle ?? null,
    avatar_path: r.avatar_path ?? null,
    relation: r.relation === "reseller" ? "reseller" : "admin",
  }));
}

/** Face-value transfer from ONE of the caller's own shop wallets. */
export async function transferInShop(input: {
  ecosystemId: string;
  recipientId: string;
  amount: number;
  note?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("transfer_credits_in_shop", {
    _ecosystem_id: input.ecosystemId,
    _recipient_id: input.recipientId,
    _amount: input.amount,
    ...(input.note ? { _note: input.note } : {}),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return (data ?? "") as unknown as string;
}

/* ------------------------------------------------------------------ */
/* Eligible recipients inside one shop                                 */
/* ------------------------------------------------------------------ */

/**
 * True when the viewer holds no operator/reseller position in the selected
 * shop. Customers never see other members' internal positions — see
 * `recipientRelationLabel`.
 */
export function isCustomerViewer(role: Role | null): boolean {
  return role !== "admin" && role !== "super_admin" && role !== "reseller" && role !== "subreseller";
}

/**
 * Human label for how a recipient relates to the sender.
 *
 * Business rule: a customer is NOT attached to one upline and must never be
 * shown another member's internal platform position (Admin / Reseller /
 * Subreseller). For a customer viewer every eligible recipient is simply
 * someone who can accept their credits.
 */
export function recipientRelationLabel(relation: string, viewerRole: Role | null = null): string {
  if (isCustomerViewer(viewerRole)) {
    return relation === "customer" ? "Member of this shop" : "Can accept your credits";
  }
  switch (relation) {
    case "admin":
      return "Shop admin";
    case "reseller":
      return "My reseller";
    case "subreseller":
      return "My subreseller";
    case "customer":
      return "Customer";
    default:
      return "Member";
  }
}


/**
 * The heading for the upline/downline section, given the caller's role in the
 * selected shop. Purely cosmetic — the database decides who may receive.
 */
export function transferSectionTitle(role: Role | null): string {
  switch (role) {
    case "subreseller":
      return "Send credits to my reseller, shop admin or customers";
    case "reseller":
      return "Send credits to my subresellers or customers";
    case "admin":
    case "super_admin":
      return "Send credits to members of this shop";
    default:
      return "Send credits to this shop's admin, reseller, subreseller or another customer";

  }
}

/** Why the list can be empty, worded for the person looking at it. */
export function emptyRecipientsHint(role: Role | null): string {
  switch (role) {
    case "subreseller":
      return "No eligible upline or downline transfers for this shop yet — your reseller and shop admins appear here once they are active members of it.";
    case "reseller":
      return "No eligible downline transfers for this shop yet — your subresellers and this shop's customers appear here.";
    case "admin":
    case "super_admin":
      return "No other active members in this shop yet.";
    default:
      return "No eligible recipients for this shop yet — customers of this shop appear here once they are approved.";
  }
}

/** Every member the caller may send credits to in one shop. Database-authorized. */
export async function fetchShopRecipients(
  ecosystemId: string,
  search?: string,
): Promise<ShopRecipient[]> {
  const { data, error } = await supabase.rpc("wallet_shop_recipients", {
    _ecosystem_id: ecosystemId,
    ...(search && search.trim() ? { _search: search.trim() } : {}),
  });
  if (error) return [];
  return ((data ?? []) as unknown as ShopRecipient[]).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    handle: r.handle ?? null,
    avatar_path: r.avatar_path ?? null,
    role: (r.role ?? null) as Role | null,
    relation: r.relation ?? "customer",
  }));
}

/* ------------------------------------------------------------------ */
/* Recipient type tabs inside the one "Send credits" area              */
/* ------------------------------------------------------------------ */

/**
 * The recipient modes offered in the Send credits area. They only slice the
 * server-authorized list — no tab can widen who may receive credits.
 *
 *  - `network`  upline/downline members (shop admin, my reseller, my subreseller)
 *  - `customer` customers of the selected shop (operators, resellers, subresellers)
 *  - `peer`     the same customers, worded for a customer sending to a peer
 *  - `shops`    my own wallets in other shops (cross-shop move, flat fee)
 */
export type RecipientTab = "network" | "customer" | "peer" | "shops";

export interface RecipientTabOption {
  key: RecipientTab;
  label: string;
}

/**
 * Which recipient modes make sense for this role in this shop.
 *
 * The cross-shop mode is ALWAYS offered — it is a standing platform feature.
 * When the member belongs to only one shop the panel itself explains that a
 * second approved membership is required, instead of the action vanishing.
 */
export function recipientTabs(role: Role | null, _multiShop = false): RecipientTabOption[] {
  const tabs: RecipientTabOption[] = [];
  switch (role) {
    case "admin":
    case "super_admin":
      tabs.push({ key: "network", label: "Shop team" }, { key: "customer", label: "Customers" });
      break;
    case "reseller":
    case "subreseller":
      tabs.push(
        { key: "network", label: "Upline & downline" },
        { key: "customer", label: "Customers" },
      );
      break;
    default:
      // A customer may send to any active upline of the shop (admin, reseller,
      // subreseller) and to peer customers. Upline transfers reset lineage.
      tabs.push({ key: "network", label: "Upline" }, { key: "peer", label: "Peer customer" });
      break;

  }
  tabs.push({ key: "shops", label: "Another shop" });
  return tabs;
}

/** Slice the server-authorized recipient list for one tab. */
export function filterRecipientsByTab(
  recipients: ShopRecipient[],
  tab: RecipientTab,
): ShopRecipient[] {
  if (tab === "shops") return [];
  if (tab === "network") {
    return recipients.filter((r) => r.relation !== "customer");
  }
  return recipients.filter((r) => r.relation === "customer");
}

/** Why one tab's list is empty, worded for the person looking at it. */
export function tabEmptyHint(tab: RecipientTab, role: Role | null): string {
  switch (tab) {
    case "network":
      return role === "reseller"
        ? "No subresellers of yours are active in this shop yet."
        : role === "subreseller"
          ? "No upline transfers for this shop yet — your reseller and this shop's admins appear here once they are active members."
          : role === "admin" || role === "super_admin"
            ? "No other operators in this shop yet."
            : "No active upline in this shop yet — this shop's admin, resellers and subresellers appear here.";

    case "customer":
      return "No active customers in this shop yet.";
    case "peer":
      return "No other active customers in this shop yet — peers appear here once they are approved members.";
    default:
      return emptyRecipientsHint(role);
  }
}

/**
 * Deliberate business rule: credits a CUSTOMER sends to an upline (shop admin,
 * reseller or subreseller) arrive with no cashback lineage. The upline's later
 * transfers and sales start a fresh, normal lineage. Enforced in the database
 * by `transfer_credits_in_shop` / `track_credit_lots`; this is only the wording.
 */
export function lineageResetNotice(
  senderRole: Role | null,
  recipientRelation: string | null,
): string | null {
  const isCustomer = senderRole !== "admin" && senderRole !== "super_admin"
    && senderRole !== "reseller" && senderRole !== "subreseller";
  if (!isCustomer || !recipientRelation) return null;
  if (!["admin", "reseller", "subreseller"].includes(recipientRelation)) return null;
  return "Cashback lineage reset: these credits stop being traced to you once they arrive.";
}

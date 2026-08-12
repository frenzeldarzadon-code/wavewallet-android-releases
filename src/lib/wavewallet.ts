/**
 * WaveWallet domain model + demo dataset.
 *
 * Multi-tenant by construction: every record carries an `ecosystemId`.
 * Nothing here is tenant-specific — "Sagada Wave" is only seed data.
 * When Lovable Cloud is added, these types map 1:1 to Postgres tables with
 * RLS scoped to ecosystem_id (and user_roles for role checks).
 */

export type Role = "super_admin" | "admin" | "reseller" | "customer";

export type SubscriptionStatus =
  | "pending"
  | "awaiting_approval"
  | "active"
  | "rejected"
  | "expired"
  | "suspended";

export type VoucherCodeState = "unused" | "reserved" | "sold";

export type PaymentMethod = "credits" | "points";

export type RedemptionStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface Ecosystem {
  id: string;
  name: string;
  slug: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  facebookPageName: string;
  facebookPageUrl: string;
  facebookSupportMessage: string;
  pointsPerPeso: number; // qualifying spend (PHP) per 1 point, e.g. 10
  createdAt: string;
  subscription: Subscription;
}

export interface Subscription {
  id: string;
  ecosystemId: string;
  planName: string;
  priceMonthly: number; // configurable by Super Admin, never hard-coded in UI
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  gracePeriodDays: number;
  paymentReference?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface Account {
  id: string;
  ecosystemId: string | null; // null only for platform-level super admins
  role: Role;
  name: string;
  email: string;
  phone: string;
  resellerId?: string | null; // customers linked to a reseller
  discountPercent?: number; // resellers only
  creditBalance: number;
  pointsBalance: number;
  pointsHeld?: number;
  status: "active" | "suspended";
  joinedAt: string;
}

export interface VoucherProduct {
  id: string;
  ecosystemId: string;
  name: string;
  description: string;
  creditPrice: number;
  pointsPrice: number | null;
  promoPrice: number | null;
  promoLabel?: string;
  active: boolean;
  stockUnused: number;
  stockSold: number;
}

export interface VoucherCode {
  id: string;
  ecosystemId: string;
  productId: string;
  code: string;
  state: VoucherCodeState;
  importedAt: string;
  soldAt?: string;
  soldToAccountId?: string;
}

export interface RewardProduct {
  id: string;
  ecosystemId: string;
  name: string;
  description: string;
  pointsPrice: number;
  stock: number;
  active: boolean;
}

export interface Redemption {
  id: string;
  ecosystemId: string;
  code: string;
  rewardId: string;
  rewardName: string;
  accountId: string;
  accountName: string;
  pointsHeld: number;
  status: RedemptionStatus;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  location?: string;
}

export type LedgerKind =
  | "voucher_purchase"
  | "credit_load"
  | "credit_transfer_in"
  | "credit_transfer_out"
  | "points_earned"
  | "points_spent"
  | "points_hold"
  | "points_release"
  | "subscription_payment";

export interface LedgerEntry {
  id: string; // unique transaction id, immutable record
  ecosystemId: string;
  kind: LedgerKind;
  accountId: string;
  accountName: string;
  counterpartyName?: string;
  resellerId?: string | null;
  productName?: string;
  voucherCode?: string;
  method: PaymentMethod | "manual";
  amount: number; // credits (or points when method === "points")
  grossPrice?: number; // customer price captured at sale time
  resellerCost?: number; // reseller cost captured at sale time
  resellerEarning?: number; // captured at sale time
  createdAt: string;
  note?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  ecosystemId?: string;
}

/* ------------------------------------------------------------------ */
/* Demo dataset                                                        */
/* ------------------------------------------------------------------ */

const day = (n: number) => {
  const d = new Date(Date.UTC(2026, 7, 12) - n * 86400000);
  return d.toISOString();
};

export const platformSettings = {
  productName: "WaveWallet",
  defaultPlanName: "Operator Monthly",
  defaultPlanPrice: 150,
  defaultGraceDays: 5,
  currency: "PHP",
  gcashNumber: "0917 555 0142",
  gcashAccountName: "WaveWallet Platform",
  supportPageName: "WaveWallet Support",
  supportPageUrl: "https://facebook.com/wavewallet.support",
  supportMessage: "Message us on Facebook and include your operator ID.",
};

export const ecosystems: Ecosystem[] = [
  {
    id: "eco_sagada",
    name: "Sagada Wave",
    slug: "sagada-wave",
    description: "Community hotspot network serving Sagada town proper and nearby barangays.",
    contactName: "Frenzel Arzadon",
    contactPhone: "0917 123 4567",
    contactEmail: "support@sagadawave.example",
    facebookPageName: "Sagada Wave",
    facebookPageUrl: "https://facebook.com/sagadawave",
    facebookSupportMessage: "Send us your voucher transaction ID and we'll respond within an hour.",
    pointsPerPeso: 10,
    createdAt: day(240),
    subscription: {
      id: "sub_1",
      ecosystemId: "eco_sagada",
      planName: "Operator Monthly",
      priceMonthly: 150,
      status: "active",
      currentPeriodEnd: day(-18),
      gracePeriodDays: 5,
      paymentReference: "GC-8823-4410",
      submittedAt: day(12),
      reviewedAt: day(12),
      reviewedBy: "Platform Owner",
    },
  },
  {
    id: "eco_baguio",
    name: "Highland Link",
    slug: "highland-link",
    description: "Multi-site hotspot operator covering three dormitory buildings in Baguio.",
    contactName: "Mila Cortez",
    contactPhone: "0928 445 1120",
    contactEmail: "hello@highlandlink.example",
    facebookPageName: "Highland Link WiFi",
    facebookPageUrl: "https://facebook.com/highlandlink",
    facebookSupportMessage: "Chat us for load concerns from 8AM to 10PM daily.",
    pointsPerPeso: 10,
    createdAt: day(96),
    subscription: {
      id: "sub_2",
      ecosystemId: "eco_baguio",
      planName: "Operator Monthly",
      priceMonthly: 150,
      status: "awaiting_approval",
      currentPeriodEnd: day(2),
      gracePeriodDays: 5,
      paymentReference: "GC-9910-7781",
      submittedAt: day(1),
    },
  },
  {
    id: "eco_ilocos",
    name: "Coastal Net",
    slug: "coastal-net",
    description: "Beachfront resort guest WiFi vouchers along the Ilocos coast.",
    contactName: "Jomar Bautista",
    contactPhone: "0995 220 8890",
    contactEmail: "ops@coastalnet.example",
    facebookPageName: "Coastal Net",
    facebookPageUrl: "https://facebook.com/coastalnet",
    facebookSupportMessage: "We reply to messages daily between 9AM and 6PM.",
    pointsPerPeso: 20,
    createdAt: day(58),
    subscription: {
      id: "sub_3",
      ecosystemId: "eco_ilocos",
      planName: "Operator Monthly",
      priceMonthly: 150,
      status: "expired",
      currentPeriodEnd: day(9),
      gracePeriodDays: 5,
    },
  },
];

export const accounts: Account[] = [
  {
    id: "acc_super",
    ecosystemId: null,
    role: "super_admin",
    name: "Platform Owner",
    email: "owner@wavewallet.app",
    phone: "0917 555 0142",
    creditBalance: 0,
    pointsBalance: 0,
    status: "active",
    joinedAt: day(300),
  },
  {
    id: "acc_admin_sagada",
    ecosystemId: "eco_sagada",
    role: "admin",
    name: "Frenzel Arzadon",
    email: "admin@sagadawave.example",
    phone: "0917 123 4567",
    creditBalance: 24850,
    pointsBalance: 0,
    status: "active",
    joinedAt: day(240),
  },
  {
    id: "acc_admin_baguio",
    ecosystemId: "eco_baguio",
    role: "admin",
    name: "Mila Cortez",
    email: "admin@highlandlink.example",
    phone: "0928 445 1120",
    creditBalance: 8100,
    pointsBalance: 0,
    status: "active",
    joinedAt: day(96),
  },
  {
    id: "acc_res_1",
    ecosystemId: "eco_sagada",
    role: "reseller",
    name: "Dante Store",
    email: "dante@sagadawave.example",
    phone: "0918 771 2200",
    discountPercent: 15,
    creditBalance: 3420,
    pointsBalance: 0,
    status: "active",
    joinedAt: day(180),
  },
  {
    id: "acc_res_2",
    ecosystemId: "eco_sagada",
    role: "reseller",
    name: "Bangaan Sari-Sari",
    email: "bangaan@sagadawave.example",
    phone: "0919 442 6611",
    discountPercent: 12,
    creditBalance: 1180,
    pointsBalance: 0,
    status: "active",
    joinedAt: day(120),
  },
  {
    id: "acc_res_3",
    ecosystemId: "eco_baguio",
    role: "reseller",
    name: "Session Road Hub",
    email: "session@highlandlink.example",
    phone: "0927 118 3390",
    discountPercent: 10,
    creditBalance: 640,
    pointsBalance: 0,
    status: "active",
    joinedAt: day(70),
  },
  {
    id: "acc_cus_1",
    ecosystemId: "eco_sagada",
    role: "customer",
    name: "Ana Lopez",
    email: "ana@example.com",
    phone: "0921 334 7788",
    resellerId: "acc_res_1",
    creditBalance: 385,
    pointsBalance: 142,
    pointsHeld: 50,
    status: "active",
    joinedAt: day(88),
  },
  {
    id: "acc_cus_2",
    ecosystemId: "eco_sagada",
    role: "customer",
    name: "Rey Balingit",
    email: "rey@example.com",
    phone: "0922 887 1123",
    resellerId: "acc_res_1",
    creditBalance: 120,
    pointsBalance: 64,
    status: "active",
    joinedAt: day(61),
  },
  {
    id: "acc_cus_3",
    ecosystemId: "eco_sagada",
    role: "customer",
    name: "Ivy Domingo",
    email: "ivy@example.com",
    phone: "0933 220 4451",
    resellerId: "acc_res_2",
    creditBalance: 940,
    pointsBalance: 310,
    status: "active",
    joinedAt: day(44),
  },
  {
    id: "acc_cus_4",
    ecosystemId: "eco_sagada",
    role: "customer",
    name: "Karl Pagaduan",
    email: "karl@example.com",
    phone: "0945 661 0092",
    resellerId: null,
    creditBalance: 60,
    pointsBalance: 18,
    status: "active",
    joinedAt: day(21),
  },
  {
    id: "acc_cus_5",
    ecosystemId: "eco_baguio",
    role: "customer",
    name: "Trina Velasco",
    email: "trina@example.com",
    phone: "0977 552 3319",
    resellerId: "acc_res_3",
    creditBalance: 210,
    pointsBalance: 40,
    status: "active",
    joinedAt: day(30),
  },
];

export const voucherProducts: VoucherProduct[] = [
  {
    id: "vp_1",
    ecosystemId: "eco_sagada",
    name: "1 Hour Surf",
    description: "Single-device access valid for 60 minutes from first login.",
    creditPrice: 10,
    pointsPrice: 12,
    promoPrice: null,
    active: true,
    stockUnused: 214,
    stockSold: 1860,
  },
  {
    id: "vp_2",
    ecosystemId: "eco_sagada",
    name: "5 Hours Surf",
    description: "Five hours of consumable access, usable across multiple sessions.",
    creditPrice: 40,
    pointsPrice: 45,
    promoPrice: 35,
    promoLabel: "Fiesta week promo",
    active: true,
    stockUnused: 96,
    stockSold: 740,
  },
  {
    id: "vp_3",
    ecosystemId: "eco_sagada",
    name: "1 Day Unli",
    description: "Unlimited access for 24 hours on one device.",
    creditPrice: 70,
    pointsPrice: 80,
    promoPrice: null,
    active: true,
    stockUnused: 38,
    stockSold: 512,
  },
  {
    id: "vp_4",
    ecosystemId: "eco_sagada",
    name: "7 Days Unli",
    description: "Weekly unlimited pass, best value for long-stay guests.",
    creditPrice: 350,
    pointsPrice: null,
    promoPrice: null,
    active: true,
    stockUnused: 4,
    stockSold: 128,
  },
  {
    id: "vp_5",
    ecosystemId: "eco_sagada",
    name: "30 Minutes Quick",
    description: "Short session for quick messaging and browsing.",
    creditPrice: 5,
    pointsPrice: 6,
    promoPrice: null,
    active: false,
    stockUnused: 0,
    stockSold: 320,
  },
  {
    id: "vp_6",
    ecosystemId: "eco_baguio",
    name: "Dorm Daily",
    description: "24-hour dorm building access pass.",
    creditPrice: 50,
    pointsPrice: 60,
    promoPrice: null,
    active: true,
    stockUnused: 120,
    stockSold: 310,
  },
];

export const voucherCodes: VoucherCode[] = [
  { id: "vc_1", ecosystemId: "eco_sagada", productId: "vp_1", code: "SW1H-4K92-PLQ7", state: "unused", importedAt: day(6) },
  { id: "vc_2", ecosystemId: "eco_sagada", productId: "vp_1", code: "SW1H-8B31-XZC2", state: "unused", importedAt: day(6) },
  { id: "vc_3", ecosystemId: "eco_sagada", productId: "vp_1", code: "SW1H-2M77-QWE1", state: "sold", importedAt: day(9), soldAt: day(2), soldToAccountId: "acc_cus_1" },
  { id: "vc_4", ecosystemId: "eco_sagada", productId: "vp_2", code: "SW5H-9911-AAZ4", state: "sold", importedAt: day(9), soldAt: day(1), soldToAccountId: "acc_cus_3" },
  { id: "vc_5", ecosystemId: "eco_sagada", productId: "vp_2", code: "SW5H-3320-KKD8", state: "unused", importedAt: day(4) },
  { id: "vc_6", ecosystemId: "eco_sagada", productId: "vp_3", code: "SWDY-7781-MNB3", state: "reserved", importedAt: day(4) },
  { id: "vc_7", ecosystemId: "eco_sagada", productId: "vp_3", code: "SWDY-5540-JHG6", state: "unused", importedAt: day(3) },
  { id: "vc_8", ecosystemId: "eco_sagada", productId: "vp_4", code: "SW7D-1102-TRE9", state: "unused", importedAt: day(3) },
];

export const rewardProducts: RewardProduct[] = [
  {
    id: "rw_1",
    ecosystemId: "eco_sagada",
    name: "Sagada Wave Tumbler",
    description: "500ml stainless tumbler, claim at any partner reseller store.",
    pointsPrice: 300,
    stock: 12,
    active: true,
  },
  {
    id: "rw_2",
    ecosystemId: "eco_sagada",
    name: "Cotton Tote Bag",
    description: "Screen-printed canvas tote, one per account per month.",
    pointsPrice: 180,
    stock: 25,
    active: true,
  },
  {
    id: "rw_3",
    ecosystemId: "eco_sagada",
    name: "Powerbank 10,000mAh",
    description: "Dual-port powerbank. Claim requires valid ID at pickup.",
    pointsPrice: 900,
    stock: 3,
    active: true,
  },
  {
    id: "rw_4",
    ecosystemId: "eco_sagada",
    name: "Coffee Voucher",
    description: "One hot brew at partner cafés in the town proper.",
    pointsPrice: 50,
    stock: 0,
    active: true,
  },
  {
    id: "rw_5",
    ecosystemId: "eco_baguio",
    name: "Highland Link Mug",
    description: "Ceramic mug claimable at the front desk.",
    pointsPrice: 200,
    stock: 8,
    active: true,
  },
];

export const redemptions: Redemption[] = [
  {
    id: "rdm_1",
    ecosystemId: "eco_sagada",
    code: "RDM-4471-QK",
    rewardId: "rw_4",
    rewardName: "Coffee Voucher",
    accountId: "acc_cus_1",
    accountName: "Ana Lopez",
    pointsHeld: 50,
    status: "pending",
    createdAt: day(1),
  },
  {
    id: "rdm_2",
    ecosystemId: "eco_sagada",
    code: "RDM-8820-ZT",
    rewardId: "rw_2",
    rewardName: "Cotton Tote Bag",
    accountId: "acc_cus_3",
    accountName: "Ivy Domingo",
    pointsHeld: 180,
    status: "approved",
    createdAt: day(11),
    approvedBy: "Dante Store",
    approvedAt: day(10),
    location: "Dante Store — Poblacion",
  },
  {
    id: "rdm_3",
    ecosystemId: "eco_sagada",
    code: "RDM-1094-BR",
    rewardId: "rw_1",
    rewardName: "Sagada Wave Tumbler",
    accountId: "acc_cus_2",
    accountName: "Rey Balingit",
    pointsHeld: 300,
    status: "rejected",
    createdAt: day(20),
    approvedBy: "Frenzel Arzadon",
    approvedAt: day(19),
    location: "Admin office",
  },
];

export const ledger: LedgerEntry[] = [
  {
    id: "TXN-20260812-0001",
    ecosystemId: "eco_sagada",
    kind: "voucher_purchase",
    accountId: "acc_cus_1",
    accountName: "Ana Lopez",
    resellerId: "acc_res_1",
    productName: "1 Hour Surf",
    voucherCode: "SW1H-2M77-QWE1",
    method: "credits",
    amount: -10,
    grossPrice: 10,
    resellerCost: 8.5,
    resellerEarning: 1.5,
    createdAt: day(0),
  },
  {
    id: "TXN-20260812-0002",
    ecosystemId: "eco_sagada",
    kind: "points_earned",
    accountId: "acc_cus_1",
    accountName: "Ana Lopez",
    method: "points",
    amount: 1,
    createdAt: day(0),
    note: "PHP 10 qualifying spend",
  },
  {
    id: "TXN-20260811-0044",
    ecosystemId: "eco_sagada",
    kind: "voucher_purchase",
    accountId: "acc_cus_3",
    accountName: "Ivy Domingo",
    resellerId: "acc_res_2",
    productName: "5 Hours Surf",
    voucherCode: "SW5H-9911-AAZ4",
    method: "credits",
    amount: -35,
    grossPrice: 35,
    resellerCost: 30.8,
    resellerEarning: 4.2,
    createdAt: day(1),
    note: "Fiesta week promo price",
  },
  {
    id: "TXN-20260811-0031",
    ecosystemId: "eco_sagada",
    kind: "credit_load",
    accountId: "acc_cus_3",
    accountName: "Ivy Domingo",
    counterpartyName: "Bangaan Sari-Sari",
    resellerId: "acc_res_2",
    method: "manual",
    amount: 500,
    createdAt: day(1),
  },
  {
    id: "TXN-20260810-0018",
    ecosystemId: "eco_sagada",
    kind: "credit_transfer_out",
    accountId: "acc_cus_1",
    accountName: "Ana Lopez",
    counterpartyName: "Rey Balingit",
    method: "credits",
    amount: -50,
    createdAt: day(2),
    note: "Transfers do not earn points",
  },
  {
    id: "TXN-20260810-0019",
    ecosystemId: "eco_sagada",
    kind: "credit_transfer_in",
    accountId: "acc_cus_2",
    accountName: "Rey Balingit",
    counterpartyName: "Ana Lopez",
    method: "credits",
    amount: 50,
    createdAt: day(2),
  },
  {
    id: "TXN-20260809-0007",
    ecosystemId: "eco_sagada",
    kind: "voucher_purchase",
    accountId: "acc_cus_2",
    accountName: "Rey Balingit",
    resellerId: null,
    productName: "1 Day Unli",
    voucherCode: "SWDY-0021-LKJ4",
    method: "points",
    amount: -80,
    grossPrice: 0,
    createdAt: day(3),
  },
  {
    id: "TXN-20260808-0002",
    ecosystemId: "eco_sagada",
    kind: "credit_load",
    accountId: "acc_res_1",
    accountName: "Dante Store",
    counterpartyName: "Frenzel Arzadon",
    method: "manual",
    amount: 3000,
    createdAt: day(4),
  },
  {
    id: "TXN-20260807-0012",
    ecosystemId: "eco_sagada",
    kind: "voucher_purchase",
    accountId: "acc_cus_4",
    accountName: "Karl Pagaduan",
    resellerId: null,
    productName: "1 Day Unli",
    voucherCode: "SWDY-6612-OIU2",
    method: "credits",
    amount: -70,
    grossPrice: 70,
    createdAt: day(5),
  },
  {
    id: "TXN-20260806-0009",
    ecosystemId: "eco_baguio",
    kind: "voucher_purchase",
    accountId: "acc_cus_5",
    accountName: "Trina Velasco",
    resellerId: "acc_res_3",
    productName: "Dorm Daily",
    voucherCode: "HLDD-4410-PPQ1",
    method: "credits",
    amount: -50,
    grossPrice: 50,
    resellerCost: 45,
    resellerEarning: 5,
    createdAt: day(6),
  },
];

export const auditEvents: AuditEvent[] = [
  {
    id: "aud_1",
    at: day(0),
    actor: "Platform Owner",
    action: "Accessed ecosystem in Super Admin Mode",
    target: "Sagada Wave",
    ecosystemId: "eco_sagada",
  },
  {
    id: "aud_2",
    at: day(1),
    actor: "Platform Owner",
    action: "Updated platform plan price to PHP 150",
    target: "Platform settings",
  },
  {
    id: "aud_3",
    at: day(2),
    actor: "Platform Owner",
    action: "Approved subscription payment GC-8823-4410",
    target: "Sagada Wave",
    ecosystemId: "eco_sagada",
  },
  {
    id: "aud_4",
    at: day(5),
    actor: "Platform Owner",
    action: "Created admin account",
    target: "Mila Cortez — Highland Link",
    ecosystemId: "eco_baguio",
  },
];

/* ------------------------------------------------------------------ */
/* Selectors (tenant-scoped by design)                                 */
/* ------------------------------------------------------------------ */

export const getEcosystem = (id: string | null | undefined) =>
  ecosystems.find((e) => e.id === id) ?? ecosystems[0];

export const getAccount = (id: string) => accounts.find((a) => a.id === id);

export const accountsIn = (ecosystemId: string, role?: Role) =>
  accounts.filter((a) => a.ecosystemId === ecosystemId && (!role || a.role === role));

export const voucherProductsIn = (ecosystemId: string) =>
  voucherProducts.filter((p) => p.ecosystemId === ecosystemId);

export const voucherCodesIn = (ecosystemId: string) =>
  voucherCodes.filter((c) => c.ecosystemId === ecosystemId);

export const rewardsIn = (ecosystemId: string) =>
  rewardProducts.filter((r) => r.ecosystemId === ecosystemId);

export const redemptionsIn = (ecosystemId: string) =>
  redemptions.filter((r) => r.ecosystemId === ecosystemId);

export const ledgerIn = (ecosystemId: string) =>
  [...ledger]
    .filter((l) => l.ecosystemId === ecosystemId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

export const ledgerFor = (accountId: string) =>
  [...ledger]
    .filter((l) => l.accountId === accountId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

export const effectivePrice = (p: VoucherProduct) => p.promoPrice ?? p.creditPrice;

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const peso = (n: number) =>
  `₱${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

export const signedPeso = (n: number) => `${n < 0 ? "−" : "+"}${peso(n)}`;

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

export const shortDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const statusLabel: Record<SubscriptionStatus, string> = {
  pending: "Pending",
  awaiting_approval: "Awaiting approval",
  active: "Active",
  rejected: "Rejected",
  expired: "Expired",
  suspended: "Suspended",
};

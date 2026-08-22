/**
 * Payment-method registry for notification-based payment recognition.
 *
 * The paired phone forwards notifications; recognising WHICH payment provider a
 * notification belongs to happens here, in the payment processing layer, not on
 * the phone. Adding a provider later means adding one entry to `PROVIDERS` (and
 * a matching row in `public.payment_provider_registry`) — nothing else changes.
 *
 * A provider never decides anything financial. It only reads text.
 */
import { parseGcashNotification } from "@/lib/gcash-notification";

export type ParsedPaymentNotification = {
  /** The text is an incoming payment for this provider. */
  incoming: boolean;
  amountPhp: number | null;
  senderNumber: string | null;
  senderName: string | null;
  reference: string | null;
};

export type PaymentProvider = {
  id: string;
  name: string;
  /** Android package names known to belong to this provider. */
  packages: string[];
  /** Wording that identifies the provider when the package is unfamiliar. */
  textMarkers: RegExp[];
  parse: (text: string) => ParsedPaymentNotification;
};

export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  {
    id: "gcash",
    name: "GCash",
    packages: ["com.globe.gcash.android"],
    textMarkers: [/gcash/i, /express\s+send/i],
    parse: (text) => parseGcashNotification(text),
  },
];

export const providerById = (id: string | null | undefined): PaymentProvider | null =>
  PAYMENT_PROVIDERS.find((p) => p.id === id) ?? null;

export const providerName = (id: string | null | undefined): string =>
  providerById(id)?.name ?? (id ? id : "Unknown app");

/**
 * Resolves the provider for one notification. The package name wins; the text
 * is only consulted when the package is not recognised, so a provider that
 * ships a new app id still works.
 */
export function resolvePaymentProvider(
  packageName: string | null | undefined,
  text?: string | null,
): PaymentProvider | null {
  const pkg = (packageName ?? "").trim().toLowerCase();
  const byPackage = PAYMENT_PROVIDERS.find((p) =>
    p.packages.some((candidate) => candidate.toLowerCase() === pkg),
  );
  if (byPackage) return byPackage;
  const body = (text ?? "").trim();
  if (!body) return null;
  return PAYMENT_PROVIDERS.find((p) => p.textMarkers.some((m) => m.test(body))) ?? null;
}

/** Reads a notification with the resolved provider. Unknown provider → null. */
export function parsePaymentNotification(
  packageName: string | null | undefined,
  text: string | null | undefined,
): { provider: PaymentProvider; parsed: ParsedPaymentNotification } | null {
  const provider = resolvePaymentProvider(packageName, text);
  if (!provider) return null;
  return { provider, parsed: provider.parse(text ?? "") };
}

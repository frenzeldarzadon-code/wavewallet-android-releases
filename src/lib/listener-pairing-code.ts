/**
 * Combined one-paste pairing value for the WaveWallet GCash listener.
 *
 * Format: `WWL1:<deviceId>:<pairingSecret>`
 *
 * It carries no new authority: it is only the Device ID and the existing
 * one-time pairing secret packed into a single clipboard value so the operator
 * never has to copy two values from two places. The Android app parses it and
 * discards the secret from memory immediately after pairing.
 */
export const PAIRING_CODE_PREFIX = "WWL1";

export function formatPairingCode(deviceId: string, secret: string) {
  return `${PAIRING_CODE_PREFIX}:${deviceId.trim()}:${secret.trim()}`;
}

export function parsePairingCode(value: string): { deviceId: string; secret: string } | null {
  const parts = value.trim().split(":");
  if (parts.length !== 3) return null;
  const prefix = (parts[0] ?? "").trim();
  const deviceId = (parts[1] ?? "").trim();
  const secret = (parts[2] ?? "").trim();
  if (prefix.toUpperCase() !== PAIRING_CODE_PREFIX) return null;
  if (!deviceId || !secret) return null;
  return { deviceId, secret };
}

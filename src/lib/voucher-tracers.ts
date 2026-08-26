/**
 * WaveWallet's own layer on top of Omada: a free-form "Tracer" label per
 * device (MAC) so a shop can tell who was using a voucher.
 *
 * A Tracer is a tracking label, never a verified identity, so anyone who can
 * search a voucher code may set one — no account is required. Labels are
 * append-only: a different label for a device that already has one is stored as
 * a conflicting entry and raised to the shop's admin, and the previous
 * association is always kept for later dispute investigation.
 */
import { supabase } from "@/integrations/supabase/client";

export interface TracerRecord {
  id: string;
  voucher_code: string;
  device_mac: string;
  tracer: string;
  is_primary: boolean;
  in_conflict: boolean;
  recorded_at: string;
}

export interface TracerConflict {
  id: string;
  voucher_code: string;
  device_mac: string;
  tracer: string;
  is_primary: boolean;
  recorded_at: string;
}

export type TracerOutcome = "recorded" | "unchanged" | "conflict";

export async function fetchVoucherTracers(
  ecosystemId: string,
  voucherCode: string,
): Promise<TracerRecord[]> {
  const { data, error } = await supabase.rpc("voucher_tracer_history", {
    _ecosystem_id: ecosystemId,
    _voucher_code: voucherCode,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TracerRecord[];
}

export async function saveVoucherTracer(input: {
  ecosystemId: string;
  voucherCode: string;
  deviceMac: string;
  tracer: string;
}): Promise<{ outcome: TracerOutcome; existing?: string }> {
  const { data, error } = await supabase.rpc("set_voucher_tracer", {
    _ecosystem_id: input.ecosystemId,
    _voucher_code: input.voucherCode,
    _device_mac: input.deviceMac,
    _tracer: input.tracer,
  });
  if (error) throw new Error(error.message);
  return data as { outcome: TracerOutcome; existing?: string };
}

export async function fetchTracerConflicts(ecosystemId: string): Promise<TracerConflict[]> {
  const { data, error } = await supabase.rpc("voucher_tracer_conflicts", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TracerConflict[];
}

export async function resolveTracerConflict(id: string): Promise<void> {
  const { error } = await supabase.rpc("resolve_voucher_tracer", { _id: id });
  if (error) throw new Error(error.message);
}

/** The label currently in force for a device, if any. */
export function primaryTracer(records: TracerRecord[], mac: string | null): TracerRecord | null {
  if (!mac) return null;
  const forDevice = records.filter((r) => r.device_mac === mac.toUpperCase());
  return forDevice.find((r) => r.is_primary) ?? forDevice[0] ?? null;
}

/** Earlier labels for a device, newest first, excluding the current one. */
export function tracerHistory(records: TracerRecord[], mac: string | null): TracerRecord[] {
  if (!mac) return [];
  const current = primaryTracer(records, mac);
  return records.filter((r) => r.device_mac === mac.toUpperCase() && r.id !== current?.id);
}

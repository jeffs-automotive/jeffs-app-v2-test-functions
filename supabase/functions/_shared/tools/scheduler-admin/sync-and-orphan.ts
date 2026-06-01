// sync-and-orphan — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ─── On-demand appointments sync ────────────────────────────────────────────

/**
 * Trigger an on-demand call to the appointments-sync Edge Function. Same
 * function the cron calls every 5 min — useful when an advisor knows
 * Tekmetric just changed and wants the local shadow refreshed without
 * waiting. Returns the function's structured summary.
 */
export async function runAppointmentsSync(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** Optional: force a full backfill rather than the rolling window. */
  full_backfill?: boolean;
}): Promise<{ ok: boolean; status: number; summary: unknown }> {
  const url = `${args.supabaseUrl.replace(/\/+$/, "")}/functions/v1/appointments-sync`;
  const body = args.full_backfill ? { full_backfill: true } : {};
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${args.serviceRoleKey}`,
      "apikey": args.serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let summary: unknown = null;
  try {
    summary = await res.json();
  } catch {
    summary = await res.text();
  }
  return { ok: res.ok, status: res.status, summary };
}

// ─── Orphan-customer detection ──────────────────────────────────────────────

/**
 * Find customers in our local appointment_holds + appointments shadow whose
 * Tekmetric customer_id is NULL or appears stale (Tekmetric returned 404
 * during the last sync). Used by advisors to clean up after Tekmetric
 * deletions — same shape as the keytag orphan-release flow.
 *
 * Phase 1 implementation: returns local appointments where deleted_at IS
 * NULL but the Tekmetric appointment_id no longer matches any appointment
 * fetched in the most recent sync run. Heuristic — the appointments-sync
 * function already marks deleted_at when it detects deletions, so this
 * surface is small. Mostly used to find drift.
 */
export async function findOrphanCustomers(
  sb: SupabaseClient,
  shopId: number,
  args: { lookback_days?: number } = {},
): Promise<{
  orphans: Array<{
    customer_id: number | null;
    appointment_id: number;
    start_time: string;
    appointment_status: string;
    last_synced_at: string | null;
  }>;
  count: number;
  lookback_days: number;
}> {
  const lookback = args.lookback_days ?? 30;
  const cutoff = new Date(
    Date.now() - lookback * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Heuristic Phase 1: find appointments where the tekmetric_synced_at is older
  // than 24h but the appointment hasn't been deleted (sync should have
  // touched it OR marked it deleted). May produce false positives during a
  // sync-paused window — advisors verify in Tekmetric before acting.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("appointments")
    .select(
      "customer_id, tekmetric_appointment_id, start_time, appointment_status, tekmetric_synced_at",
    )
    .eq("shop_id", shopId)
    .is("deleted_at", null)
    .gte("start_time", cutoff)
    .lt("tekmetric_synced_at", staleCutoff)
    .limit(50);
  if (error) {
    throw new Error(`findOrphanCustomers failed: ${error.message}`);
  }
  const orphans = (data ?? []).map((r) => ({
    customer_id: r.customer_id as number | null,
    appointment_id: r.tekmetric_appointment_id as number,
    start_time: r.start_time as string,
    appointment_status: r.appointment_status as string,
    // Result field stays `last_synced_at` (public contract consumed by admin-app
    // OperationsTab); value reads the real DB column `tekmetric_synced_at`.
    last_synced_at: (r.tekmetric_synced_at ?? null) as string | null,
  }));
  return { orphans, count: orphans.length, lookback_days: lookback };
}

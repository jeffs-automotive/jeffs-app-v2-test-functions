/**
 * buildServiceSummary — assemble the short summary string used by both
 * the hold and the confirm-booking edge function calls.
 *
 * Phase 11 (2026-05-15): extracted from session-actions.ts so the V2
 * wizard's submitDateV2 / submitWaiterTimeV2 / submitSummaryConfirmV2
 * (Phase 12) can reuse the exact same shape the legacy /book chat sent
 * to scheduler-booking-direct. Keeps the appointment.description string
 * format consistent across the two surfaces during the migration window
 * (Phase 16 deletes session-actions.ts; this helper survives).
 *
 * Output shape: ` · `-delimited segments like
 *   "Routine: Oil Change, Tire Rotation · Concern: brakes squeal when
 *    cold · Testing approved: brake_inspection"
 *
 * Empty pick set yields "General appointment" so the edge function's
 * service_summary NOT-NULL check still passes.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function buildServiceSummary(args: {
  chatId: string;
}): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data: rowRaw } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", args.chatId)
    .maybeSingle();
  const row = rowRaw as Record<string, unknown> | null;
  const services = Array.isArray(row?.selected_simple_services)
    ? (row?.selected_simple_services as string[])
    : [];
  const explanations = Array.isArray(row?.explanation_required_items)
    ? (row?.explanation_required_items as Array<{
        service_key?: string;
        explanation_text?: string;
      }>)
    : [];
  const approvedTesting = Array.isArray(row?.approved_testing_services)
    ? (row?.approved_testing_services as string[])
    : [];
  const additional = Array.isArray(row?.additional_routine_services_round2)
    ? (row?.additional_routine_services_round2 as string[])
    : [];

  // Merge first-pass + second-pass routines so the appointment description
  // reflects everything the customer agreed to. Legacy session-actions
  // omitted the second-pass list; the V2 wizard's submit-second-routine-
  // pass action writes there so we'd lose visibility on /book-v2 add-ons
  // if we matched legacy verbatim.
  const parts: string[] = [];
  const allRoutine = [...services, ...additional];
  if (allRoutine.length > 0) {
    parts.push(`Routine: ${allRoutine.join(", ")}`);
  }
  for (const ex of explanations) {
    if (ex?.explanation_text) {
      parts.push(`Concern: ${ex.explanation_text}`);
    }
  }
  if (approvedTesting.length > 0) {
    parts.push(`Testing approved: ${approvedTesting.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "General appointment";
}

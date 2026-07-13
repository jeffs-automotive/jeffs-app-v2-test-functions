/**
 * Payroll DAL — Pattern S confirm-token helpers + the alert email sender.
 * Internal support module for src/lib/dal/payroll.ts (the public entrypoint),
 * split out per the ~500-line file policy. Import from "@/lib/dal/payroll".
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendQteklinkEmail } from "@/lib/dal/notify";
import {
  getPayrollSettings,
  throwRpc,
  type PayrollActor,
  type PayrollAlertEmails,
} from "@/lib/dal/payroll-shared";

interface TokenRow {
  token_id: string;
  expires_at: string;
}

/** Issue a 5-minute single-use Pattern S token bound to (run, action, state hash). */
export async function issueConfirmToken(
  runId: string,
  actionKind: "complete_run" | "void_run",
  scopeHash: string,
  actor: PayrollActor,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_issue_confirm_token", {
    p_run_id: runId,
    p_action_kind: actionKind,
    p_scope_hash: scopeHash,
    p_actor_user_id: actor.userId,
    p_actor_label: actor.label,
  });
  if (error) throwRpc("qteklink_payroll_issue_confirm_token", error);
  const row = (Array.isArray(data) ? data[0] : data) as TokenRow | undefined;
  if (!row || typeof row.token_id !== "string") {
    throw new Error("qteklink_payroll_issue_confirm_token returned no token");
  }
  return row.token_id;
}

/** Pull the state_hash out of a complete_run/void_run dry-run result. */
export function stateHashFrom(data: unknown, fn: string): string {
  const hash = (data as { state_hash?: unknown } | null)?.state_hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error(`${fn} dry run returned no state_hash`);
  }
  return hash;
}

/** Payroll alert email via the notify idiom. NEVER throws into the caller: by the
 *  time this runs the complete/void already committed — a failed settings read or
 *  send must not make the action look failed. Captured to Sentry instead. */
export async function sendPayrollAlert(
  shopId: number,
  list: keyof PayrollAlertEmails,
  subject: string,
  lines: string[],
  html?: string,
): Promise<void> {
  try {
    const { payroll } = await getPayrollSettings(shopId);
    // `html` is additive (the completed alert carries the run-summary HTML); the
    // text stays required (the edge fn's contract) as the fallback.
    await sendQteklinkEmail({ to: payroll.alert_emails[list], subject, text: lines.join("\n"), html });
  } catch (e) {
    Sentry.captureException(e, { tags: { surface: "qteklink-payroll-alert", alert_list: list } });
  }
}

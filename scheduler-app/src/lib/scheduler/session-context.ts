/**
 * Build a compact "session snapshot" string from a customer_chat_sessions row.
 *
 * Per chat-design.md locked architecture decision #1 + the Stage 3 refactor
 * 2026-05-13: the chat agent's LLM reads the AUTHORITATIVE state of the
 * wizard from this snapshot (not from parsing prior message text). The
 * snapshot is injected as a suffix to the system prompt on every turn.
 *
 * Compactness matters — every token in the snapshot is paid per turn. We
 * include only fields the agent actually needs to make its next-card
 * decision:
 *   - current_step (always)
 *   - identity_verification_level (gates which paths are open)
 *   - last directive received (if any) — drives the most recent transition
 *   - thin counts (otp_attempts, summary_edit_attempts) for cap-aware behavior
 *
 * We DELIBERATELY do NOT include PII (phone, name) in the snapshot. The
 * orchestrator reads those columns directly when it calls Telnyx/Tekmetric.
 * The chat agent never needs to see them; doing so would risk hallucination
 * AND PII leakage in logs.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface SessionSnapshotRow {
  current_step: string | null;
  identity_verification_level: string | null;
  is_returning_customer: boolean | null;
  otp_attempts: number | null;
  customer_notes_edit_attempts: number | null;
  summary_edit_attempts: number | null;
  appointment_type: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  diagnostic_processing_complete: boolean | null;
}

const SELECT_FIELDS =
  "current_step, identity_verification_level, is_returning_customer, " +
  "otp_attempts, customer_notes_edit_attempts, summary_edit_attempts, " +
  "appointment_type, appointment_date, appointment_time, " +
  "diagnostic_processing_complete";

/**
 * Build the snapshot string. Returns empty string when the row doesn't
 * exist (caller falls back to no-snapshot behavior — the agent gets only
 * the base system prompt).
 */
export async function buildSessionSnapshot(chatId: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customer_chat_sessions")
    .select(SELECT_FIELDS)
    .eq("id", chatId)
    .maybeSingle();
  if (error || !data) return "";
  const row = data as unknown as SessionSnapshotRow;

  const lines: string[] = [
    "## Session snapshot (authoritative)",
    "",
    "The customer's data lives in the customer_chat_sessions row, NOT in",
    "the message history. Use the values below as the source of truth.",
    "Do NOT try to extract customer data (phone, name, vehicle, etc.) from",
    "prior message text — the orchestrator reads it from the row directly.",
    "",
    `- current_step: \`${row.current_step ?? "greeting"}\``,
  ];

  if (row.is_returning_customer !== null) {
    lines.push(
      `- self_id_bucket: \`${
        row.is_returning_customer === true
          ? "returning"
          : row.is_returning_customer === false
            ? "new"
            : "unsure"
      }\``,
    );
  }
  if (row.identity_verification_level) {
    lines.push(`- identity_verification_level: \`${row.identity_verification_level}\``);
  }
  if (typeof row.otp_attempts === "number" && row.otp_attempts > 0) {
    lines.push(`- otp_attempts: ${row.otp_attempts}`);
  }
  if (typeof row.summary_edit_attempts === "number" && row.summary_edit_attempts > 0) {
    lines.push(`- summary_edit_attempts: ${row.summary_edit_attempts}`);
  }
  if (typeof row.customer_notes_edit_attempts === "number" && row.customer_notes_edit_attempts > 0) {
    lines.push(`- customer_notes_edit_attempts: ${row.customer_notes_edit_attempts}`);
  }
  if (row.appointment_type) {
    lines.push(`- appointment_type: \`${row.appointment_type}\``);
  }
  if (row.appointment_date) {
    lines.push(`- appointment_date: \`${row.appointment_date}\``);
  }
  if (row.appointment_time) {
    lines.push(`- appointment_time: \`${row.appointment_time}\``);
  }
  if (row.diagnostic_processing_complete === true) {
    lines.push(`- diagnostic_processing_complete: true`);
  }

  lines.push("");
  lines.push(
    "### Behavioral contract (row-as-truth Phase 1)",
    "",
    "When you receive a tool result with shape `{ok, directive, data, bubble_copy?}`,",
    "that result was produced by a Server Action that ALREADY wrote the customer's",
    "data to the row. Your job is to:",
    "  1. If `bubble_copy` is non-empty, emit it as your chat bubble text (verbatim).",
    "  2. Then emit the directed rendering tool (the directive maps 1:1 to a tool name).",
    "  3. Do NOT call consult_orchestrator — the Server Action already did the",
    "     orchestrator work and the directive IS the orchestrator's answer.",
    "  4. Do NOT acknowledge customer-typed data — there is none. Cards collect data;",
    "     Server Actions persist it. You only route directives.",
    "",
    "When the directive is `continue` or unknown, emit no card and a short transition",
    "line (\"Got it — let me think for a sec…\"). The next user action will surface the",
    "real next step.",
  );

  return lines.join("\n");
}

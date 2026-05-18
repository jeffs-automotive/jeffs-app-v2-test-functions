// Build the transcript-email HTML inline (no React Email runtime required).
//
// Per appointments_design.md §11 + §3.3.
// Subject format: 'Transcript: <customer-name> — <outcome>' with a [NEG]
// prefix on negative-sentiment conversations.
//
// The template is intentionally simple (header block + sentiment callout +
// pricing-discussed section + per-turn message list). Brand colors from
// scheduler-app/src/styles/globals.css:
//   --brand-primary: #96003C  (burgundy)
//   --brand-accent:  #D2B487  (gold)

interface TranscriptMessageView {
  role: "user" | "assistant" | "system" | "tool";
  /** Plain-text rendering of the message (we collapse parts[] into text). */
  text: string;
  /** UI-message id for linking back to the row in supabase if useful. */
  id?: string;
  created_at?: string;
  /** Optional tool-call name(s) included in this message. */
  tools?: string[];
}

export interface TranscriptViewModel {
  session_id: string;
  channel: "web" | "sms";
  customer_name: string;
  customer_phone_e164?: string | null;
  outcome:
    | "scheduled"
    | "info_only"
    | "escalation"
    | "incomplete"
    | "unknown";
  /** @deprecated Sentiment classification deferred to Phase 2 per design lock
   *  2026-05-13. Field retained for schema compatibility; new dispatcher runs
   *  always pass null. */
  sentiment?: "positive" | "neutral" | "negative" | null;
  appointment_id?: number | null;
  appointment_starts_at?: string | null;
  /** Waiter vs. drop-off — drives the summary header label. Added 2026-05-18
   *  redesign. */
  appointment_type?: "waiter" | "dropoff" | null;
  /** Tekmetric admin URL for the appointment (shop.tekmetric.com/admin/...).
   *  Added 2026-05-18 — surfaced in the summary header per Chris's directive
   *  "should also have the link to the appointment." */
  appointment_link?: string | null;
  /** Title written to Tekmetric (e.g., "[TM] Christopher Goodson, 2019 Kia
   *  Optima SI IM BRAKE INSPECT"). Renders in the summary header. */
  appointment_title?: string | null;
  /** Tekmetric description (e.g., "Routine: state_inspection_emissions ·
   *  Concern: brakes are grinding · Testing approved: brake_inspection"). */
  appointment_description?: string | null;
  /** Structured per-event list summarizing what the customer chose during
   *  the wizard. Replaces the raw chat-bubble replay as the primary read.
   *  Added 2026-05-18 per Chris's directive: "If they verify their personal
   *  information it should just say customer verified their info, or
   *  customer added a vehicle." Empty array → activity block is omitted. */
  activity?: Array<{
    kind:
      | "identity_verified"
      | "identity_provided"
      | "vehicle_added"
      | "vehicle_selected"
      | "routine_services_picked"
      | "concern_described"
      | "clarification_answered"
      | "testing_approved"
      | "testing_declined"
      | "routine_round2_added"
      | "appointment_chosen";
    label: string;
    /** Optional detail line(s). May contain newlines (rendered as
     *  white-space:pre-wrap). */
    detail?: string | null;
  }>;
  pricing_discussed?: Array<{
    display_name: string;
    starting_price_cents: number;
    notes?: string | null;
  }>;
  /** Errors logged during the session (tool_failed, tekmetric_error,
   *  escalation_triggered). Added Chunk 8 (2026-05-13) per Chris's directive:
   *  "log any errors and send it with the appointment email to service advisors."
   *  Sourced from scheduler_audit_log. Empty array → no errors section
   *  rendered. */
  errors?: Array<{
    occurred_at: string;
    step: string;
    event_type: string;
    error_message: string | null;
    /** Brief context — keep PII-free per scheduler_audit_log convention. */
    event_detail?: Record<string, unknown> | null;
  }>;
  /** Customer's optional free-form notes captured at Step 10.2 of the wizard.
   *  Rendered above the conversation log. Added Chunk 8. */
  customer_notes_text?: string | null;
  /** Customer's optional free-form question captured at Step 10.3.
   *  Rendered above the conversation log. Added Chunk 8. */
  customer_question?: string | null;
  messages: TranscriptMessageView[];
  started_at: string;
  ended_at: string;
}

const BRAND_PRIMARY = "#96003C";
const BRAND_ACCENT = "#D2B487";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtFriendlyDay(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtCents(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function roleLabel(role: TranscriptMessageView["role"]): string {
  switch (role) {
    case "user":
      return "Customer";
    case "assistant":
      return "Jeff (assistant)";
    case "tool":
      return "Tool";
    case "system":
      return "System";
  }
}

export function buildTranscriptSubject(view: TranscriptViewModel): string {
  // [ESCALATED] prefix when the session was escalated (footer button OR
  // keyword scanner OR retry-limit trigger) — surfaces urgency to the
  // service team's inbox per chat-design.md §A "Escalation flow".
  // [ERR] prefix when the session captured any errors — replaces the legacy
  // [NEG] sentiment prefix (sentiment classification deferred to Phase 2 per
  // design lock 2026-05-13).
  // Both can appear: "[ESCALATED] [ERR] Transcript: ..."
  const escalatedPrefix = view.outcome === "escalation" ? "[ESCALATED] " : "";
  const errPrefix = view.errors && view.errors.length > 0 ? "[ERR] " : "";
  const outcome =
    view.outcome === "scheduled"
      ? "scheduled"
      : view.outcome === "escalation"
        ? "escalated"
        : view.outcome === "info_only"
          ? "info only"
          : view.outcome === "incomplete"
            ? "incomplete"
            : view.outcome;
  return `${escalatedPrefix}${errPrefix}Transcript: ${view.customer_name} — ${outcome}`;
}

export function buildTranscriptHtml(view: TranscriptViewModel): string {
  // Sentiment classification deferred to Phase 2 per design lock 2026-05-13.
  // Legacy code path retained for backwards-compat if a caller still passes
  // sentiment, but the new dispatcher always passes null and this block
  // collapses to empty string.
  const sentimentBlock =
    view.sentiment === "negative"
      ? `<div style="margin:0 0 16px 0;padding:12px 16px;background:#fff3f3;border-left:4px solid #c62828;font-size:14px;color:#7a1f1f;border-radius:2px;">⚠ Sentiment flagged <strong>negative</strong> — please review.</div>`
      : view.sentiment === "positive"
        ? `<div style="margin:0 0 16px 0;padding:12px 16px;background:#f4f9f3;border-left:4px solid #2e7d32;font-size:14px;color:#1b3d1c;border-radius:2px;">Sentiment: positive.</div>`
        : "";

  // Errors section — added Chunk 8 (2026-05-13) per Chris's directive
  // "log any errors and send it with the appointment email to service advisors."
  const errorsBlock =
    view.errors && view.errors.length > 0
      ? `<div style="margin:0 0 16px 0;padding:12px 16px;background:#fff7e6;border-left:4px solid #b78400;border-radius:2px;">
           <p style="margin:0 0 8px 0;font-size:13px;font-weight:600;color:#7a5400;">⚠ ${view.errors.length} error event${view.errors.length === 1 ? "" : "s"} during this session</p>
           <table style="width:100%;border-collapse:collapse;font-size:13px;color:#5a4000;">
             <thead>
               <tr>
                 <th style="text-align:left;padding:4px 8px 4px 0;font-weight:600;">Time</th>
                 <th style="text-align:left;padding:4px 8px;font-weight:600;">Step</th>
                 <th style="text-align:left;padding:4px 8px;font-weight:600;">Event</th>
                 <th style="text-align:left;padding:4px 0 4px 8px;font-weight:600;">Detail</th>
               </tr>
             </thead>
             <tbody>
               ${view.errors
                 .map(
                   (e) => `<tr>
                     <td style="padding:4px 8px 4px 0;vertical-align:top;color:#7a5400;font-size:12px;">${fmtDateTime(e.occurred_at)}</td>
                     <td style="padding:4px 8px;vertical-align:top;">${escapeHtml(e.step)}</td>
                     <td style="padding:4px 8px;vertical-align:top;">${escapeHtml(e.event_type)}</td>
                     <td style="padding:4px 0 4px 8px;vertical-align:top;font-family:Menlo,Monaco,monospace;font-size:12px;">${escapeHtml(e.error_message ?? "")}${e.event_detail && Object.keys(e.event_detail).length > 0 ? `<br/><span style="color:#888;font-size:11px;">${escapeHtml(JSON.stringify(e.event_detail))}</span>` : ""}</td>
                   </tr>`,
                 )
                 .join("")}
             </tbody>
           </table>
         </div>`
      : "";

  // Customer notes + question — Steps 10.2 + 10.3 captures. Added Chunk 8.
  const customerCapturesBlock =
    view.customer_notes_text || view.customer_question
      ? `<div style="margin:0 0 16px 0;padding:12px 16px;background:#f5f1e8;border-left:4px solid ${BRAND_ACCENT};border-radius:2px;">
           ${view.customer_notes_text ? `<p style="margin:0 0 8px 0;font-size:13px;"><strong style="color:${BRAND_PRIMARY};">Customer notes for the team:</strong></p><p style="margin:0 0 12px 0;font-size:14px;white-space:pre-wrap;">${escapeHtml(view.customer_notes_text)}</p>` : ""}
           ${view.customer_question ? `<p style="margin:0 0 8px 0;font-size:13px;"><strong style="color:${BRAND_PRIMARY};">Customer question — please follow up:</strong></p><p style="margin:0;font-size:14px;white-space:pre-wrap;">${escapeHtml(view.customer_question)}</p>` : ""}
         </div>`
      : "";

  const pricingBlock =
    view.pricing_discussed && view.pricing_discussed.length > 0
      ? `<h3 style="margin:24px 0 8px 0;color:${BRAND_PRIMARY};font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Pricing discussed</h3>
         <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px;">
           <thead>
             <tr>
               <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};">Service</th>
               <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};">Starting price</th>
               <th style="text-align:left;padding:8px;border-bottom:1px solid ${BRAND_ACCENT};">Notes</th>
             </tr>
           </thead>
           <tbody>
             ${view.pricing_discussed
               .map(
                 (p) => `<tr>
                   <td style="padding:8px;border-bottom:1px solid #f0e6d6;">${escapeHtml(p.display_name)}</td>
                   <td style="padding:8px;border-bottom:1px solid #f0e6d6;">${fmtCents(p.starting_price_cents)}</td>
                   <td style="padding:8px;border-bottom:1px solid #f0e6d6;">${escapeHtml(p.notes ?? "")}</td>
                 </tr>`,
               )
               .join("")}
           </tbody>
         </table>`
      : "";

  const messagesHtml = view.messages
    .map((m) => {
      const ts = m.created_at ? fmtDateTime(m.created_at) : "";
      const tools =
        m.tools && m.tools.length > 0
          ? `<div style="font-size:11px;color:#888;margin-top:4px;">tools: ${m.tools
              .map(escapeHtml)
              .join(", ")}</div>`
          : "";
      const bg =
        m.role === "user"
          ? "#f8f8f8"
          : m.role === "assistant"
            ? "#fff"
            : "#fafafa";
      const border =
        m.role === "user" ? "#ddd" : m.role === "assistant" ? BRAND_ACCENT : "#eee";
      return `<div style="margin:0 0 8px 0;padding:10px 12px;background:${bg};border-left:3px solid ${border};border-radius:2px;font-size:14px;line-height:1.5;">
        <div style="font-weight:600;font-size:12px;color:${BRAND_PRIMARY};margin-bottom:4px;">${roleLabel(m.role)} ${ts ? `<span style="color:#999;font-weight:400;">· ${ts}</span>` : ""}</div>
        <div style="white-space:pre-wrap;">${escapeHtml(m.text)}</div>
        ${tools}
      </div>`;
    })
    .join("");

  // ─── Summary header (2026-05-18 redesign) ─────────────────────────────
  // Top-of-email "at a glance" block. Per Chris: services + when + wait-
  // or-drop-off + appointment link.
  const apptTypeLabel =
    view.appointment_type === "waiter"
      ? "Wait"
      : view.appointment_type === "dropoff"
        ? "Drop-off"
        : null;
  const apptWhen = view.appointment_starts_at
    ? fmtFriendlyDay(view.appointment_starts_at)
    : null;
  const apptLinkHtml = view.appointment_link
    ? `<p style="margin:8px 0 0 0;font-size:14px;"><a href="${escapeHtml(view.appointment_link)}" style="color:${BRAND_PRIMARY};text-decoration:underline;">Open in Tekmetric →</a></p>`
    : "";
  const summaryBlock =
    view.appointment_id || apptWhen || view.appointment_description
      ? `<div style="margin:0 0 20px 0;padding:16px 18px;background:#fbf8f1;border:1px solid ${BRAND_ACCENT};border-radius:4px;">
           <p style="margin:0 0 4px 0;font-size:11px;color:${BRAND_PRIMARY};font-weight:600;text-transform:uppercase;letter-spacing:0.6px;">Appointment summary</p>
           ${apptWhen ? `<p style="margin:4px 0 0 0;font-size:15px;font-weight:600;color:#222;">${escapeHtml(apptWhen)}${apptTypeLabel ? ` · ${apptTypeLabel}` : ""}</p>` : ""}
           ${view.appointment_id ? `<p style="margin:4px 0 0 0;font-size:13px;color:#666;">Tekmetric appointment <strong>#${view.appointment_id}</strong></p>` : ""}
           ${view.appointment_description ? `<p style="margin:8px 0 0 0;font-size:14px;color:#333;white-space:pre-wrap;">${escapeHtml(view.appointment_description)}</p>` : ""}
           ${view.appointment_title ? `<p style="margin:6px 0 0 0;font-size:12px;color:#888;font-family:Menlo,Monaco,monospace;">${escapeHtml(view.appointment_title)}</p>` : ""}
           ${apptLinkHtml}
         </div>`
      : "";

  // ─── Customer-activity block ──────────────────────────────────────────
  // Structured event list — replaces the raw chat-bubble replay as the
  // primary read. Each event has a label (e.g., "Verified personal info")
  // + an optional detail line.
  const activityBlock =
    view.activity && view.activity.length > 0
      ? `<h3 style="margin:24px 0 12px 0;color:${BRAND_PRIMARY};font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">What the customer did</h3>
         <ol style="margin:0 0 16px 0;padding:0 0 0 0;list-style:none;">
           ${view.activity
             .map(
               (e) => `<li style="margin:0 0 10px 0;padding:10px 14px;background:#fafaf7;border-left:3px solid ${BRAND_ACCENT};border-radius:2px;">
                 <div style="font-size:14px;font-weight:600;color:#222;">${escapeHtml(e.label)}</div>
                 ${e.detail ? `<div style="margin-top:4px;font-size:13px;color:#555;white-space:pre-wrap;line-height:1.45;">${escapeHtml(e.detail)}</div>` : ""}
               </li>`,
             )
             .join("")}
         </ol>`
      : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(buildTranscriptSubject(view))}</title>
</head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;">
  <div style="max-width:680px;margin:0 auto;padding:24px;background:#fff;">
    <div style="border-top:6px solid ${BRAND_PRIMARY};padding-top:16px;margin-bottom:16px;">
      <h1 style="margin:0;color:${BRAND_PRIMARY};font-size:18px;">Jeff's Automotive — Scheduler transcript</h1>
      <p style="margin:4px 0;color:#666;font-size:14px;">Channel: ${view.channel.toUpperCase()} · Outcome: ${escapeHtml(view.outcome)}</p>
    </div>

    ${summaryBlock}
    ${errorsBlock}
    ${sentimentBlock}

    <div style="margin-bottom:16px;font-size:14px;">
      <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(view.customer_name)}${view.customer_phone_e164 ? ` · ${escapeHtml(view.customer_phone_e164)}` : ""}</p>
      <p style="margin:4px 0;color:#666;">Started ${fmtDateTime(view.started_at)} · Ended ${fmtDateTime(view.ended_at)} · Session ${escapeHtml(view.session_id.slice(0, 8))}…</p>
    </div>

    ${customerCapturesBlock}
    ${activityBlock}
    ${pricingBlock}

    <h3 style="margin:32px 0 8px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Raw conversation log (for reference)</h3>
    <div style="font-size:12px;color:#666;">${messagesHtml}</div>

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;">
      Sent automatically by appointments.jeffsautomotive.com — Phase 1 scheduler.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Flatten a v5 UIMessage parts array into plain text. Tool calls become
 * "[tool: name]" tokens; text parts are concatenated.
 */
export function partsToText(parts: unknown): {
  text: string;
  tools: string[];
} {
  if (!Array.isArray(parts)) return { text: "", tools: [] };
  const chunks: string[] = [];
  const tools: string[] = [];
  for (const p of parts) {
    if (typeof p !== "object" || p === null) continue;
    const part = p as { type?: string; text?: string };
    if (part.type === "text" && typeof part.text === "string") {
      chunks.push(part.text);
    } else if (typeof part.type === "string" && part.type.startsWith("tool-")) {
      tools.push(part.type.replace(/^tool-/, ""));
    }
  }
  return { text: chunks.join(""), tools };
}

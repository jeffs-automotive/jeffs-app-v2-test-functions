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
  sentiment?: "positive" | "neutral" | "negative" | null;
  appointment_id?: number | null;
  appointment_starts_at?: string | null;
  pricing_discussed?: Array<{
    display_name: string;
    starting_price_cents: number;
    notes?: string | null;
  }>;
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

function fmtDateTime(iso: string): string {
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
  const negPrefix = view.sentiment === "negative" ? "[NEG] " : "";
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
  return `${negPrefix}Transcript: ${view.customer_name} — ${outcome}`;
}

export function buildTranscriptHtml(view: TranscriptViewModel): string {
  const sentimentBlock =
    view.sentiment === "negative"
      ? `<div style="margin:0 0 16px 0;padding:12px 16px;background:#fff3f3;border-left:4px solid #c62828;font-size:14px;color:#7a1f1f;border-radius:2px;">⚠ Sentiment flagged <strong>negative</strong> — please review.</div>`
      : view.sentiment === "positive"
        ? `<div style="margin:0 0 16px 0;padding:12px 16px;background:#f4f9f3;border-left:4px solid #2e7d32;font-size:14px;color:#1b3d1c;border-radius:2px;">Sentiment: positive.</div>`
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

  const apptLine =
    view.appointment_id && view.appointment_starts_at
      ? `<p style="margin:4px 0;"><strong>Appointment:</strong> #${view.appointment_id} — ${fmtDateTime(view.appointment_starts_at)}</p>`
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

    ${sentimentBlock}

    <div style="margin-bottom:16px;font-size:14px;">
      <p style="margin:4px 0;"><strong>Customer:</strong> ${escapeHtml(view.customer_name)}${view.customer_phone_e164 ? ` · ${escapeHtml(view.customer_phone_e164)}` : ""}</p>
      ${apptLine}
      <p style="margin:4px 0;color:#666;">Started ${fmtDateTime(view.started_at)} · Ended ${fmtDateTime(view.ended_at)} · Session ${escapeHtml(view.session_id.slice(0, 8))}…</p>
    </div>

    ${pricingBlock}

    <h3 style="margin:24px 0 8px 0;color:${BRAND_PRIMARY};font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">Conversation</h3>
    ${messagesHtml}

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

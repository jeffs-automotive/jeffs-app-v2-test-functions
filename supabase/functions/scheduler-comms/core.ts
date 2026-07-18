// scheduler-comms core — confirmation + reminder senders (revamp Phase 3).
//
// Plan: docs/scheduler/comms-phases-1-3-plan-2026-07-02.md. Consumed by
// index.ts (Pattern A edge fn: on-demand send_confirmation + cron
// sweep_reminders). Everything here takes an injected SupabaseClient +
// Senders so tests stub both.
//
// Send discipline (the P0 rules):
//   - CLAIM-THEN-SEND: INSERT ... ON CONFLICT DO NOTHING on
//     scheduler_reminders (appointment, kind, channel) — only the claimer
//     proceeds. Re-invocations, cron overlaps, and Vercel retries collapse.
//   - SMS is DOUBLE-GATED: an ACTIVE sms_consents row for the phone AND a
//     live provider (SMS_PROVIDER resolution). Anything else → 'skipped'
//     row with the reason. OTP is NOT sent from here (own consent basis).
//   - Email is transactional (service relationship + Resend idempotency
//     key) and sends whenever an address exists.
//   - Quiet hours (REMINDERS only): shop-local 08:00–20:59 send window,
//     conservative single-shop stance (recipient-local resolution is a
//     documented follow-up). Confirmations send immediately — the customer
//     is actively in the flow.
//   - Templates come from scheduler_message_templates (per-type row →
//     NULL-type shop default). Unknown merge tokens fail CLOSED (skipped +
//     error surfaced) — never a blanked customer message.
//
// Freshness: the local `appointments` shadow is ≤10 min stale
// (appointments-sync cron). The sweep re-reads the row at claim time; a
// canceled/moved appointment lands in 'skipped'/stale. JIT Tekmetric
// GET /appointments/{id} re-verification is a documented hardening
// follow-up (plan §4d).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logEdgeError } from "../_shared/log-edge-error.ts";
import { loadAppointmentTypes } from "../_shared/scheduler-appointment-types.ts";
import { shopLocalDateAndHour } from "../_shared/scheduler-tz.ts";
import type { SmsSendResult } from "../_shared/telnyx-client.ts";
import type { SendEmailResult } from "../_shared/resend-client.ts";

export const SHOP_PHONE_DISPLAY = "610-253-6565";
export const SHOP_BRAND = "Jeff's Automotive";
const FROM_EMAIL_DEFAULT = "Jeff's Automotive <appointments@updates.jeffsautomotive.com>";

// ─── Renderer (Deno port of admin-app template-renderer.ts) ─────────────────
// KEEP IN SYNC with admin-app/src/lib/scheduler/template-renderer.ts —
// same whitelist, same fail-closed unknown-token behavior. The admin file
// is the save-time validator; this is the send-time renderer.

export const MERGE_FIELD_KEYS = [
  "first_name",
  "appointment_date",
  "appointment_time_suffix",
  "appointment_type_label",
  "vehicle",
  "services_summary",
  "shop_phone",
  "shop_name",
] as const;

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

export type RenderResult =
  | { ok: true; text: string }
  | { ok: false; unknown_tokens: string[] };

export function renderTemplate(
  body: string,
  values: Record<string, string>,
): RenderResult {
  const known = new Set<string>(MERGE_FIELD_KEYS);
  const unknown = new Set<string>();
  const text = body.replace(TOKEN_RE, (_m, token: string) => {
    if (!known.has(token)) {
      unknown.add(token);
      return "";
    }
    return values[token] ?? "";
  });
  if (unknown.size > 0) {
    return { ok: false, unknown_tokens: Array.from(unknown) };
  }
  return { ok: true, text };
}

// ─── Injectable transports ──────────────────────────────────────────────────

export interface Senders {
  sendSms: (
    phoneE164: string,
    text: string,
    context: string,
  ) => Promise<SmsSendResult>;
  sendEmail: (args: {
    from: string;
    to: string;
    subject: string;
    html: string;
    idempotencyKey?: string;
  }) => Promise<SendEmailResult>;
}

// ─── Template resolution ────────────────────────────────────────────────────

interface TemplateRow {
  subject: string | null;
  body: string;
}

/** Per-type row wins; NULL-type shop default is the fallback. */
export async function resolveTemplate(
  sb: SupabaseClient,
  args: {
    shop_id: number;
    kind: string;
    channel: "sms" | "email";
    type_id: string | null;
  },
): Promise<TemplateRow | null> {
  if (args.type_id) {
    const { data, error } = await sb
      .from("scheduler_message_templates")
      .select("subject, body")
      .eq("shop_id", args.shop_id)
      .eq("kind", args.kind)
      .eq("channel", args.channel)
      .eq("type_id", args.type_id)
      .eq("active", true)
      .maybeSingle();
    if (error) {
      await logEdgeError(sb, {
        surface: "scheduler-comms/template_lookup",
        origin_id: "scheduler-comms",
        level: "error",
        error_code: "template_lookup_failed",
        message: error.message,
        context: { kind: args.kind, channel: args.channel },
      });
      return null;
    }
    if (data) return data as TemplateRow;
  }
  const { data, error } = await sb
    .from("scheduler_message_templates")
    .select("subject, body")
    .eq("shop_id", args.shop_id)
    .eq("kind", args.kind)
    .eq("channel", args.channel)
    .is("type_id", null)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    await logEdgeError(sb, {
      surface: "scheduler-comms/template_lookup",
      origin_id: "scheduler-comms",
      level: "error",
      error_code: "template_lookup_failed",
      message: error.message,
      context: { kind: args.kind, channel: args.channel },
    });
    return null;
  }
  return (data as TemplateRow | null) ?? null;
}

// ─── Merge-field assembly ───────────────────────────────────────────────────

export interface SendTarget {
  shop_id: number;
  tekmetric_appointment_id: number;
  appointment_type_slug: string | null; // appointments.appointment_type
  start_time: string | null; // TIMESTAMPTZ ISO
  phone_e164: string | null;
  email: string | null;
  first_name: string | null;
  vehicle: string | null;
  services_summary: string | null;
}

function formatShopDate(startTimeIso: string | null): string {
  if (!startTimeIso) return "";
  const d = new Date(startTimeIso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function formatShopTimeSuffix(
  startTimeIso: string | null,
  requiresTimeSlot: boolean,
): string {
  if (!startTimeIso || !requiresTimeSlot) return "";
  const d = new Date(startTimeIso);
  const t = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return ` at ${t}`;
}

export async function buildMergeValues(
  sb: SupabaseClient,
  target: SendTarget,
): Promise<Record<string, string>> {
  const types = await loadAppointmentTypes(sb, target.shop_id);
  const typeRow = types?.find((t) => t.slug === target.appointment_type_slug) ?? null;
  return {
    first_name: target.first_name || "there",
    appointment_date: formatShopDate(target.start_time),
    appointment_time_suffix: formatShopTimeSuffix(
      target.start_time,
      typeRow?.requires_time_slot ?? target.appointment_type_slug === "waiter",
    ),
    appointment_type_label:
      typeRow?.label ??
      (target.appointment_type_slug === "waiter" ? "Wait with vehicle" : "Drop-off"),
    vehicle: target.vehicle || "your vehicle",
    services_summary: target.services_summary || "as discussed",
    shop_phone: SHOP_PHONE_DISPLAY,
    shop_name: SHOP_BRAND,
  };
}

/** The type table's uuid for template scoping (slug → id). */
async function typeIdForSlug(
  sb: SupabaseClient,
  shopId: number,
  slug: string | null,
): Promise<string | null> {
  if (!slug) return null;
  const types = await loadAppointmentTypes(sb, shopId);
  return types?.find((t) => t.slug === slug)?.id ?? null;
}

// ─── Ledger claim ───────────────────────────────────────────────────────────

type ReminderKind = "confirmation" | "reminder_24h" | "reminder_2h";
type Channel = "sms" | "email";

/** INSERT-claim. Returns the claimed row id, or null when already claimed. */
async function claim(
  sb: SupabaseClient,
  target: SendTarget,
  kind: ReminderKind,
  channel: Channel,
): Promise<string | null> {
  const { data, error } = await sb
    .from("scheduler_reminders")
    .insert({
      shop_id: target.shop_id,
      tekmetric_appointment_id: target.tekmetric_appointment_id,
      reminder_kind: kind,
      channel,
      status: "claimed",
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return null; // already claimed — someone else owns it
    await logEdgeError(sb, {
      surface: "scheduler-comms/claim",
      origin_id: "scheduler-comms",
      level: "error",
      error_code: "reminder_claim_failed",
      message: error.message,
      context: { appt: target.tekmetric_appointment_id, kind, channel },
    });
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

async function settleClaim(
  sb: SupabaseClient,
  claimId: string,
  patch: {
    status: "sent" | "skipped" | "failed";
    skip_reason?: string;
    error?: string;
  },
): Promise<void> {
  const { error } = await sb
    .from("scheduler_reminders")
    .update({
      status: patch.status,
      skip_reason: patch.skip_reason ?? null,
      error: patch.error ?? null,
      sent_at: patch.status === "sent" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", claimId);
  if (error) {
    await logEdgeError(sb, {
      surface: "scheduler-comms/settle_claim",
      origin_id: "scheduler-comms",
      level: "error",
      error_code: "reminder_settle_failed",
      message: error.message,
      context: { claim_id: claimId, target_status: patch.status },
    });
  }
}

// ─── Appointment-SMS suppression gate (transactional + opt-out) ──────────────

// Appointment confirmation/reminder SMS is TRANSACTIONAL — it sends by default
// (2026-07-17). This returns true when the phone has an ACTIVE opt-out (wizard
// checkbox OR inbound STOP), false when it does not, null on lookup error.
// Callers fail CLOSED (skip on true OR null): never text a phone we can't
// confirm is un-suppressed — STOP compliance is the safe direction.
async function isAppointmentSmsSuppressed(
  sb: SupabaseClient,
  shopId: number,
  phoneE164: string,
): Promise<boolean | null> {
  const { data, error } = await sb
    .from("sms_appointment_opt_outs")
    .select("id")
    .eq("shop_id", shopId)
    .eq("phone_e164", phoneE164)
    .is("restored_at", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    await logEdgeError(sb, {
      surface: "scheduler-comms/opt_out_lookup",
      origin_id: "scheduler-comms",
      level: "error",
      error_code: "opt_out_lookup_failed",
      message: error.message,
      context: { phone_last_four: phoneE164.slice(-4) },
    });
    return null; // fail CLOSED — treated as suppressed by callers
  }
  return !!data;
}

// ─── One (target, kind) dispatch across both channels ──────────────────────

export interface DispatchOutcome {
  kind: ReminderKind;
  appointment_id: number;
  sms: "sent" | "skipped" | "failed" | "already_claimed";
  email: "sent" | "skipped" | "failed" | "already_claimed";
}

export async function dispatchKind(
  sb: SupabaseClient,
  senders: Senders,
  target: SendTarget,
  kind: ReminderKind,
): Promise<DispatchOutcome> {
  const outcome: DispatchOutcome = {
    kind,
    appointment_id: target.tekmetric_appointment_id,
    sms: "already_claimed",
    email: "already_claimed",
  };
  const typeId = await typeIdForSlug(sb, target.shop_id, target.appointment_type_slug);
  const values = await buildMergeValues(sb, target);

  // ── email ──────────────────────────────────────────────────────────
  const emailClaim = await claim(sb, target, kind, "email");
  if (emailClaim) {
    if (!target.email) {
      await settleClaim(sb, emailClaim, { status: "skipped", skip_reason: "no_contact" });
      outcome.email = "skipped";
    } else {
      const tpl = await resolveTemplate(sb, {
        shop_id: target.shop_id,
        kind,
        channel: "email",
        type_id: typeId,
      });
      const rendered = tpl ? renderTemplate(tpl.body, values) : null;
      if (!tpl || !rendered || !rendered.ok || !tpl.subject) {
        await settleClaim(sb, emailClaim, {
          status: "skipped",
          skip_reason: "no_template",
          error: rendered && !rendered.ok
            ? `unknown tokens: ${rendered.unknown_tokens.join(",")}`
            : undefined,
        });
        outcome.email = "skipped";
      } else {
        const subjectRendered = renderTemplate(tpl.subject, values);
        const html = rendered.text
          .split(/\r?\n/)
          .map((l) => (l.trim().length ? `<p>${l}</p>` : ""))
          .join("");
        const r = await senders.sendEmail({
          from: Deno.env.get("SCHEDULER_COMMS_FROM_EMAIL") ?? FROM_EMAIL_DEFAULT,
          to: target.email,
          subject: subjectRendered.ok ? subjectRendered.text : tpl.subject,
          html,
          idempotencyKey: `comms:${target.tekmetric_appointment_id}:${kind}:email`,
        });
        if (r.ok) {
          await settleClaim(sb, emailClaim, { status: "sent" });
          outcome.email = "sent";
        } else {
          await settleClaim(sb, emailClaim, { status: "failed", error: r.error });
          outcome.email = "failed";
        }
      }
    }
  }

  // ── sms ────────────────────────────────────────────────────────────
  const smsClaim = await claim(sb, target, kind, "sms");
  if (smsClaim) {
    if (!target.phone_e164) {
      await settleClaim(sb, smsClaim, { status: "skipped", skip_reason: "no_contact" });
      outcome.sms = "skipped";
    } else {
      const suppressed = await isAppointmentSmsSuppressed(
        sb,
        target.shop_id,
        target.phone_e164,
      );
      if (suppressed !== false) {
        // Transactional send is the default; skip ONLY when the customer has
        // opted out (true) OR the lookup errored (null → fail closed for STOP
        // compliance — never text a phone we can't confirm is un-suppressed).
        await settleClaim(sb, smsClaim, {
          status: "skipped",
          skip_reason: suppressed === true ? "opted_out" : "opt_out_lookup_failed",
        });
        outcome.sms = "skipped";
      } else {
        const tpl = await resolveTemplate(sb, {
          shop_id: target.shop_id,
          kind,
          channel: "sms",
          type_id: typeId,
        });
        const rendered = tpl ? renderTemplate(tpl.body, values) : null;
        if (!tpl || !rendered || !rendered.ok) {
          await settleClaim(sb, smsClaim, {
            status: "skipped",
            skip_reason: "no_template",
            error: rendered && !rendered.ok
              ? `unknown tokens: ${rendered.unknown_tokens.join(",")}`
              : undefined,
          });
          outcome.sms = "skipped";
        } else {
          const r = await senders.sendSms(target.phone_e164, rendered.text, kind);
          if (r.ok && r.provider_message_id !== "stub-no-send") {
            // Ledger the outbound message for DLR correlation.
            const { error: msgErr } = await sb.from("sms_messages").insert({
              shop_id: target.shop_id,
              direction: "outbound",
              phone_e164: target.phone_e164,
              kind,
              body: rendered.text,
              telnyx_message_id: r.provider_message_id ?? null,
              status: "sent",
              tekmetric_appointment_id: target.tekmetric_appointment_id,
            });
            if (msgErr && msgErr.code !== "23505") {
              await logEdgeError(sb, {
                surface: "scheduler-comms/sms_ledger",
                origin_id: "scheduler-comms",
                level: "error",
                error_code: "sms_messages_insert_failed",
                message: msgErr.message,
                context: { appt: target.tekmetric_appointment_id, kind },
              });
            }
            await settleClaim(sb, smsClaim, { status: "sent" });
            outcome.sms = "sent";
          } else if (r.ok) {
            // Stub provider — no real send happened. Document + leave
            // re-claimable? NO: the claim stands (skipped/provider_stub)
            // so flipping the provider later doesn't blast old appts.
            await settleClaim(sb, smsClaim, {
              status: "skipped",
              skip_reason: "provider_stub",
            });
            outcome.sms = "skipped";
          } else {
            await settleClaim(sb, smsClaim, {
              status: "failed",
              error: `${r.error_code}: ${r.detail ?? ""}`.slice(0, 300),
            });
            outcome.sms = "failed";
          }
        }
      }
    }
  }

  return outcome;
}

// ─── send_confirmation (on-demand from submit-summary) ─────────────────────

export async function sendConfirmationForSession(
  sb: SupabaseClient,
  senders: Senders,
  sessionId: string,
): Promise<DispatchOutcome | { error: string }> {
  const { data: row, error } = await sb
    .from("customer_chat_sessions")
    .select(
      "shop_id, appointment_id, appointment_type, appointment_date, appointment_time, phone_e164, verified_first_name, entered_first_name, new_vehicle_info, selected_simple_services, approved_testing_services, primary_email_for_description",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !row) {
    await logEdgeError(sb, {
      session_id: sessionId,
      surface: "scheduler-comms/confirmation_session_read",
      origin_id: "scheduler-comms",
      level: "error",
      error_code: "session_read_failed",
      message: error?.message ?? "session_not_found",
    });
    return { error: error?.message ?? "session_not_found" };
  }
  const apptId = row.appointment_id as number | null;
  if (!apptId) return { error: "no_appointment_on_session" };
  const shopId = (row.shop_id as number) ?? 7476;

  // Appointment row for start_time (written through at confirm).
  const { data: appt, error: apptErr } = await sb
    .from("appointments")
    .select("start_time, appointment_type")
    .eq("shop_id", shopId)
    .eq("tekmetric_appointment_id", apptId)
    .maybeSingle();
  if (apptErr) {
    await logEdgeError(sb, {
      session_id: sessionId,
      surface: "scheduler-comms/confirmation_appt_read",
      origin_id: "scheduler-comms",
      level: "warning",
      error_code: "appointment_read_failed",
      message: apptErr.message,
      context: { appointment_id: apptId },
    });
  }

  const nvi = (row.new_vehicle_info ?? {}) as Record<string, unknown>;
  const vehicle = [nvi.year, nvi.make, nvi.model]
    .filter((x) => typeof x === "string" || typeof x === "number")
    .join(" ")
    .trim();

  const serviceKeys = [
    ...(Array.isArray(row.selected_simple_services)
      ? (row.selected_simple_services as string[])
      : []),
    ...(Array.isArray(row.approved_testing_services)
      ? (row.approved_testing_services as string[])
      : []),
  ];
  let servicesSummary = "";
  if (serviceKeys.length > 0) {
    const [
      { data: r1, error: r1Err },
      { data: r2, error: r2Err },
    ] = await Promise.all([
      sb
        .from("routine_services")
        .select("service_key, display_name")
        .eq("shop_id", shopId)
        .in("service_key", serviceKeys),
      sb
        .from("testing_services")
        .select("service_key, display_name")
        .eq("shop_id", shopId)
        .in("service_key", serviceKeys),
    ]);
    if (r1Err || r2Err) {
      // Non-fatal — the humanized service_key fallback below still renders
      // a truthful summary; the read failure must be visible (rule 9).
      await logEdgeError(sb, {
        session_id: sessionId,
        surface: "scheduler-comms/service_name_lookup",
        origin_id: "scheduler-comms",
        level: "warning",
        error_code: "service_name_lookup_failed",
        message: r1Err?.message ?? r2Err?.message ?? "unknown",
      });
    }
    const names = new Map<string, string>();
    for (const r of (r1 ?? []) as Array<{ service_key: string; display_name: string }>) {
      names.set(r.service_key, r.display_name);
    }
    for (const r of (r2 ?? []) as Array<{ service_key: string; display_name: string }>) {
      if (!names.has(r.service_key)) names.set(r.service_key, r.display_name);
    }
    servicesSummary = serviceKeys
      .map((k) => names.get(k) ?? k.replace(/_/g, " "))
      .join(", ");
  }

  const target: SendTarget = {
    shop_id: shopId,
    tekmetric_appointment_id: apptId,
    appointment_type_slug:
      ((appt?.appointment_type as string | null) ??
        (row.appointment_type as string | null)) || null,
    start_time: (appt?.start_time as string | null) ?? null,
    phone_e164: row.phone_e164 as string | null,
    email: (row.primary_email_for_description as string | null) ?? null,
    first_name:
      (row.verified_first_name as string | null) ??
      (row.entered_first_name as string | null) ??
      null,
    vehicle: vehicle || null,
    services_summary: servicesSummary || null,
  };

  // Contact denormalization (Phase 1 columns) — the reminder sweeper reads
  // these; error-checked, non-fatal.
  const { error: denormErr } = await sb
    .from("appointments")
    .update({
      customer_phone_e164: target.phone_e164,
      customer_email: target.email,
      customer_first_name: target.first_name,
      contact_source: "session",
      contact_synced_at: new Date().toISOString(),
    })
    .eq("shop_id", shopId)
    .eq("tekmetric_appointment_id", apptId);
  if (denormErr) {
    await logEdgeError(sb, {
      session_id: sessionId,
      surface: "scheduler-comms/contact_denorm",
      origin_id: "scheduler-comms",
      level: "error",
      error_code: "contact_denorm_failed",
      message: denormErr.message,
      context: { appointment_id: apptId },
    });
  }

  return dispatchKind(sb, senders, target, "confirmation");
}

// ─── sweep_reminders (cron) ─────────────────────────────────────────────────

const SWEEP_WINDOWS: Array<{ kind: ReminderKind; fromMin: number; toMin: number }> = [
  { kind: "reminder_24h", fromMin: 23 * 60 + 30, toMin: 24 * 60 + 30 },
  { kind: "reminder_2h", fromMin: 90, toMin: 150 },
];

export function isWithinQuietHoursSendWindow(nowUtcMs: number): boolean {
  const { hour } = shopLocalDateAndHour(new Date(nowUtcMs).toISOString());
  return hour >= 8 && hour < 21; // shop-local 08:00–20:59 (conservative TCPA window)
}

export async function sweepReminders(
  sb: SupabaseClient,
  senders: Senders,
  nowUtcMs: number,
): Promise<{ processed: DispatchOutcome[]; quiet_hours: boolean }> {
  if (!isWithinQuietHoursSendWindow(nowUtcMs)) {
    // Outside the window: do NOT claim — the next in-window sweep sends.
    return { processed: [], quiet_hours: true };
  }
  const processed: DispatchOutcome[] = [];
  for (const w of SWEEP_WINDOWS) {
    const from = new Date(nowUtcMs + w.fromMin * 60_000).toISOString();
    const to = new Date(nowUtcMs + w.toMin * 60_000).toISOString();
    const { data: rows, error } = await sb
      .from("appointments")
      .select(
        "shop_id, tekmetric_appointment_id, appointment_type, start_time, appointment_status, customer_phone_e164, customer_email, customer_first_name",
      )
      .eq("source", "scheduler-app")
      .is("deleted_at", null)
      .not("appointment_status", "in", "(CANCELED,NO_SHOW)")
      .gte("start_time", from)
      .lte("start_time", to)
      .limit(200);
    if (error) {
      await logEdgeError(sb, {
        surface: "scheduler-comms/sweep_query",
        origin_id: "scheduler-comms",
        level: "error",
        error_code: "sweep_query_failed",
        message: error.message,
        context: { kind: w.kind },
      });
      continue;
    }
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const target: SendTarget = {
        shop_id: (r.shop_id as number) ?? 7476,
        tekmetric_appointment_id: r.tekmetric_appointment_id as number,
        appointment_type_slug: (r.appointment_type as string | null) ?? null,
        start_time: (r.start_time as string | null) ?? null,
        phone_e164: (r.customer_phone_e164 as string | null) ?? null,
        email: (r.customer_email as string | null) ?? null,
        first_name: (r.customer_first_name as string | null) ?? null,
        vehicle: null,
        services_summary: null,
      };
      processed.push(await dispatchKind(sb, senders, target, w.kind));
    }
  }
  return { processed, quiet_hours: false };
}

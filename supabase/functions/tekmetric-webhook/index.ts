// tekmetric-webhook — general-purpose Tekmetric webhook receiver.
//
// Single URL Tekmetric posts every webhook to (RO updates, appointments,
// payments, customer changes, etc.). The receiver:
//   1. Validates the `?token=<TEKMETRIC_WEBHOOK_TOKEN>` query param. Tekmetric
//      cannot send custom HTTP headers, so the URL token is the auth surface.
//   2. Parses the body as JSON.
//   3. Strips Authorization + Cookie from headers and `token` from the query
//      string before persisting (so neither lands in raw_headers / raw_query_string).
//   4. Heuristically classifies the event from event_text and extracts common
//      entity IDs (RO id, appointment id, customer id, etc.).
//   5. INSERTs into public.tekmetric_webhook_events.
//   6. Returns 200 unconditionally (after attempted insert) so Tekmetric
//      doesn't retry. Errors during insert are logged to the function's
//      stdout and surfaced in the response body but the HTTP status stays 200.
//
// Phase 1 scope is PASSIVE LOGGING ONLY. Subscribers (appointment handler,
// future systems) read from the table OR will be dispatched inline by this
// function in a later iteration. The existing `keytag-tekmetric-webhook`
// continues operating on its own URL — we don't touch it.
//
// References:
//   .claude/rules/observability.md  — webhook idempotency + DLQ guidance
//   migration 20260509235046_tekmetric_webhook_events.sql

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope } from "../_shared/sentry-edge.ts";

// test seam — see index.test.ts
// `sb` is lazily initialized (and `let`, not `const`) so tests can swap it
// via _setSupabaseClientForTesting() WITHOUT triggering createClient() —
// which requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at module load.
// In production, the first handler call constructs the real client.
let sb: SupabaseClient | null = null;

function getSb(): SupabaseClient {
  if (sb === null) {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return sb;
}

// test seam — see index.test.ts
// WEBHOOK_TOKEN is read inside the handler (not module-init) so tests can
// override the env var per-test via Deno.env.set() / Deno.env.delete().
function _readWebhookToken(): string | undefined {
  return Deno.env.get("TEKMETRIC_WEBHOOK_TOKEN");
}

// test seam — see index.test.ts
// Test-only: replace the module-level Supabase client with a mock. Setting
// any non-null value also bypasses the lazy-init in getSb(). Production
// code never calls this.
export function _setSupabaseClientForTesting(client: unknown): void {
  sb = client as SupabaseClient;
}

// ─── Heuristic event classification ─────────────────────────────────────────
// Tekmetric webhook payloads include an `event` string (e.g. "Repair Order #X
// status updated by Y"). We bucket these into a small set of inferred kinds so
// downstream queries can filter without parsing event_text every time.
function classifyEvent(eventText: string | undefined | null): string {
  if (!eventText) return "unknown";
  if (/^Repair Order #\d+ status updated by/i.test(eventText)) return "ro_status_updated";
  if (/^Repair Order #\d+ posted by/i.test(eventText))         return "ro_posted";
  if (/^Repair Order #\d+ created by/i.test(eventText))        return "ro_created";
  if (/^Payment made by/i.test(eventText))                     return "payment_made";
  if (/^Appointment.*created/i.test(eventText))                return "appointment_created";
  if (/^Appointment.*updated/i.test(eventText))                return "appointment_updated";
  if (/^Appointment.*cancel(l)?ed/i.test(eventText))           return "appointment_cancelled";
  if (/^Customer.*created/i.test(eventText))                   return "customer_created";
  if (/^Customer.*updated/i.test(eventText))                   return "customer_updated";
  if (/^Vehicle.*created/i.test(eventText))                    return "vehicle_created";
  if (/^Vehicle.*updated/i.test(eventText))                    return "vehicle_updated";
  return "unknown";
}

// ─── Entity-ID extraction ───────────────────────────────────────────────────
// Tekmetric webhook payloads use a few different shapes for the same data:
//   - RO events: data.id is the RO id; status under data.repairOrderStatus.id
//   - Payment events: data.id is the payment id, data.repairOrderId references the RO
//   - Appointment events: data.id is the appointment id (TBD — verify on first inbound)
// We collect what we can; subscribers can re-extract from raw_body for anything
// missing.
interface ExtractedIds {
  tekmetric_ro_id: number | null;
  tekmetric_appointment_id: number | null;
  tekmetric_customer_id: number | null;
  tekmetric_vehicle_id: number | null;
  tekmetric_payment_id: number | null;
  tekmetric_shop_id: number | null;
  status_id: number | null;
}

function extractIds(
  data: Record<string, unknown> | undefined,
  eventKind: string,
): ExtractedIds {
  const out: ExtractedIds = {
    tekmetric_ro_id: null,
    tekmetric_appointment_id: null,
    tekmetric_customer_id: null,
    tekmetric_vehicle_id: null,
    tekmetric_payment_id: null,
    tekmetric_shop_id: null,
    status_id: null,
  };
  if (!data) return out;

  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  // Common cross-event fields
  out.tekmetric_customer_id = numOrNull(data.customerId);
  out.tekmetric_vehicle_id = numOrNull(data.vehicleId);
  out.tekmetric_shop_id = numOrNull(data.shopId);

  // RO id placement varies by event kind
  if (eventKind.startsWith("ro_") || eventKind === "unknown") {
    out.tekmetric_ro_id = numOrNull(data.id);
    const status = data.repairOrderStatus as { id?: number } | undefined;
    out.status_id = status?.id ?? null;
  }
  if (eventKind === "payment_made") {
    out.tekmetric_payment_id = numOrNull(data.id);
    out.tekmetric_ro_id = numOrNull(data.repairOrderId);
  }
  if (eventKind.startsWith("appointment_")) {
    out.tekmetric_appointment_id = numOrNull(data.id);
    // appointments may reference an RO and customer/vehicle; keep what's there
    out.tekmetric_ro_id = out.tekmetric_ro_id ?? numOrNull(data.repairOrderId);
  }

  return out;
}

// ─── Header + querystring redaction ─────────────────────────────────────────
function safeHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "cookie" || lk === "set-cookie") continue;
    out[k] = v;
  }
  return out;
}

function safeQueryString(url: URL): string | null {
  const params = new URLSearchParams(url.search);
  params.delete("token");
  const s = params.toString();
  return s.length ? s : null;
}

// ─── Main entrypoint ────────────────────────────────────────────────────────
// test seam — see index.test.ts
// Exported as a named function so tests can call it directly without
// going through Deno.serve. Production: Deno.serve(handler) wraps it below.
export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Use POST" }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }

  // Auth via query token (Tekmetric does not support custom headers)
  const WEBHOOK_TOKEN = _readWebhookToken();
  if (!WEBHOOK_TOKEN) {
    console.error("tekmetric-webhook: TEKMETRIC_WEBHOOK_TOKEN env var is not set");
    return new Response(
      JSON.stringify({ error: "Misconfigured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("token");
  if (tokenParam !== WEBHOOK_TOKEN) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // Parse body (we read text first so we can still log raw on JSON-parse failure)
  const rawText = await req.text();
  let body: Record<string, unknown> = {};
  let parseError: string | null = null;
  try {
    body = rawText.length ? JSON.parse(rawText) : {};
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const eventText = (body.event as string | undefined) ?? null;
  const eventType = (body.event_type as string | undefined) ?? null;
  const eventKindInferred = classifyEvent(eventText);
  const data = body.data as Record<string, unknown> | undefined;
  const ids = extractIds(data, eventKindInferred);

  const insertRow = {
    event_type: eventType,
    event_text: eventText,
    event_kind_inferred: eventKindInferred,
    raw_body: parseError ? { _parse_error: parseError, _raw_text: rawText.slice(0, 8192) } : body,
    raw_headers: safeHeaders(req),
    raw_query_string: safeQueryString(url),
    ...ids,
  };

  // Idempotency at the DB level (audit B5 — migration 20260522191500).
  // event_hash is a GENERATED ALWAYS column derived from
  // (event_kind, entity_id, status_id, raw_body.data.updatedDate) — see
  // migration. .upsert with ignoreDuplicates: true means duplicate retries
  // are silently no-op'd at the DB level and `inserted` is NULL.
  const { data: inserted, error: insertErr } = await getSb()
    .from("tekmetric_webhook_events")
    .upsert(insertRow, { onConflict: "event_hash", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    // Log to function stdout so the failure shows up in `supabase functions logs`,
    // but still return 200 — Tekmetric retrying won't help if our DB is down,
    // and we don't want a flood of retries to make the situation worse.
    console.error("tekmetric-webhook: upsert failed:", insertErr.message, "row:", JSON.stringify(insertRow).slice(0, 500));
    return new Response(
      JSON.stringify({ ok: false, logged: false, error: insertErr.message }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (inserted === null) {
    // Duplicate retry — DB-level idempotency caught it. Return 200 so
    // Tekmetric stops retrying; structured log for observability.
    console.log(JSON.stringify({
      msg: "tekmetric-webhook: duplicate event ignored",
      event_kind_inferred: eventKindInferred,
    }));
    return new Response(
      JSON.stringify({
        ok: true,
        logged: true,
        duplicate: true,
        event_kind_inferred: eventKindInferred,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      logged: true,
      id: inserted.id,
      event_kind_inferred: eventKindInferred,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// PLAN-02 Phase 1 — per-request Sentry isolation scope + flush before
// returning. The exported `handler(req)` keeps the test seam intact;
// production wraps it in withSentryScope so concurrent webhook deliveries
// don't share breadcrumbs.
Deno.serve((req) => withSentryScope(req, "tekmetric-webhook", () => handler(req)));

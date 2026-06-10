// qteklink-webhook — QTekLink's dedicated Tekmetric intake receiver (C3).
//
// Receives Tekmetric webhooks (RO + payment events), DURABLY persists each event
// for an onboarded shop into public.qteklink_events BEFORE returning 200, and
// dedupes on the generated event_hash (sha256 of the whole canonical body —
// idempotency over canonically-equivalent retries; jsonb normalizes key order/
// whitespace, so two bodies that differ in any field still differ. The C4
// reducer does business-level dedup).
//
// Contract (plan §2): store, THEN 200. A duplicate/replay (unique 23505) is a
// 200, NOT a failure. We return 5xx ONLY if we genuinely can't store (DB down /
// realm-resolve error) so Tekmetric retries — this is the deliberate departure
// from the older tekmetric-webhook, which returned 200 on a store failure (a
// silent drop the review gate flags).
//
// Multi-tenant: shop_id = data.shopId (present on 100% of RO + payment events);
// realm_id = qbo_resolve_realm_for_shop(shop_id). An event for an un-onboarded
// shop (no connection → null realm) or with no shopId is acknowledged (200) +
// logged, never stored (realm_id is NOT NULL; nothing to sync for that shop).
//
// Clean cutover (plan §9): no historical backfill — this table simply starts
// empty and fills going forward.
//
// raw_body carries customer PII (payerName, ccLast4, customerId) → it lands ONLY
// in the service_role-only qteklink_events table; structured logs include only
// non-PII ids, and Sentry events are scrubbed by withSentryScope's beforeSend.
//
// References: supabase/functions/tekmetric-webhook/index.ts (pattern template),
//   migration 20260606040000_qteklink_events.sql, .claude/rules/observability.md.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { bearersEqual } from "../_shared/scheduler-auth.ts";

// test seam — lazily-initialized service-role client (see index.test.ts).
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
function _readWebhookToken(): string | undefined {
  return Deno.env.get("TEKMETRIC_WEBHOOK_TOKEN");
}
export function _setSupabaseClientForTesting(client: unknown): void {
  sb = client as SupabaseClient;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Classification ─────────────────────────────────────────────────────────
// Tekmetric payloads carry an `event` string. We bucket the kinds QTekLink acts
// on; everything else (incl. refunds/voids, whose `event` text isn't "Payment
// made…") is `unknown` and still stored — the C4 reducer reads data.refund /
// data.voided to resolve payment sub-states.
export function classifyEvent(eventText: string | undefined | null): string {
  if (!eventText) return "unknown";
  if (/^Repair Order #\d+ status updated by/i.test(eventText)) return "ro_status_updated";
  if (/^Repair Order #\d+ posted by/i.test(eventText))         return "ro_posted";
  if (/^Repair Order #\d+ unposted by/i.test(eventText))       return "ro_unposted";
  if (/^Repair Order #\d+ created by/i.test(eventText))        return "ro_created";
  if (/^Repair Order #\d+ sent to A\/R by/i.test(eventText))   return "ro_sent_to_ar";
  if (/approved .*for Repair Order #\d+/i.test(eventText))      return "ro_work_approved";
  if (/^Payment made by/i.test(eventText))                     return "payment_made";
  return "unknown";
}

// ─── Extraction ─────────────────────────────────────────────────────────────
export interface ExtractedEvent {
  shopId: number | null;
  sourceId: string | null;       // data.id — the entity's own id (informational)
  paymentId: number | null;      // data.id for payment-family events
  tekmetricRoId: number | null;  // data.id (RO) / data.repairOrderId (payment)
  eventTimeRaw: string | null;   // raw Tekmetric timestamp string (informational)
  tekmetricEventAt: string | null; // parsed ISO (or null if unparseable) — reducer ordering
}

// Accept a JSON integer OR an all-digits integer string (some APIs serialize
// large ids as strings). Reject floats / scientific / signed / non-safe-integer
// values so an id can't be silently corrupted by JS number coercion.
const numOrNull = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
};
const strOrNull = (v: unknown): string | null =>
  (typeof v === "number" || typeof v === "string") && String(v).length ? String(v) : null;

// Parse a Tekmetric timestamp to an ISO string for the timestamptz column. A
// bad/missing value → null (the reducer §3 has a fallback); the RAW string is
// kept in event_time_raw for the hash regardless.
function parseTs(raw: string | null): string | null {
  if (!raw) return null;
  // Tekmetric timestamps are UTC but some omit the zone (e.g. "2026-05-09T18:54:38").
  // Append 'Z' so Date.parse reads them as UTC, not the runtime's local timezone
  // (which would drift the reducer's event ordering).
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const t = Date.parse(hasZone ? raw : `${raw}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function extractEvent(
  data: Record<string, unknown> | undefined,
  eventKind: string,
): ExtractedEvent {
  const out: ExtractedEvent = {
    shopId: null, sourceId: null, paymentId: null,
    tekmetricRoId: null, eventTimeRaw: null, tekmetricEventAt: null,
  };
  if (!data) return out;

  // TRUST MODEL (deliberate): `data.shopId` is the event's CLAIMED tenant — Tekmetric
  // cannot send custom headers, so the payload carries the claim (same model as the
  // deployed tekmetric-webhook + keytag webhook). The server-side binding is the
  // handler's realm-resolve against qbo_connections (an un-onboarded shop id is ACKed
  // but never stored), behind the constant-time URL-token auth. HARDENING when a
  // second shop onboards: per-shop webhook tokens (token → shop binding server-side),
  // so a payload shopId that mismatches the token's shop is rejected.
  out.shopId = numOrNull(data.shopId);
  out.sourceId = strOrNull(data.id); // entity's own id (RO id or payment id)

  // Payment-family: payment_made, OR a refund/void that lands `unknown` but carries the
  // payment flags. The refund/voided flags alone qualify — an A/R-applied void/refund
  // can arrive WITHOUT repairOrderId (arPayment), and requiring it would store the row
  // with payment_id NULL, invisible to the reducer's `payment_id IS NOT NULL` scan.
  const isPaymentFamily =
    eventKind === "payment_made" ||
    data.refund != null ||
    data.voided != null ||
    (data.repairOrderId != null &&
      (data.paymentDate != null || data.paymentType != null));

  if (isPaymentFamily) {
    out.paymentId = numOrNull(data.id);
    out.tekmetricRoId = numOrNull(data.repairOrderId);
    out.eventTimeRaw = strOrNull(data.paymentDate);
  } else {
    out.tekmetricRoId = numOrNull(data.id);
    out.eventTimeRaw = strOrNull(data.postedDate) ?? strOrNull(data.updatedDate);
  }
  out.tekmetricEventAt = parseTs(out.eventTimeRaw);
  return out;
}

// ─── Redaction ──────────────────────────────────────────────────────────────
// Drop secret-/PII-bearing headers before persisting raw_headers (diagnostic
// only) — incl. forwarded-IP + referer headers (PII / can leak the source URL).
const HEADER_DENYLIST = new Set([
  "authorization", "cookie", "set-cookie", "x-api-key", "apikey",
  "proxy-authorization", "forwarded", "referer",
  // forwarded-client-IP variants (PII)
  "x-real-ip", "x-forwarded-for", "x-original-forwarded-for", "cf-connecting-ip",
  "true-client-ip", "x-client-ip", "x-cluster-client-ip", "fastly-client-ip",
]);
function safeHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    if (HEADER_DENYLIST.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}
function safeQueryString(url: URL): string | null {
  const params = new URLSearchParams(url.search);
  // case-insensitive token strip (query keys are case-sensitive; a Token=/TOKEN=
  // variant must not survive into stored diagnostics).
  for (const key of [...params.keys()]) {
    if (key.toLowerCase() === "token") params.delete(key);
  }
  const s = params.toString();
  return s.length ? s : null;
}

async function resolveRealmForShop(shopId: number): Promise<{ realmId: string | null; error: string | null }> {
  const { data, error } = await getSb().rpc("qbo_resolve_realm_for_shop", { p_shop_id: shopId });
  if (error) return { realmId: null, error: error.message };
  return { realmId: typeof data === "string" && data.length > 0 ? data : null, error: null };
}

// ─── Entrypoint (exported test seam) ──────────────────────────────────────────
export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  // Auth — Tekmetric can't send custom headers, so the URL `?token=` is the surface.
  const WEBHOOK_TOKEN = _readWebhookToken();
  if (!WEBHOOK_TOKEN) {
    console.error("qteklink-webhook: TEKMETRIC_WEBHOOK_TOKEN is not set");
    return json(500, { error: "Misconfigured" });
  }
  const url = new URL(req.url);
  // constant-time compare (bearersEqual) — `!==` can leak per-byte timing.
  if (!bearersEqual(url.searchParams.get("token") ?? "", WEBHOOK_TOKEN)) {
    Sentry.withScope((scope) => {
      scope.setLevel("warning");
      scope.setTag("event", "signature_fail");
      scope.setFingerprint(["webhook-sig-fail", "qteklink", "/functions/v1/qteklink-webhook"]);
      scope.setContext("request", {
        ip: req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown",
        user_agent: req.headers.get("user-agent") ?? "unknown",
        url: req.url,
        method: req.method,
      });
      Sentry.captureMessage("QTekLink webhook signature failed", "warning");
    });
    return json(401, { error: "Unauthorized" });
  }

  // Parse (read text first so a parse failure can still be recorded).
  const rawText = await req.text();
  let body: Record<string, unknown> = {};
  let parseError: string | null = null;
  try {
    body = rawText.length ? JSON.parse(rawText) : {};
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }

  const eventText = (body.event as string | undefined) ?? null;
  const eventKind = classifyEvent(eventText);
  const data = body.data as Record<string, unknown> | undefined;
  const ev = extractEvent(data, eventKind);

  // Need a shop to derive the realm (the multi-tenant key). No shopId =
  // malformed / not a shop-scoped event → acknowledge + log (visible, not silent).
  if (ev.shopId === null) {
    Sentry.captureMessage("QTekLink webhook: event with no data.shopId — not stored", "warning");
    return json(200, { ok: true, stored: false, reason: "no_shop_id", event_kind: eventKind });
  }

  // Realm bound to the shop. RPC error = a real DB problem → 5xx (retry).
  const { realmId, error: realmErr } = await resolveRealmForShop(ev.shopId);
  if (realmErr) {
    Sentry.captureException(new Error(`qteklink-webhook: realm resolve failed: ${realmErr}`));
    return json(503, { ok: false, stored: false, error: "realm_resolve_failed" });
  }
  if (realmId === null) {
    // Shop has no QBO connection — we don't sync it. Acknowledge + log.
    console.log(JSON.stringify({
      level: "info", surface: "qteklink-webhook",
      msg: "event for an un-onboarded shop — not stored", shop_id: ev.shopId, event_kind: eventKind,
    }));
    return json(200, { ok: true, stored: false, reason: "shop_not_onboarded", event_kind: eventKind });
  }

  const insertRow = {
    shop_id: ev.shopId,
    realm_id: realmId,
    event_kind: eventKind,
    event_text: eventText,
    source_id: ev.sourceId,
    event_time_raw: ev.eventTimeRaw,
    tekmetric_event_at: ev.tekmetricEventAt,
    payment_id: ev.paymentId,
    tekmetric_ro_id: ev.tekmetricRoId,
    // PII lives only here (service_role-only table). On a parse failure, keep a
    // bounded raw snippet so we can diagnose without trusting the JSON shape.
    raw_body: parseError ? { _parse_error: parseError, _raw_text: rawText.slice(0, 8192) } : body,
    raw_headers: safeHeaders(req),
    raw_query_string: safeQueryString(url),
  };

  // DURABLE-then-200: insert FIRST, catch the dedup. NEVER .upsert({onConflict})
  // — PostgREST can't infer the PARTIAL unique index's predicate (42P10).
  const { data: inserted, error: insertErr } = await getSb()
    .from("qteklink_events")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Duplicate/replay — already durably stored. 200 so Tekmetric stops.
      console.log(JSON.stringify({
        level: "info", surface: "qteklink-webhook", msg: "duplicate event ignored",
        shop_id: ev.shopId, event_kind: eventKind, payment_id: ev.paymentId, tekmetric_ro_id: ev.tekmetricRoId,
      }));
      return json(200, { ok: true, stored: false, duplicate: true, event_kind: eventKind });
    }
    // Genuine store failure — we have NOT persisted the event. Capture + 5xx so
    // Tekmetric retries (the durable-before-200 contract; no silent drop).
    Sentry.captureException(new Error(`qteklink-webhook: insert failed (${insertErr.code}): ${insertErr.message}`));
    return json(503, { ok: false, stored: false, error: "store_failed" });
  }

  return json(200, { ok: true, stored: true, id: inserted?.id ?? null, event_kind: eventKind });
}

// Production: per-request Sentry isolation scope + PII scrub + flush.
Deno.serve((req) => withSentryScope(req, "qteklink-webhook", () => handler(req)));

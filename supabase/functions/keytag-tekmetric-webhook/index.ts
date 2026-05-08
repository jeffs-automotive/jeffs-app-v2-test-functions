// keytag-tekmetric-webhook (v6 — port of v5 to jeffs-app-v2-test-functions)
//
// Tekmetric webhooks: URL-only configuration. Auth via ?token=<secret> query param.
//
// Three flows:
//   1. RO status -> 2 (WIP)         : assign next keytag, PATCH to Tekmetric (only if needed)
//   2. RO status -> 5 (Posted/paid) : release tag
//   3. RO status -> 6 (A/R)         : keep tag, stamp posted_at
//   4. Payment made (arPayment+ok)  : release tag
//
// LOOP PREVENTION (carried forward from v5 after the v3 outage):
//   Tekmetric fires `status_updated` on ANY field change to an RO, including the keyTag
//   field PATCHed by this very function. Without guards, that PATCH triggers another
//   inbound webhook with status_id=2, which triggers another PATCH, ad infinitum. We have
//   no way to scope the Tekmetric subscription, so we filter in-house with two guards:
//
//   #1 (idempotent PATCH): the webhook body includes the RO's current keytag value as
//      `data.keytag` (lowercase string, e.g. "5"). After computing the tag we want to
//      assign, we compare to the body value. If equal, we skip the PATCH entirely.
//      This is the primary loop-breaker.
//
//   #2 (DB idempotency): assign_next_keytag() returns the same tag if the RO already
//      holds one (FOR UPDATE SKIP LOCKED + early-return). Even if guard #1 fails, the
//      DB won't double-assign.
//
//   #3 (self-authored gate): events triggered by our service-account API token have a
//      blank actor in event_text ("...status updated by " with nothing after "by").
//      We early-exit on these as a belt-and-suspenders defense in case #1 ever regresses.
//
// All raw events are logged to keytag_webhook_events for audit/replay.
// Returns 200 unconditionally after logging (so Tekmetric won't retry).
//
// Differences from v5:
//   - Vault read RPC renamed: read_secret_by_name → tekmetric_get_secret (project convention)
//   - Tekmetric base URL imported from _shared/tekmetric.ts (not env var) so flipping
//     sandbox/prod is a code change, deployed atomically with the rest of the function set
//   - Status IDs imported from _shared/tekmetric.ts as named constants
//   - SHOP_ID still read from env var (TEKMETRIC_SHOP_ID) for now; falls back to 7476
//     (Jeff's). When we go multi-shop, route by webhook body's shop scope.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  TEKMETRIC_API_BASE,
  TEKMETRIC_RO_STATUS,
  VAULT_NAMES,
  ENV_NAMES,
} from "../_shared/tekmetric.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_TOKEN = Deno.env.get(ENV_NAMES.WEBHOOK_TOKEN);
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Webhook event classification ───────────────────────────────────────────
type EventKind = "ro_status_updated" | "ro_posted" | "payment_made" | "unknown";

function classifyEvent(eventText: string | undefined): EventKind {
  if (!eventText) return "unknown";
  if (/^Repair Order #\d+ status updated by/i.test(eventText)) return "ro_status_updated";
  if (/^Repair Order #\d+ posted by/i.test(eventText)) return "ro_posted";
  if (/^Payment made by/i.test(eventText)) return "payment_made";
  return "unknown";
}

// Tekmetric appends the actor's email after "by". When the change is triggered by our
// service-account API token, the actor is empty -> trailing "by " with nothing after.
// That's the fingerprint of a self-authored (loop) event.
function isSelfAuthored(eventText: string | null | undefined): boolean {
  if (!eventText) return false;
  const idx = eventText.lastIndexOf(" by ");
  if (idx < 0) return false;
  const actor = eventText.slice(idx + 4).trim();
  return actor.length === 0;
}

// Webhook body returns the keytag as a lowercase string field (e.g. "keytag": "5").
// The PATCH endpoint accepts the camelCase numeric field `keyTag`. Coerce for compare.
function readBodyKeytag(data: Record<string, unknown>): number | null {
  const raw = data.keytag;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await sb.rpc("tekmetric_get_secret", {
    p_name: VAULT_NAMES.ACCESS_TOKEN,
  });
  if (error) throw new Error(`tekmetric_get_secret RPC failed: ${error.message}`);
  if (!data) throw new Error(`Vault has no value for ${VAULT_NAMES.ACCESS_TOKEN}. Run tekmetric-bootstrap first.`);
  return data as string;
}

async function patchKeytagToTekmetric(
  roId: number,
  keyTag: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `${TEKMETRIC_API_BASE}/repair-orders/${roId}?shop=${SHOP_ID}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ keyTag }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface LogEventInput {
  event_text: string | null;
  event_kind: EventKind;
  tekmetric_ro_id: number | null;
  status_id: number | null;
  payment_id: number | null;
  raw_body: unknown;
  raw_headers: Record<string, string>;
}

async function logEvent(raw: LogEventInput): Promise<string> {
  const { data, error } = await sb
    .from("keytag_webhook_events")
    .insert(raw)
    .select("id")
    .single();
  if (error) throw new Error(`Log insert failed: ${error.message}`);
  return data!.id as string;
}

async function markProcessed(
  eventId: string,
  result: string,
  detail: unknown,
  errorMessage?: string,
): Promise<void> {
  await sb
    .from("keytag_webhook_events")
    .update({
      processed_at: new Date().toISOString(),
      processing_result: result,
      processing_detail: detail,
      error_message: errorMessage ?? null,
    })
    .eq("id", eventId);
}

Deno.serve(async (req: Request) => {
  // ── Auth via query param (Tekmetric doesn't support custom headers) ──
  if (!WEBHOOK_TOKEN) {
    console.error("TEKMETRIC_WEBHOOK_TOKEN not set on this function");
    return new Response(JSON.stringify({ error: "Misconfigured" }), { status: 500 });
  }
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("token");
  if (tokenParam !== WEBHOOK_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // ── Parse + log raw ──
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;

  const eventText = (body.event as string | undefined) ?? null;
  const eventKind = classifyEvent(eventText ?? undefined);
  const data = (body.data ?? {}) as Record<string, unknown>;

  let roId: number | null = null;
  let statusId: number | null = null;
  let paymentId: number | null = null;

  if (eventKind === "ro_status_updated" || eventKind === "ro_posted") {
    roId = (data.id as number) ?? null;
    const status = data.repairOrderStatus as Record<string, unknown> | undefined;
    statusId = (status?.id as number) ?? null;
  } else if (eventKind === "payment_made") {
    paymentId = (data.id as number) ?? null;
    roId = (data.repairOrderId as number) ?? null;
  }

  // Always log first so we have a full audit trail, including events we skip below.
  let eventId: string;
  try {
    eventId = await logEvent({
      event_text: eventText,
      event_kind: eventKind,
      tekmetric_ro_id: roId,
      status_id: statusId,
      payment_id: paymentId,
      raw_body: body,
      raw_headers: headers,
    });
  } catch (e) {
    console.error("Failed to log webhook", e);
    return new Response(JSON.stringify({ ok: false, logged: false }), { status: 200 });
  }

  // ── GUARD #3: drop self-authored webhooks at the door ──
  // These are echoes of our own PATCH calls. Processing them would trigger another PATCH,
  // perpetuating the loop that took us out in v3.
  if (isSelfAuthored(eventText)) {
    await markProcessed(eventId, "skipped_self_authored", { event_text: eventText });
    return new Response(
      JSON.stringify({ ok: true, action: "skipped_self_authored" }),
      { status: 200 },
    );
  }

  try {
    if (!roId) {
      await markProcessed(eventId, "noop", { reason: "no ro id" });
      return new Response(JSON.stringify({ ok: true, action: "noop" }), { status: 200 });
    }

    // === RO status updated -> WIP ===
    if (eventKind === "ro_status_updated" && statusId === TEKMETRIC_RO_STATUS.WIP) {
      const customerId   = (data.customerId       as number) ?? null;
      const vehicleId    = (data.vehicleId        as number) ?? null;
      const advisorId    = (data.serviceWriterId  as number) ?? null;
      const technicianId = (data.technicianId     as number) ?? null;
      const roNumber     = (data.repairOrderNumber as number) ?? null;

      const { data: tagData, error } = await sb.rpc("assign_next_keytag", {
        p_ro_id: roId,
        p_ro_number: roNumber,
        p_customer_id: customerId,
        p_vehicle_id: vehicleId,
        p_advisor_id: advisorId,
        p_technician_id: technicianId,
      });

      if (error) {
        await markProcessed(eventId, "error", { stage: "assign_rpc" }, error.message);
        return new Response(
          JSON.stringify({ ok: false, error: error.message }),
          { status: 200 },
        );
      }

      const tag = tagData as number | null;
      if (tag === null) {
        await markProcessed(
          eventId,
          "error",
          { reason: "pool_exhausted" },
          "All 100 key tags in use",
        );
        return new Response(
          JSON.stringify({ ok: false, error: "pool exhausted" }),
          { status: 200 },
        );
      }

      // ── GUARD #1: idempotent PATCH (the actual loop-breaker) ──
      // If Tekmetric already has the tag we'd be PATCHing, the PATCH would be a no-op
      // for them and a feedback-loop generator for us. Skip it.
      const tekmetricKeytag = readBodyKeytag(data);
      if (tekmetricKeytag === tag) {
        await markProcessed(eventId, "assigned_no_patch_needed", {
          tag_number: tag,
          tekmetric_keytag: tekmetricKeytag,
          reason: "already_in_sync",
        });
        return new Response(
          JSON.stringify({
            ok: true,
            action: "assigned_no_patch_needed",
            tag,
            ro_id: roId,
          }),
          { status: 200 },
        );
      }

      const patchResult = await patchKeytagToTekmetric(roId, tag);
      await sb.rpc("record_keytag_patched", {
        p_ro_id: roId,
        p_success: patchResult.ok,
        p_error: patchResult.error ?? null,
      });

      await markProcessed(
        eventId,
        patchResult.ok ? "assigned" : "assigned_patch_failed",
        {
          tag_number: tag,
          tekmetric_keytag_before: tekmetricKeytag,
          patch_ok: patchResult.ok,
          patch_error: patchResult.error ?? null,
        },
      );

      return new Response(
        JSON.stringify({ ok: true, action: "assigned", tag, ro_id: roId }),
        { status: 200 },
      );
    }

    // === RO posted (status 5 = paid, 6 = A/R) ===
    if (eventKind === "ro_posted") {
      if (statusId === TEKMETRIC_RO_STATUS.POSTED_PAID) {
        const { data: releasedTag } = await sb.rpc("release_keytag_for_ro", {
          p_ro_id: roId,
          p_reason: "posted_paid",
        });
        await markProcessed(
          eventId,
          releasedTag ? "released" : "noop",
          { tag_number: releasedTag, reason: "posted_paid" },
        );
        return new Response(
          JSON.stringify({ ok: true, action: "released", tag: releasedTag }),
          { status: 200 },
        );
      }
      if (statusId === TEKMETRIC_RO_STATUS.POSTED_AR) {
        const { data: postedTag } = await sb.rpc("mark_keytag_posted", {
          p_ro_id: roId,
        });
        await markProcessed(
          eventId,
          postedTag ? "posted_marked" : "noop",
          { tag_number: postedTag, reason: "posted_ar_balance_due" },
        );
        return new Response(
          JSON.stringify({ ok: true, action: "posted_marked", tag: postedTag }),
          { status: 200 },
        );
      }
      await markProcessed(eventId, "noop", {
        reason: "posted_unexpected_status",
        status_id: statusId,
      });
      return new Response(JSON.stringify({ ok: true, action: "noop" }), { status: 200 });
    }

    // === Payment made ===
    if (eventKind === "payment_made") {
      const arPayment = data.arPayment === true;
      const succeeded = data.paymentStatus === "SUCCEEDED";
      const voided    = data.voided === true;
      const refund    = data.refund === true;

      if (!arPayment || !succeeded || voided || refund) {
        await markProcessed(eventId, "noop", {
          reason: "payment_does_not_qualify_for_release",
          arPayment,
          succeeded,
          voided,
          refund,
        });
        return new Response(JSON.stringify({ ok: true, action: "noop" }), { status: 200 });
      }

      const { data: releasedTag } = await sb.rpc("release_keytag_for_ro", {
        p_ro_id: roId,
        p_reason: "payment_webhook",
      });
      await markProcessed(
        eventId,
        releasedTag ? "released" : "noop",
        { tag_number: releasedTag, reason: "payment_webhook", payment_id: paymentId },
      );
      return new Response(
        JSON.stringify({ ok: true, action: "released", tag: releasedTag }),
        { status: 200 },
      );
    }

    await markProcessed(eventId, "noop", {
      reason: "event_does_not_trigger_action",
      event_kind: eventKind,
      status_id: statusId,
    });
    return new Response(JSON.stringify({ ok: true, action: "noop" }), { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markProcessed(eventId, "error", { stage: "unhandled" }, msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 200 });
  }
});

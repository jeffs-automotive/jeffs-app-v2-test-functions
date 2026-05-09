// keytag-tekmetric-webhook (v7 — DB-first + GET-verify pattern)
//
// Tekmetric webhooks: URL-only configuration. Auth via ?token=<secret> query
// param (Tekmetric doesn't support custom headers; the token IS the URL secret).
//
// Flows:
//   1. RO status_updated webhook       : if our DB shows no tag for this RO,
//                                        GET the RO from Tekmetric to re-verify
//                                        status. If status=WIP, assign a tag
//                                        (lowest available 1..100) and PATCH
//                                        Tekmetric. If our DB already has a tag
//                                        for this RO, do nothing.
//   2. RO posted (status=POSTED_PAID)  : release the tag
//   3. RO posted (status=POSTED_AR)    : keep tag, mark posted_at
//   4. Payment made (arPayment+ok)     : release the tag
//
// LOOP PREVENTION:
//   Tekmetric fires `status_updated` on ANY field change to an RO, including
//   the keyTag field PATCHed by this very function. The previous v3 outage
//   was a feedback loop where every PATCH triggered another webhook → another
//   PATCH. v5 fixed it with two guards (idempotent PATCH + self-authored event
//   filter). v7 simplifies the loop story by making the OUR DB the source of
//   truth for "does this RO have a tag":
//     - If our keytags table says yes → skip (no GET, no PATCH)
//     - If our keytags table says no  → GET to verify status, then assign+PATCH
//   The loop-back webhook from our own PATCH lands in case "yes already has
//   tag" → skipped → no PATCH → no further webhook. Loop broken at the DB
//   layer. Self-authored event filter retained as belt-and-suspenders.
//
// All raw events are logged to keytag_webhook_events for audit/replay.
// Returns 200 unconditionally after logging (so Tekmetric won't retry).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  TEKMETRIC_API_BASE,
  TEKMETRIC_RO_STATUS,
  VAULT_NAMES,
  ENV_NAMES,
} from "../_shared/tekmetric.ts";
import { getRepairOrderById } from "../_shared/tools/repair-orders.ts";

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

/**
 * Tekmetric appends the actor's email after "by" in event_text. When the change is
 * triggered by our service-account API token (i.e., our own PATCH), the actor field
 * is empty — trailing "by " with nothing after. We treat that as a self-authored
 * loop event and skip processing as a defensive measure.
 */
function isSelfAuthored(eventText: string | null | undefined): boolean {
  if (!eventText) return false;
  const idx = eventText.lastIndexOf(" by ");
  if (idx < 0) return false;
  const actor = eventText.slice(idx + 4).trim();
  return actor.length === 0;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

/** Returns the keytag currently assigned to a given Tekmetric RO id, or null. */
async function getAssignedKeytag(roId: number): Promise<number | null> {
  const { data, error } = await sb
    .from("keytags")
    .select("tag_number")
    .eq("ro_id", roId)
    .maybeSingle();
  if (error) {
    console.error("keytags lookup failed:", error.message);
    return null;
  }
  return (data?.tag_number as number | undefined) ?? null;
}

// ─── Tekmetric API helpers ──────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const { data, error } = await sb.rpc("tekmetric_get_secret", {
    p_name: VAULT_NAMES.ACCESS_TOKEN,
  });
  if (error) throw new Error(`tekmetric_get_secret RPC failed: ${error.message}`);
  if (!data) {
    throw new Error(
      `Vault has no value for ${VAULT_NAMES.ACCESS_TOKEN}. Run tekmetric-bootstrap first.`,
    );
  }
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

// ─── Audit logging ──────────────────────────────────────────────────────────

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

// ─── Main entry ─────────────────────────────────────────────────────────────

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

  // ── Self-authored event filter (defensive) ──
  // Echoes of our own PATCH calls. The DB-first flow below already prevents the
  // loop, but skipping at the door saves a DB lookup + Tekmetric GET.
  if (isSelfAuthored(eventText)) {
    await markProcessed(eventId, "skipped_self_authored", { event_text: eventText });
    return new Response(
      JSON.stringify({ ok: true, action: "skipped_self_authored" }),
      { status: 200 },
    );
  }

  try {
    if (!roId) {
      await markProcessed(eventId, "noop", { reason: "no ro id in webhook body" });
      return new Response(JSON.stringify({ ok: true, action: "noop" }), { status: 200 });
    }

    // ── Branch 1: status_updated ─────────────────────────────────────────
    if (eventKind === "ro_status_updated") {
      // Step 1: do we already have a tag for this RO?
      const existing = await getAssignedKeytag(roId);
      if (existing !== null) {
        await markProcessed(eventId, "skipped_already_assigned", {
          ro_id: roId,
          tag_number: existing,
        });
        return new Response(
          JSON.stringify({ ok: true, action: "skipped_already_assigned", tag: existing, ro_id: roId }),
          { status: 200 },
        );
      }

      // Step 2: GET the RO from Tekmetric to verify status (defensive — don't trust webhook payload)
      let ro;
      try {
        ro = await getRepairOrderById(sb, SHOP_ID, roId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await markProcessed(eventId, "error", { stage: "tekmetric_get" }, msg);
        return new Response(JSON.stringify({ ok: false, error: msg }), { status: 200 });
      }
      if (!ro) {
        await markProcessed(eventId, "error", { stage: "tekmetric_get", reason: "ro_not_found" }, `RO ${roId} not found in Tekmetric`);
        return new Response(JSON.stringify({ ok: false, error: "RO not found" }), { status: 200 });
      }

      const verifiedStatusId = ro.repairOrderStatus?.id;
      if (verifiedStatusId !== TEKMETRIC_RO_STATUS.WIP) {
        await markProcessed(eventId, "skipped_not_wip", {
          ro_id: roId,
          webhook_status_id: statusId,
          verified_status_id: verifiedStatusId,
          verified_status_name: ro.repairOrderStatus?.name,
        });
        return new Response(
          JSON.stringify({ ok: true, action: "skipped_not_wip", ro_id: roId }),
          { status: 200 },
        );
      }

      // Step 3: assign the lowest-available tag and PATCH Tekmetric
      const { data: tagData, error: assignErr } = await sb.rpc("assign_next_keytag", {
        p_ro_id: roId,
        p_ro_number: ro.repairOrderNumber,
        p_customer_id: ro.customerId,
        p_vehicle_id: ro.vehicleId,
        p_advisor_id: ro.serviceWriterId,
        p_technician_id: ro.technicianId,
      });
      if (assignErr) {
        await markProcessed(eventId, "error", { stage: "assign_rpc" }, assignErr.message);
        return new Response(JSON.stringify({ ok: false, error: assignErr.message }), { status: 200 });
      }
      const tag = tagData as number | null;
      if (tag === null) {
        await markProcessed(eventId, "error", { reason: "pool_exhausted" }, "All 100 key tags in use");
        return new Response(JSON.stringify({ ok: false, error: "pool exhausted" }), { status: 200 });
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
          patch_ok: patchResult.ok,
          patch_error: patchResult.error ?? null,
        },
      );
      return new Response(
        JSON.stringify({ ok: true, action: "assigned", tag, ro_id: roId }),
        { status: 200 },
      );
    }

    // ── Branch 2: ro_posted (status 5 = POSTED_PAID, 6 = POSTED_AR) ──────
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
        const { data: postedTag } = await sb.rpc("mark_keytag_posted", { p_ro_id: roId });
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

    // ── Branch 3: payment_made ───────────────────────────────────────────
    if (eventKind === "payment_made") {
      const arPayment = data.arPayment === true;
      const succeeded = data.paymentStatus === "SUCCEEDED";
      const voided = data.voided === true;
      const refund = data.refund === true;

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

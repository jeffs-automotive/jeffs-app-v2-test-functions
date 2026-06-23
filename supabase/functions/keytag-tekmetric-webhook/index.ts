// keytag-tekmetric-webhook (v8 — primary/backup event design)
//
// Tekmetric webhooks: URL-only configuration. Auth via ?token=<secret> query
// param (Tekmetric doesn't support custom headers; the token IS the URL secret).
//
// Subscriptions enabled in Tekmetric (Chris configured 2026-05-11):
//   - Work approved / declined        (PRIMARY  WIP trigger)
//   - Sent to A/R                     (PRIMARY  A/R timestamp source)
//   - Status updated                  (BACKUP   catch-all for missed events)
//   - Posted                          (handles paid-at-counter + A/R via statusId)
//   - Payment made                    (releases tag on A/R balance pay)
//
// Flows:
//   1. ro_work_approved   (PRIMARY)   : DB-first check → GET verify → if WIP,
//                                       assign tag, PATCH Tekmetric. Replaces
//                                       relying on status_updated for the
//                                       Estimate → WIP transition.
//   2. ro_status_updated  (BACKUP)    : Same logic as #1. Catches WIP entries
//                                       that work_approved missed (Tekmetric
//                                       webhook delivery is occasionally
//                                       unreliable).
//   3. ro_sent_to_ar      (PRIMARY)   : Mark tag posted_ar with the REAL
//                                       Tekmetric postedDate from body (not
//                                       now()) — staleness clock starts at
//                                       the actual A/R transition. If we have
//                                       no tag (upstream events missed),
//                                       assign one first.
//   4. ro_posted          (BACKUP)    : Branches on statusId. 5 = POSTED_PAID
//                                       (release tag), 6 = POSTED_AR (mark
//                                       posted with body.postedDate, redundant
//                                       with #3 but safe — idempotent).
//   5. payment_made                   : arPayment + succeeded + !voided +
//                                       !refund → release tag using
//                                       data.repairOrderId.
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

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  TEKMETRIC_API_BASE,
  TEKMETRIC_RO_STATUS,
  VAULT_NAMES,
  ENV_NAMES,
} from "../_shared/tekmetric.ts";
import { getRepairOrderById } from "../_shared/tools/repair-orders.ts";
import { formatKeytag } from "../_shared/keytag-format.ts";
import { resolveCustomerName } from "../_shared/keytag-customer-name.ts";
import { autoResolveReviewsForRo } from "../_shared/keytag-auto-resolve.ts";
import {
  issueManualReview,
  type ManualReviewOption,
} from "../_shared/manual-review.ts";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { bearersEqual } from "../_shared/scheduler-auth.ts";

// ── Manual-review option presets used by webhook detections ────────────────
function driftOptions(roNumber: number, priorTag: string): ManualReviewOption[] {
  return [
    {
      key: "use_prior_tag",
      label: `Re-confirm ${priorTag} is on the keys`,
      description: `The same physical tag (${priorTag}) is still on the keys. We'll re-attach it in our system AND write it to Tekmetric so everyone sees it.`,
    },
    {
      key: "use_different_tag",
      label: "A different tag is on the keys",
      description: "Tell us the color + number that's physically on the keys for this RO. We'll record it.",
      needs_tag_input: true,
    },
    {
      key: "assign_new",
      label: "Assign a fresh tag (round-robin)",
      description: "The keys don't have a tag yet but need one. We'll pick the next available tag, write it to Tekmetric, and you can put it on the keys.",
    },
    {
      key: "no_tag",
      label: "Don't tag this RO",
      description: `The keys aren't in the shop or RO #${roNumber} doesn't need a tag right now.`,
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Send to Chris — pick this if you're unsure.",
    },
  ];
}

function patchFailOptions(): ManualReviewOption[] {
  return [
    {
      key: "retry_patch",
      label: "Retry writing to Tekmetric",
      description: "Try the same write again. Pick this if you suspect the failure was a temporary Tekmetric outage.",
    },
    {
      key: "release_and_redo",
      label: "Release the tag and start over",
      description: "Release the tag in our system, then assign a fresh one (will retry the Tekmetric write). Use this if the Tekmetric record is too out-of-sync to recover cleanly.",
    },
    {
      key: "accept_unsynced",
      label: "Keep the tag in our system without Tekmetric",
      description: "Leave our records as-is. The Tekmetric Key Tag field stays blank. Advisors will see our system's data but not Tekmetric's.",
    },
    {
      key: "escalate_chris",
      label: "Escalate to Chris",
      description: "Send to Chris.",
    },
  ];
}

const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

// test seam — see index.test.ts
// `sb` is lazily initialized via a Proxy so tests can swap the underlying
// client via _setSupabaseClientForTesting() WITHOUT triggering createClient()
// (which requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at module load).
// In production, the first property access constructs the real client.
let _sbImpl: SupabaseClient | null = null;

function _getSbImpl(): SupabaseClient {
  if (_sbImpl === null) {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    _sbImpl = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _sbImpl;
}

// Proxy that defers to _getSbImpl() on every property access. Lets every
// existing `sb.from(...)` / `sb.rpc(...)` call site keep working unchanged.
// Typed as SupabaseClient so the consumer code still type-checks.
const sb = new Proxy({} as SupabaseClient, {
  get(_target, prop, _receiver): unknown {
    const impl = _getSbImpl();
    const val = (impl as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(impl) : val;
  },
});

// test seam — see index.test.ts
// WEBHOOK_TOKEN is read inside the handler (not module-init) so tests can
// override the env var per-test via Deno.env.set() / Deno.env.delete().
function _readWebhookToken(): string | undefined {
  return Deno.env.get(ENV_NAMES.WEBHOOK_TOKEN);
}

// test seam — see index.test.ts
// Test-only: replace the module-level Supabase client with a mock. Setting
// any non-null value bypasses the lazy-init in _getSbImpl(). Production
// code never calls this.
export function _setSupabaseClientForTesting(client: unknown): void {
  _sbImpl = client as SupabaseClient;
}

// ─── Webhook event classification ───────────────────────────────────────────
type EventKind =
  | "ro_work_approved" // Primary WIP trigger — advisor approved work, RO -> WIP
  | "ro_sent_to_ar"    // Primary A/R trigger — RO posted with statusId=6 (carries real postedDate)
  | "ro_status_updated" // Backup catch-all — fires on ANY field change
  | "ro_posted"         // Generic post event — branches on statusId in body
  | "payment_made"      // A/R balance paid → release tag
  | "unknown";

function classifyEvent(eventText: string | undefined): EventKind {
  if (!eventText) return "unknown";
  // Order matters: more-specific patterns first.
  // "Michael Jacobi approved 1 job(s) and declined 0 job(s) for Repair Order #152448"
  if (/approved \d+ job\(s\) and declined \d+ job\(s\) for Repair Order #\d+/i.test(eventText)) {
    return "ro_work_approved";
  }
  // "Repair Order #150873 sent to A/R by chris@jeffsautomotive.com"
  if (/^Repair Order #\d+ sent to A\/R by/i.test(eventText)) {
    return "ro_sent_to_ar";
  }
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

/** Returns the keytag currently assigned to a given Tekmetric RO id, or null.
 *  Includes the row's `status` so callers can detect regression scenarios
 *  (e.g. tag is `posted_ar` but the incoming status_updated webhook shows WIP). */
async function getAssignedKeytag(
  roId: number,
): Promise<
  | {
      color: "red" | "yellow";
      number: number;
      status: "assigned" | "posted_ar" | "available";
    }
  | null
> {
  const { data, error } = await sb
    .from("keytags")
    .select("tag_color, tag_number, status")
    .eq("ro_id", roId)
    .maybeSingle();
  if (error) {
    console.error("keytags lookup failed:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    color: data.tag_color as "red" | "yellow",
    number: data.tag_number as number,
    status: data.status as "assigned" | "posted_ar" | "available",
  };
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
  keyTagString: string,
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
        // Tekmetric's keyTag field accepts text; we send the encoded color form ("R5", "Y45").
        body: JSON.stringify({ keyTag: keyTagString }),
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

/**
 * Persist the inbound webhook event. Returns the new row's id on success
 * OR `null` when the event_hash matched an existing row (DB-level
 * idempotency caught a Tekmetric retry, audit B5 — migration
 * 20260522191500). Callers that get `null` should skip downstream
 * processing and return 200 (we already handled this logical event).
 */
async function logEvent(raw: LogEventInput): Promise<string | null> {
  // Plain INSERT + catch unique-violation (23505). The partial unique index
  // `keytag_webhook_events_event_hash_uniq` (event_hash WHERE event_hash IS
  // NOT NULL AND idempotency_active = true) enforces idempotency at the DB
  // level. PostgREST's `onConflict=event_hash` cannot infer a partial index
  // (no WHERE-clause predicate is sent), which is why the previous
  // `.upsert({onConflict, ignoreDuplicates: true})` raised
  // `42P10: no unique or exclusion constraint matching the ON CONFLICT
  // specification` on every call — silent regression 2026-05-22 through
  // 2026-05-26.
  const { data, error } = await sb
    .from("keytag_webhook_events")
    .insert(raw)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      // Duplicate Tekmetric retry — partial unique index caught it. Caller
      // treats null as "already handled, skip downstream processing."
      return null;
    }
    throw new Error(`Log insert failed: ${error.message}`);
  }
  return data ? (data.id as string) : null;
}

async function markProcessed(
  eventId: string,
  result: string,
  detail: unknown,
  errorMessage?: string,
): Promise<void> {
  // We deliberately return HTTP 200 to Tekmetric on internal failures (so it
  // doesn't retry-storm) and record the failure here. But a DB row alone is a
  // silent failure operationally — also surface every error result in Sentry so
  // it's visible (observability.md rules 5/7/14). The function is wrapped in
  // withSentryScope at Deno.serve, so this lands in the per-request scope.
  if (result === "error") {
    Sentry.captureMessage(
      `keytag-tekmetric-webhook handled error: ${errorMessage ?? "unknown"}`,
      {
        level: "error",
        tags: { webhook: "keytag-tekmetric-webhook" },
        extra: { event_id: eventId, detail, error_message: errorMessage ?? null },
      },
    );
  }
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

// test seam — see index.test.ts
// Exported as a named function so tests can call it directly without
// going through Deno.serve. Production: Deno.serve(handler) wraps it below.
export async function handler(req: Request): Promise<Response> {
  // ── Auth via query param (Tekmetric doesn't support custom headers) ──
  const WEBHOOK_TOKEN = _readWebhookToken();
  if (!WEBHOOK_TOKEN) {
    console.error("TEKMETRIC_WEBHOOK_TOKEN not set on this function");
    return new Response(JSON.stringify({ error: "Misconfigured" }), { status: 500 });
  }
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("token");
  // PLAN-03 Phase 2A (I-SEC-1) — constant-time compare. See
  // tekmetric-webhook/index.ts for the rationale + threat-model note.
  if (!bearersEqual(tokenParam ?? "", WEBHOOK_TOKEN)) {
    // PLAN-02 Phase 2A (I-OBS-3) — capture token-mismatch as Sentry warning
    // with a stable fingerprint so attack patterns dedupe into a SINGLE
    // issue (count climbs instead of dozens of distinct issues). Alert
    // rule (configured manually in Sentry dashboard): `tags.event:
    // signature_fail AND count > 10 in 5 minutes` → security channel.
    Sentry.withScope((scope) => {
      scope.setLevel("warning");
      scope.setTag("event", "signature_fail");
      scope.setFingerprint([
        "webhook-sig-fail",
        "tekmetric",
        "/functions/v1/keytag-tekmetric-webhook",
      ]);
      scope.setContext("request", {
        ip: req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown",
        user_agent: req.headers.get("user-agent") ?? "unknown",
        url: req.url,
        method: req.method,
      });
      Sentry.captureMessage("Keytag-Tekmetric webhook signature failed", "warning");
    });
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
  // Tekmetric's repair-order objects include `updatedDate` (every webhook
  // payload reflects the post-change timestamp). Captured here so we can
  // push it into keytags.last_activity_at on every relevant event, keeping
  // the morning report's staleness clock fresh without waiting for the
  // nightly reconcile.
  let webhookUpdatedDate: string | null = null;
  // `postedDate` is only set on the sent_to_ar / posted events. Captured
  // separately so the A/R branch can write the REAL Tekmetric posted
  // timestamp into keytags.posted_at (driving staleness math correctly).
  let webhookPostedDate: string | null = null;

  if (
    eventKind === "ro_status_updated" ||
    eventKind === "ro_posted" ||
    eventKind === "ro_work_approved" ||
    eventKind === "ro_sent_to_ar"
  ) {
    roId = (data.id as number) ?? null;
    const status = data.repairOrderStatus as Record<string, unknown> | undefined;
    statusId = (status?.id as number) ?? null;
    webhookUpdatedDate = (data.updatedDate as string | undefined) ?? null;
    webhookPostedDate = (data.postedDate as string | undefined) ?? null;
  } else if (eventKind === "payment_made") {
    paymentId = (data.id as number) ?? null;
    roId = (data.repairOrderId as number) ?? null;
  }

  // Always log first so we have a full audit trail, including events we skip below.
  // logEvent returns null when the DB-level idempotency catches a Tekmetric
  // retry (event_hash matched an existing row). In that case, we've already
  // processed this logical event — skip downstream work and return 200.
  let eventId: string | null;
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
    Sentry.captureException(e, {
      tags: { webhook: "keytag-tekmetric-webhook", stage: "log_event" },
    });
    return new Response(JSON.stringify({ ok: false, logged: false }), { status: 200 });
  }

  if (eventId === null) {
    // Idempotency caught a Tekmetric retry — already processed.
    console.log(JSON.stringify({
      msg: "keytag-tekmetric-webhook: duplicate event ignored",
      event_kind: eventKind,
      ro_id: roId,
      payment_id: paymentId,
    }));
    return new Response(
      JSON.stringify({ ok: true, logged: true, duplicate: true, event_kind: eventKind }),
      { status: 200 },
    );
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

    // ── Branch 1: status_updated OR work_approved ────────────────────────
    // Both events can transition an RO to WIP. work_approved is the PRIMARY
    // trigger Chris configured 2026-05-11 — fires the moment an advisor
    // approves any job on an Estimate, deterministically flipping the RO
    // to WIP. status_updated is the BACKUP — catches any state change we
    // would otherwise miss (e.g. Tekmetric's webhook delivery occasionally
    // drops events; see RO 152354 investigation 2026-05-11).
    //
    // Both share identical processing: DB-first check (have we already
    // tagged this RO?), then defensive Tekmetric GET to confirm the RO is
    // actually in WIP (defends against stale webhook bodies after Tekmetric
    // retry delays — see RO 152274 retry 48-min-late example), then
    // assign + PATCH.
    if (
      eventKind === "ro_status_updated" ||
      eventKind === "ro_work_approved"
    ) {
      // Inferred-from-body regression check: if the webhook body says
      // statusId=2 (WIP) but our DB has the tag as posted_ar, the RO was
      // un-posted from A/R. Revert the tag's status before falling through
      // to the normal "already assigned" handling. Belt: cron also catches.
      // Estimate-side regressions (WIP → Estimate) keep the tag assigned —
      // the physical keys are still in the shop, so no DB change needed.
      // Step 1: do we already have a tag for this RO?
      const existing = await getAssignedKeytag(roId);
      if (existing !== null) {
        // Regression detection: tag is posted_ar but body says WIP. This
        // means the RO was un-posted from A/R back to WIP. Revert the tag
        // to assigned + clear posted_at so the daily report categorizes
        // it correctly (and the staleness clock resets to updatedDate
        // rather than the old posted_at).
        const bodyIsWip = statusId === TEKMETRIC_RO_STATUS.WIP;
        if (existing.status === "posted_ar" && bodyIsWip) {
          const { error: revertErr } = await sb.rpc(
            "revert_keytag_to_assigned",
            {
              p_ro_id: roId,
              p_last_activity_at: webhookUpdatedDate,
            },
          );
          if (revertErr) {
            await markProcessed(
              eventId,
              "error",
              { stage: "revert_to_assigned" },
              revertErr.message,
            );
            return new Response(
              JSON.stringify({ ok: false, error: revertErr.message }),
              { status: 200 },
            );
          }
          // Audit-log entry for the revert
          await sb.rpc("log_keytag_audit", {
            p_tag_color: existing.color,
            p_tag_number: existing.number,
            p_action: "reverted",
            p_source: "webhook",
            p_ro_id: roId,
            p_ro_number: (data.repairOrderNumber as number) ?? null,
            p_prior_status: "posted_ar",
            p_new_status: "assigned",
            p_user_label: null,
            p_reason: "webhook:ar_un_posted_back_to_wip",
          });
          await markProcessed(eventId, "reverted_to_assigned", {
            ro_id: roId,
            tag_color: existing.color,
            tag_number: existing.number,
            prior_status: existing.status,
            reason: "ar_un_posted_back_to_wip",
          });
          return new Response(
            JSON.stringify({
              ok: true,
              action: "reverted_to_assigned",
              tag_color: existing.color,
              tag_number: existing.number,
              ro_id: roId,
            }),
            { status: 200 },
          );
        }

        // Normal case — tag still applies; just refresh activity clock.
        if (webhookUpdatedDate) {
          await sb.rpc("touch_keytag_activity", {
            p_ro_id: roId,
            p_last_activity_at: webhookUpdatedDate,
          });
        }
        await markProcessed(eventId, "skipped_already_assigned", {
          ro_id: roId,
          tag_color: existing.color,
          tag_number: existing.number,
          tag_status: existing.status,
          body_status_id: statusId,
          touched_activity_at: webhookUpdatedDate,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            action: "skipped_already_assigned",
            tag_color: existing.color,
            tag_number: existing.number,
            ro_id: roId,
          }),
          { status: 200 },
        );
      }

      // ── DRIFT-PREVENTION GATE (added 2026-05-11) ────────────────────────
      // Self-heal was the root cause of physical/digital tag drift: when a
      // tag was manually released, the next webhook on that RO would
      // auto-assign a NEW tag — leaving the physical keys with the OLD tag
      // number while the system tracked a different one. Two new rules:
      //
      //   Rule A. `ro_status_updated` NEVER auto-assigns when there's no
      //   existing tag. status_updated fires for ANY field change on the
      //   RO (a key tag move, a note edit, etc.) and is not a reliable
      //   signal of "this RO needs a fresh tag." `ro_work_approved` is the
      //   ONLY primary trigger for fresh tag assignment.
      //
      //   Rule B. `ro_work_approved` only auto-assigns when the RO has
      //   NEVER had a keytag in our audit log. Once any keytag history
      //   exists for an RO (assigned, released, etc.), subsequent work
      //   approvals do NOT auto-assign — the advisor must explicitly
      //   re-tag via the orchestrator (assignKeytagToRo).
      //
      // First-time assignment for genuinely new ROs still works: an RO
      // that goes Estimate → WIP for the first time has no audit history,
      // work_approved fires, we assign + PATCH + audit-log. Subsequent
      // releases + reassignments require manual action.
      if (eventKind === "ro_status_updated") {
        await markProcessed(eventId, "skipped_status_updated_no_existing_tag", {
          ro_id: roId,
          reason: "status_updated_does_not_trigger_auto_assign",
          drift_prevention: true,
        });
        return new Response(
          JSON.stringify({ ok: true, action: "skipped_status_updated_no_existing_tag", ro_id: roId }),
          { status: 200 },
        );
      }

      // work_approved path — check audit log for prior history. If found,
      // do NOT auto-assign; instead, issue a manual-review code (DRF or REG)
      // so the service team can tell us what's physically on the keys.
      const roNumberForHistory = (data.repairOrderNumber as number) ?? null;
      // PLAN-03 Phase 3A (I-SEC-5) — PostgREST .or() takes a raw string
      // that's interpolated server-side. roId + roNumberForHistory come
      // from the Tekmetric webhook body — if Tekmetric ever ships a
      // typo'd payload (string instead of number) OR an attacker gets
      // the webhook token + crafts a malicious body, the interpolation
      // could end up shaped like `ro_id.eq.5);DROP--` and confuse the
      // PostgREST parser. Number.isInteger + Number.isSafeInteger reject
      // anything that isn't a finite 53-bit integer BEFORE interpolation.
      // If either fails, skip the lookup (treat as "no prior history")
      // rather than breaking the webhook. supabase-js validates .eq()/.in()
      // types but does NOT validate .or() raw strings — this guard is
      // the seatbelt.
      const roIdSafe = Number.isInteger(roId) && Number.isSafeInteger(roId);
      const roNumberSafe =
        Number.isInteger(roNumberForHistory) && Number.isSafeInteger(roNumberForHistory);
      if (roNumberForHistory !== null && (!roIdSafe || !roNumberSafe)) {
        // Surface as warning so we know Tekmetric sent a malformed payload
        // (or in the worst case, the webhook token leaked + attacker is
        // probing). The webhook still completes — skip-lookup is the
        // safe fallback (= "no prior history found", same as the existing
        // case for roNumberForHistory === null).
        Sentry.withScope((scope) => {
          scope.setTag("event", "invalid_ro_id_or_number");
          scope.setContext("invalid_ids", {
            ro_id_type: typeof roId,
            ro_id_safe: roIdSafe,
            ro_number_type: typeof roNumberForHistory,
            ro_number_safe: roNumberSafe,
            ro_id_first_chars: typeof roId === "string"
              ? (roId as string).slice(0, 20)
              : String(roId),
          });
          Sentry.captureMessage(
            "Tekmetric webhook body has invalid ro_id or ro_number type",
            "warning",
          );
        });
      }
      if (roNumberForHistory !== null && roIdSafe && roNumberSafe) {
        const { data: priorHistoryRows } = await sb
          .from("keytag_audit_log")
          .select("id, action, occurred_at, tag_color, tag_number, reason")
          .or(`ro_id.eq.${roId},ro_number.eq.${roNumberForHistory}`)
          .neq("action", "manual_review_issued")
          .order("occurred_at", { ascending: false })
          .limit(3);
        const priorHistory = priorHistoryRows?.[0];
        if (priorHistory) {
          // De-dup: if an unresolved DRF/REG already exists for this RO, skip
          const { data: existingReview } = await sb
            .from("keytag_manual_reviews")
            .select("code")
            .in("category", ["work_approved_drift", "ar_regression"])
            .is("resolved_at", null)
            .filter("context->>ro_id", "eq", String(roId))
            .limit(1)
            .maybeSingle();
          if (existingReview) {
            await markProcessed(eventId, "skipped_existing_manual_review_pending", {
              ro_id: roId,
              ro_number: roNumberForHistory,
              pending_code: existingReview.code,
            });
            return new Response(
              JSON.stringify({
                ok: true,
                action: "skipped_existing_manual_review_pending",
                code: existingReview.code,
              }),
              { status: 200 },
            );
          }
          // Distinguish REG (was-in-AR) from DRF (general drift)
          const wasInAR = (priorHistoryRows ?? []).some(
            (h) =>
              h.action === "marked_posted" ||
              (h.action === "released" && /ar_balance|posted_ar|ar_paid|payment_made/i.test(h.reason ?? "")),
          );
          const category =
            priorHistory.action === "released" && wasInAR
              ? "ar_regression"
              : "work_approved_drift";
          const priorTag = priorHistory.tag_color && priorHistory.tag_number
            ? `${priorHistory.tag_color === "red" ? "Red" : "Yellow"} ${priorHistory.tag_number}`
            : "the previous tag";
          const issued = await issueManualReview({
            sb,
            category,
            context: {
              ro_id: roId,
              ro_number: roNumberForHistory,
              tag_color: priorHistory.tag_color,
              tag_number: priorHistory.tag_number,
              prior_action: priorHistory.action,
              prior_action_at: priorHistory.occurred_at,
            },
            options: driftOptions(roNumberForHistory, priorTag),
            issueSummary:
              category === "ar_regression"
                ? `RO #${roNumberForHistory} came back from A/R into WIP, but ${priorTag} was already released earlier.`
                : `RO #${roNumberForHistory} is back in WIP but our records show it ${priorHistory.action} earlier (${priorTag}).`,
            auditSource: "webhook",
          });
          if (!issued.created) {
            // Universal dedup in issueManualReview short-circuited — a prior
            // review for this ro_id (any category, resolved or pending)
            // already exists. Mark the webhook event as a noop so the
            // tekmetric_webhook_events log shows we handled it.
            await markProcessed(eventId, "noop_existing_review", {
              ro_id: roId,
              ro_number: roNumberForHistory,
              existing_code: issued.code,
              existing_resolved_at: issued.existing_resolved_at,
            });
            return new Response(
              JSON.stringify({
                ok: true,
                action: "noop_existing_review",
                existing_code: issued.code,
                existing_resolved_at: issued.existing_resolved_at,
                ro_id: roId,
              }),
              { status: 200 },
            );
          }
          await markProcessed(eventId, "manual_review_issued", {
            ro_id: roId,
            ro_number: roNumberForHistory,
            category,
            code: issued.code,
            email_sent: issued.email_sent,
          });
          return new Response(
            JSON.stringify({
              ok: true,
              action: "manual_review_issued",
              category,
              code: issued.code,
              ro_id: roId,
            }),
            { status: 200 },
          );
        }
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

      // Step 3: round-robin assign + PATCH Tekmetric.
      // Pass the webhook's updatedDate (or fall back to the verified RO's
      // updatedDate) as last_activity_at so the morning report's staleness
      // clock starts at the real Tekmetric timestamp, not now().
      const roUpdated =
        (ro as { updatedDate?: string | null }).updatedDate ?? null;
      const lastActivity = webhookUpdatedDate ?? roUpdated;
      const { data: tagData, error: assignErr } = await sb.rpc("assign_next_keytag", {
        p_ro_id: roId,
        p_ro_number: ro.repairOrderNumber,
        p_customer_id: ro.customerId,
        p_vehicle_id: ro.vehicleId,
        p_advisor_id: ro.serviceWriterId,
        p_technician_id: ro.technicianId,
        p_last_activity_at: lastActivity,
      });
      if (assignErr) {
        await markProcessed(eventId, "error", { stage: "assign_rpc" }, assignErr.message);
        return new Response(JSON.stringify({ ok: false, error: assignErr.message }), { status: 200 });
      }
      // RPC returns a table; supabase-js gives an array. Empty array = pool exhausted.
      const assigned = Array.isArray(tagData) ? tagData[0] : tagData;
      if (!assigned || !assigned.tag_color) {
        await markProcessed(eventId, "error", { reason: "pool_exhausted" }, "All 180 key tags in use");
        return new Response(JSON.stringify({ ok: false, error: "pool exhausted" }), { status: 200 });
      }

      const tagColor = assigned.tag_color as "red" | "yellow";
      const tagNumber = assigned.tag_number as number;
      const wireValue = formatKeytag(tagColor, tagNumber);

      const patchResult = await patchKeytagToTekmetric(roId, wireValue);
      await sb.rpc("record_keytag_patched", {
        p_ro_id: roId,
        p_success: patchResult.ok,
        p_error: patchResult.error ?? null,
      });

      // Tekmetric PATCH failed: DB has the assignment but Tekmetric doesn't.
      // Surface as a PAF manual review so the service team can decide
      // whether to retry, release+redo, or accept the unsynced state.
      // The DB-side assignment is KEPT (no auto-rollback) so the team has
      // a complete picture when they resolve the code.
      if (!patchResult.ok) {
        const priorTag = `${tagColor === "red" ? "Red" : "Yellow"} ${tagNumber}`;
        const issued = await issueManualReview({
          sb,
          category: "tekmetric_patch_fail",
          context: {
            ro_id: roId,
            ro_number: ro.repairOrderNumber,
            tag_color: tagColor,
            tag_number: tagNumber,
            patch_error: patchResult.error,
          },
          options: patchFailOptions(),
          issueSummary: `We assigned ${priorTag} to RO #${ro.repairOrderNumber} but Tekmetric refused our write to its Key Tag field.`,
          auditSource: "webhook",
        });
        if (!issued.created) {
          // Prior review (any category) already exists for this ro_id.
          // The DB has the new assignment (we just inserted via assign_next_keytag)
          // and Tekmetric is out of sync — but we don't issue a NEW PAF since
          // an existing one covers this RO's anomaly history.
          await markProcessed(eventId, "assigned_patch_failed_existing_review", {
            tag_color: tagColor,
            tag_number: tagNumber,
            tag_string: wireValue,
            patch_error: patchResult.error,
            existing_code: issued.code,
            existing_resolved_at: issued.existing_resolved_at,
          });
          return new Response(
            JSON.stringify({
              ok: false,
              action: "assigned_patch_failed_existing_review",
              tag_color: tagColor,
              tag_number: tagNumber,
              patch_error: patchResult.error,
              ro_id: roId,
              existing_code: issued.code,
              existing_resolved_at: issued.existing_resolved_at,
            }),
            { status: 200 },
          );
        }
        await markProcessed(eventId, "assigned_patch_failed_review_issued", {
          tag_color: tagColor,
          tag_number: tagNumber,
          tag_string: wireValue,
          patch_error: patchResult.error,
          code: issued.code,
          email_sent: issued.email_sent,
        });
        return new Response(
          JSON.stringify({
            ok: false,
            action: "assigned_patch_failed_review_issued",
            tag_color: tagColor,
            tag_number: tagNumber,
            patch_error: patchResult.error,
            ro_id: roId,
            code: issued.code,
          }),
          { status: 200 },
        );
      }

      // Audit-log entry (closes the gap — webhook assignments are now logged too)
      await sb.rpc("log_keytag_audit", {
        p_tag_color: tagColor,
        p_tag_number: tagNumber,
        p_action: "assigned",
        p_source: "webhook",
        p_ro_id: roId,
        p_ro_number: ro.repairOrderNumber,
        p_prior_status: "available",
        p_new_status: "assigned",
        p_user_label: null,
        p_reason: `webhook:${eventKind}`,
        p_tekmetric_patch_ok: patchResult.ok,
        p_tekmetric_patch_error: patchResult.error ?? null,
      });

      // Capture the customer name on the keytag row (best-effort, OFF the PATCH
      // critical path — the keyTag is already written to Tekmetric above). One
      // /customers/{id} GET; null on any failure; keyed on ro_id. Never let it
      // fail the webhook — the nightly reconcile backfills any miss.
      const assignedCustomerName = await resolveCustomerName(sb, SHOP_ID, ro.customerId);
      if (assignedCustomerName !== null) {
        const { error: nameErr } = await sb
          .from("keytags")
          .update({ customer_name: assignedCustomerName })
          .eq("ro_id", roId);
        if (nameErr) {
          console.error(
            JSON.stringify({
              level: "warning",
              msg: "keytag_customer_name_update_failed",
              ro_id: roId,
              detail: nameErr.message,
            }),
          );
        }
      }

      await markProcessed(eventId, "assigned", {
        tag_color: tagColor,
        tag_number: tagNumber,
        tag_string: wireValue,
        patch_ok: true,
      });
      return new Response(
        JSON.stringify({
          ok: true,
          action: "assigned",
          tag_color: tagColor,
          tag_number: tagNumber,
          tag_string: wireValue,
          ro_id: roId,
        }),
        { status: 200 },
      );
    }

    // ── Branch 2a: sent_to_ar (PRIMARY A/R trigger — has real postedDate) ─
    // Chris's new Tekmetric subscription added 2026-05-11. Event_text:
    //   "Repair Order #<RO> sent to A/R by <email>"
    // Body carries the real postedDate field, so we can write the correct
    // A/R-transition timestamp to keytags.posted_at instead of now() — that
    // makes the staleness clock honest from day one.
    //
    // Edge case: webhook may fire when we have no tag for this RO (the
    // upstream work_approved + status_updated webhooks both missed). In
    // that case, assign a new tag (silently skipping the WIP intermediate
    // state) and immediately mark it posted_ar with the real postedDate.
    if (eventKind === "ro_sent_to_ar") {
      const existing = await getAssignedKeytag(roId);
      if (!existing) {
        // Tekmetric blocks PATCH on A/R ROs. If we got here without a prior
        // tag, the upstream work_approved + status_updated webhooks both
        // missed during the WIP window — and there's no way to write a new
        // R/Y keytag to Tekmetric now (the RO is A/R = inactive). Skip
        // entirely; the car/tag combination stays invisible to our system
        // until the customer pays and the RO leaves A/R. This preserves
        // the DB ↔ Tekmetric atomicity invariant.
        await markProcessed(eventId, "skipped_no_prior_tag_ar_locked", {
          ro_id: roId,
          posted_date: webhookPostedDate,
          reason: "upstream_webhooks_missed_and_tekmetric_blocks_ar_patch",
        });
        return new Response(
          JSON.stringify({
            ok: true,
            action: "skipped_no_prior_tag_ar_locked",
            ro_id: roId,
          }),
          { status: 200 },
        );
      }
      const tagColor = existing.color;
      const tagNumber = existing.number;

      // Mark posted_ar with the real Tekmetric postedDate
      const { data: postedRows, error: postErr } = await sb.rpc(
        "mark_keytag_posted",
        {
          p_ro_id: roId,
          p_posted_at: webhookPostedDate,
          p_last_activity_at: webhookPostedDate ?? webhookUpdatedDate,
        },
      );
      if (postErr) {
        await markProcessed(
          eventId,
          "error",
          { stage: "mark_posted_in_sent_to_ar" },
          postErr.message,
        );
        return new Response(
          JSON.stringify({ ok: false, error: postErr.message }),
          { status: 200 },
        );
      }
      const posted = Array.isArray(postedRows) ? postedRows[0] : postedRows;
      if (posted) {
        await sb.rpc("log_keytag_audit", {
          p_tag_color: posted.tag_color,
          p_tag_number: posted.tag_number,
          p_action: "marked_posted",
          p_source: "webhook",
          p_ro_id: roId,
          p_ro_number: (data.repairOrderNumber as number) ?? null,
          p_prior_status: "assigned",
          p_new_status: "posted_ar",
          p_user_label: null,
          p_reason: "webhook:sent_to_ar",
        });
      }
      await markProcessed(
        eventId,
        posted ? "posted_marked" : "noop",
        posted
          ? {
              tag_color: posted.tag_color,
              tag_number: posted.tag_number,
              posted_at: webhookPostedDate,
              reason: "sent_to_ar",
              backfilled_assignment: !existing,
            }
          : { reason: "sent_to_ar_no_tag_held_after_assign_attempt" },
      );
      return new Response(
        JSON.stringify({
          ok: true,
          action: posted ? "posted_marked" : "noop",
          tag_color: tagColor,
          tag_number: tagNumber,
          ro_id: roId,
        }),
        { status: 200 },
      );
    }

    // ── Branch 2b: ro_posted (status 5 = POSTED_PAID, 6 = POSTED_AR) ─────
    if (eventKind === "ro_posted") {
      if (statusId === TEKMETRIC_RO_STATUS.POSTED_PAID) {
        const { data: releasedRows, error: releaseErr } = await sb.rpc("release_keytag_for_ro", {
          p_ro_id: roId,
          p_reason: "posted_paid",
        });
        if (releaseErr) {
          // Don't mislabel a failed release as "no tag held" — record + surface it.
          await markProcessed(eventId, "error", { stage: "posted_paid_release" }, releaseErr.message);
          return new Response(JSON.stringify({ ok: false, error: releaseErr.message }), { status: 200 });
        }
        const released = Array.isArray(releasedRows) ? releasedRows[0] : releasedRows;
        if (released) {
          await sb.rpc("log_keytag_audit", {
            p_tag_color: released.tag_color,
            p_tag_number: released.tag_number,
            p_action: "released",
            p_source: "webhook",
            p_ro_id: roId,
            p_ro_number: (data.repairOrderNumber as number) ?? null,
            p_prior_status: null,
            p_new_status: "available",
            p_user_label: null,
            p_reason: "webhook:ro_posted_paid",
          });
        }
        await markProcessed(
          eventId,
          released ? "released" : "noop",
          released
            ? { tag_color: released.tag_color, tag_number: released.tag_number, reason: "posted_paid" }
            : { reason: "posted_paid_no_tag_held" },
        );
        // The RO terminally closed (posted-paid) — every open review for it is
        // now moot (keys left the shop), even if no tag was held. Best-effort.
        await autoResolveReviewsForRo(sb, roId, "ro_posted_paid", "webhook");
        return new Response(
          JSON.stringify({
            ok: true,
            action: released ? "released" : "noop",
            ...(released ? { tag_color: released.tag_color, tag_number: released.tag_number } : {}),
          }),
          { status: 200 },
        );
      }
      if (statusId === TEKMETRIC_RO_STATUS.POSTED_AR) {
        // Use the webhook's postedDate as the staleness clock anchor for
        // A/R tags. Falls back to updatedDate if the payload doesn't carry
        // postedDate. The mark_keytag_posted overload accepts both — both
        // NULL means the RPC defaults to now() (legacy single-arg behavior).
        const postedDate =
          (data.postedDate as string | undefined) ?? null;
        const { data: postedRows, error: postedErr } = await sb.rpc("mark_keytag_posted", {
          p_ro_id: roId,
          p_posted_at: postedDate,
          p_last_activity_at: postedDate ?? webhookUpdatedDate,
        });
        if (postedErr) {
          await markProcessed(eventId, "error", { stage: "posted_ar_mark_posted" }, postedErr.message);
          return new Response(JSON.stringify({ ok: false, error: postedErr.message }), { status: 200 });
        }
        const posted = Array.isArray(postedRows) ? postedRows[0] : postedRows;
        if (posted) {
          await sb.rpc("log_keytag_audit", {
            p_tag_color: posted.tag_color,
            p_tag_number: posted.tag_number,
            p_action: "marked_posted",
            p_source: "webhook",
            p_ro_id: roId,
            p_ro_number: (data.repairOrderNumber as number) ?? null,
            p_prior_status: "assigned",
            p_new_status: "posted_ar",
            p_user_label: null,
            p_reason: "webhook:ro_posted_ar_balance",
          });
        }
        await markProcessed(
          eventId,
          posted ? "posted_marked" : "noop",
          posted
            ? { tag_color: posted.tag_color, tag_number: posted.tag_number, reason: "posted_ar_balance_due" }
            : { reason: "posted_ar_no_tag_held" },
        );
        return new Response(
          JSON.stringify({
            ok: true,
            action: posted ? "posted_marked" : "noop",
            ...(posted ? { tag_color: posted.tag_color, tag_number: posted.tag_number } : {}),
          }),
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
    // The payment webhook payload itself doesn't say whether the payment
    // closed the balance — it just reports an individual transaction. A
    // partial A/R payment (e.g. customer pays deductible while an extended
    // warranty insurer still owes the rest) used to release the tag here,
    // leaving the physical keys in the shop disconnected from any tracked
    // tag. Per Chris 2026-05-17: GET the RO and only release when Tekmetric
    // has flipped its status to POSTED_PAID (5). Any other status → leave
    // the tag posted_ar; the nightly bulk-reconcile catches missed
    // releases via its reverse pass (ORP manual review).
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

      // Defensive: confirm the RO is actually POSTED_PAID before releasing.
      // Conservative on every failure mode — Tekmetric 404, network error,
      // missing status field — so we never release on a partial payment.
      let ro;
      try {
        ro = await getRepairOrderById(sb, SHOP_ID, roId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await markProcessed(
          eventId,
          "payment_skipped_ro_get_failed",
          { payment_id: paymentId, ro_id: roId },
          msg,
        );
        return new Response(
          JSON.stringify({ ok: true, action: "payment_skipped_ro_get_failed", ro_id: roId }),
          { status: 200 },
        );
      }
      if (!ro) {
        await markProcessed(eventId, "payment_skipped_ro_not_found", {
          payment_id: paymentId,
          ro_id: roId,
          reason: "tekmetric_returned_404_for_ro_in_payment_webhook",
        });
        return new Response(
          JSON.stringify({ ok: true, action: "payment_skipped_ro_not_found", ro_id: roId }),
          { status: 200 },
        );
      }

      const verifiedStatusId = ro.repairOrderStatus?.id;
      if (verifiedStatusId !== TEKMETRIC_RO_STATUS.POSTED_PAID) {
        await markProcessed(eventId, "payment_skipped_ro_still_in_ar", {
          payment_id: paymentId,
          ro_id: roId,
          ro_number: ro.repairOrderNumber,
          verified_status_id: verifiedStatusId,
          verified_status_name: ro.repairOrderStatus?.name,
          reason: "partial_payment_or_ar_balance_remaining",
        });
        return new Response(
          JSON.stringify({
            ok: true,
            action: "payment_skipped_ro_still_in_ar",
            ro_id: roId,
            verified_status_id: verifiedStatusId,
          }),
          { status: 200 },
        );
      }

      const { data: releasedRows, error: payReleaseErr } = await sb.rpc("release_keytag_for_ro", {
        p_ro_id: roId,
        p_reason: "payment_webhook",
      });
      if (payReleaseErr) {
        await markProcessed(eventId, "error", { stage: "payment_made_release" }, payReleaseErr.message);
        return new Response(JSON.stringify({ ok: false, error: payReleaseErr.message }), { status: 200 });
      }
      const released = Array.isArray(releasedRows) ? releasedRows[0] : releasedRows;
      if (released) {
        await sb.rpc("log_keytag_audit", {
          p_tag_color: released.tag_color,
          p_tag_number: released.tag_number,
          p_action: "released",
          p_source: "webhook",
          p_ro_id: roId,
          p_ro_number: ro.repairOrderNumber,
          p_prior_status: "posted_ar",
          p_new_status: "available",
          p_user_label: null,
          p_reason: "webhook:payment_made_ar_balance_paid",
        });
      }
      await markProcessed(
        eventId,
        released ? "released" : "noop",
        released
          ? { tag_color: released.tag_color, tag_number: released.tag_number, reason: "payment_webhook", payment_id: paymentId }
          : { reason: "payment_webhook_no_tag_held", payment_id: paymentId },
      );
      // A/R balance paid in full — the RO left A/R and closed, so every open
      // review for it is moot (keys gone). Best-effort.
      await autoResolveReviewsForRo(sb, roId, "payment_made", "webhook");
      return new Response(
        JSON.stringify({
          ok: true,
          action: released ? "released" : "noop",
          ...(released ? { tag_color: released.tag_color, tag_number: released.tag_number } : {}),
        }),
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
    // Capture the full exception (stack) in addition to the markProcessed row +
    // the captureMessage it emits — this is the unhandled-failure path.
    Sentry.captureException(e, {
      tags: { webhook: "keytag-tekmetric-webhook", stage: "unhandled" },
    });
    await markProcessed(eventId, "error", { stage: "unhandled" }, msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 200 });
  }
}

// Wrap each request in a per-request Sentry isolation scope (the Deno SDK does
// NOT isolate requests on a warm instance — breadcrumbs/tags would leak across
// tenants without this; observability.md rule 7). Mirrors keytag-daily-report /
// keytag-bulk-reconcile.
Deno.serve((req) => withSentryScope(req, "keytag-tekmetric-webhook", () => handler(req)));

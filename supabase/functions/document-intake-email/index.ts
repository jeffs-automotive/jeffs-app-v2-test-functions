// document-intake-email — Microsoft Graph mailbox intake (plan v2 D7/D8).
//
// THREE request shapes on one endpoint:
//
//   1. Subscription VALIDATION handshake — Graph POSTs (or GETs) with
//      ?validationToken=… and expects the token echoed as text/plain 200
//      within 10s. No auth possible; the echo leaks nothing.
//
//   2. Change/lifecycle NOTIFICATIONS — Graph POSTs {value:[…]} with no
//      auth header. Every item is bound to a STORED subscription row by
//      subscriptionId, then its clientState is verified against that row's
//      sha256 hash (constant-time; per-subscription random secret). Valid
//      items are stored as durable `pending` graph_mail_events (dedup on
//      (mailbox, immutable message id)) — THEN we 202. Processing is
//      best-effort via EdgeRuntime.waitUntil; the daily cron drain is the
//      guarantee (ACK-before-work is not durable — cross-verify blocker).
//      Invalid/unknown notifications: 401/202-drop with SAMPLED Sentry
//      (an internet rando must not be able to spray our alert channel).
//
//   3. CRON/BOOTSTRAP — {mode:"cron"|"bootstrap"} with Pattern A bearer
//      (pg_cron via scheduler_invoke_edge_function, or an operator).
//      Runs renew/sweep/drain/reconcile/watchdog (cron.ts), advisory-lock
//      serialized. bootstrap additionally force-creates subscriptions.
//
// verify_jwt=false in config.toml: Graph cannot send a Supabase JWT; auth
// is clientState + the Pattern A bearer for mode calls.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { bearersEqual, checkSchedulerBearer } from "../_shared/scheduler-auth.ts";
import { resolveSecretKey } from "../_shared/resolve-secret-key.ts";
import { GraphClient } from "./graph.ts";
import { processEvent, type EventRow } from "./process.ts";
import { runCron, sha256HexString } from "./cron.ts";

// test seams
let sb: SupabaseClient | null = null;
function getSb(): SupabaseClient {
  if (sb === null) {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SECRET_KEY = resolveSecretKey();
    if (!SECRET_KEY) throw new Error("document-intake-email: no Supabase secret key configured");
    sb = createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return sb;
}
export function _setSupabaseClientForTesting(client: unknown): void {
  sb = client as SupabaseClient;
}

let graphOverride: GraphClient | null = null;
export function _setGraphClientForTesting(client: unknown): void {
  graphOverride = client as GraphClient;
}
function getGraph(): GraphClient | null {
  if (graphOverride) return graphOverride;
  const tenantId = Deno.env.get("GRAPH_TENANT_ID") ?? "";
  const clientId = Deno.env.get("GRAPH_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GRAPH_CLIENT_SECRET") ?? "";
  if (!tenantId || !clientId || !clientSecret) return null;
  return new GraphClient({ tenantId, clientId, clientSecret });
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function log(msg: string, ctx: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", surface: "document-intake-email", msg, ...ctx }));
}

// Sampled Sentry for unauthenticated junk (cross-verify: alert-channel DoS).
let lastInvalidCaptureAt = 0;
const INVALID_CAPTURE_INTERVAL_MS = 5 * 60_000;
function captureInvalidSampled(msg: string): void {
  const now = Date.now();
  if (now - lastInvalidCaptureAt >= INVALID_CAPTURE_INTERVAL_MS) {
    lastInvalidCaptureAt = now;
    Sentry.captureMessage(msg, "warning");
  }
  console.warn(JSON.stringify({ level: "warn", surface: "document-intake-email", msg }));
}

interface GraphNotification {
  subscriptionId?: unknown;
  clientState?: unknown;
  lifecycleEvent?: unknown;
  resourceData?: { id?: unknown } | null;
}

const MAX_NOTIFICATION_BODY_BYTES = 256 * 1024;

export async function handler(req: Request): Promise<Response> {
  // D13 alert-rule contract: EVERY event from this surface (captureMessage,
  // wrapper auto-captures, explicit exceptions) must carry module=
  // document-intake — set once on the isolation scope (sentry-compliance
  // fix; the explicit per-capture tags remain as belt).
  try {
    Sentry.getIsolationScope().setTag("module", "document-intake");
  } catch {
    // Sentry unconfigured (tests/local) — tagging is best-effort.
  }

  // ── 1. Validation handshake ────────────────────────────────────────────
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken !== null) {
    log("validation handshake echoed");
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

  // Cheap junk gate before parsing (size cap).
  const raw = await req.text();
  if (raw.length > MAX_NOTIFICATION_BODY_BYTES) {
    captureInvalidSampled("document-intake-email: oversized request body rejected");
    return json(413, { ok: false, error: "too_large" });
  }
  let body: { mode?: unknown; value?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    captureInvalidSampled("document-intake-email: non-JSON request rejected");
    return json(400, { ok: false, error: "invalid_json" });
  }

  // ── 3. Cron / bootstrap mode (Pattern A bearer) ────────────────────────
  if (typeof body.mode === "string") {
    const auth = checkSchedulerBearer(req, "document-intake-email");
    if (!auth.ok) {
      // This URL is internet-facing (Graph posts here) — return a BARE 401.
      // The shared unauthorizedResponse would echo first-8-chars + lengths of
      // every valid bearer to unauthenticated probers (security-review);
      // checkSchedulerBearer already logged the diagnostic server-side.
      // But NOT silently: pg_cron's net.http_post is fire-and-forget, so a
      // rotated/wrong bearer would otherwise disable the entire daily cycle
      // (incl. the watchdog) with no alert (observability rule 5).
      captureInvalidSampled("document-intake-email: cron-mode auth failure — daily cycle NOT running");
      return json(401, { ok: false, error: "unauthorized" });
    }
    if (body.mode !== "cron" && body.mode !== "bootstrap") {
      return json(400, { ok: false, error: "unknown_mode" });
    }
    const graph = getGraph();
    if (!graph) {
      Sentry.captureMessage("document-intake-email: GRAPH_* secrets not configured", "error");
      return json(500, { ok: false, error: "graph_not_configured" });
    }
    const report = await runCron(getSb(), graph, body.mode === "bootstrap");
    return json(200, { ok: true, report: { ...report } });
  }

  // ── 2. Notification batch ──────────────────────────────────────────────
  const items = Array.isArray(body.value) ? (body.value as GraphNotification[]) : null;
  if (!items || items.length === 0) {
    captureInvalidSampled("document-intake-email: request without value[] or mode rejected");
    return json(400, { ok: false, error: "unrecognized_request" });
  }

  const client = getSb();
  const accepted: EventRow[] = [];
  let rejected = 0;

  for (const item of items.slice(0, 50)) {
    const subscriptionId = typeof item.subscriptionId === "string" ? item.subscriptionId : "";
    const clientState = typeof item.clientState === "string" ? item.clientState : "";
    if (!subscriptionId || !clientState) {
      rejected++;
      continue;
    }

    // Bind to a STORED subscription (cross-verify: clientState alone does not
    // establish which mailbox/tenant a notification belongs to).
    const { data: subRow, error: subErr } = await client
      .from("graph_mail_subscriptions")
      .select("mailbox, client_state_hash")
      .eq("subscription_id", subscriptionId)
      .maybeSingle();
    if (subErr) {
      Sentry.captureException(new Error(`subscription lookup failed: ${subErr.message}`), {
        tags: { module: "document-intake" },
      });
      return json(500, { ok: false, error: "lookup_failed" });
    }
    const sub = subRow as { mailbox: string; client_state_hash: string | null } | null;
    if (!sub?.client_state_hash) {
      rejected++;
      captureInvalidSampled("document-intake-email: notification for unknown subscription rejected");
      continue;
    }
    const submittedHash = await sha256HexString(clientState);
    if (!bearersEqual(submittedHash, sub.client_state_hash)) {
      rejected++;
      captureInvalidSampled("document-intake-email: clientState mismatch rejected");
      continue;
    }

    // Lifecycle events: record + alert; renewal happens on the next cron
    // (or an operator bootstrap). No message to store.
    if (typeof item.lifecycleEvent === "string" && item.lifecycleEvent.length > 0) {
      const { error: lcErr } = await client.from("graph_mail_subscriptions").update({
        lifecycle_state: item.lifecycleEvent,
        updated_at: new Date().toISOString(),
      }).eq("subscription_id", subscriptionId);
      if (lcErr) {
        Sentry.captureException(new Error(`lifecycle-state update failed: ${lcErr.message}`), {
          tags: { module: "document-intake" },
        });
      }
      // Identify by subscription id, not mailbox — the email would be
      // scrubbed to "[email]" anyway, making the alert non-actionable.
      Sentry.captureMessage(
        `document-intake: subscription lifecycle event ${item.lifecycleEvent} (subscription ${subscriptionId})`,
        "warning",
      );
      continue;
    }

    const messageId = typeof item.resourceData?.id === "string" ? item.resourceData.id : "";
    if (!messageId) {
      rejected++;
      continue;
    }

    // NEVER persist the plaintext clientState (pattern+security review —
    // it is a live forgery token; only its hash may exist at rest, on the
    // subscription row).
    const { clientState: _redacted, ...safeItem } = item as Record<string, unknown>;
    const { data: inserted, error: insErr } = await client.from("graph_mail_events").upsert({
      mailbox: sub.mailbox,
      graph_message_id: messageId,
      subscription_id: subscriptionId,
      status: "pending",
      raw_notification: safeItem,
    }, { onConflict: "mailbox,graph_message_id", ignoreDuplicates: true })
      .select("id, mailbox, graph_message_id, status, attempts")
      .maybeSingle();
    if (insErr) {
      // Can't durably store → tell Graph to retry the whole delivery.
      Sentry.captureException(new Error(`event store failed: ${insErr.message}`), {
        tags: { module: "document-intake" },
      });
      return json(500, { ok: false, error: "store_failed" });
    }
    if (inserted) accepted.push(inserted as EventRow);
  }

  log("notifications stored", { accepted: accepted.length, rejected, total: items.length });

  // Durable rows exist — ACK now, process best-effort after the response.
  // The daily drain picks up anything this misses (killed isolate etc.).
  const graph = getGraph();
  if (graph && accepted.length > 0) {
    const work = (async () => {
      try {
        for (const ev of accepted) {
          await processEvent(client, graph, ev);
        }
      } catch (e) {
        Sentry.captureException(e, { tags: { module: "document-intake" } });
      } finally {
        // withSentryScope's flush ran when the 202 returned; events captured
        // in THIS background continuation would be dropped at isolate
        // shutdown without their own flush (sentry-compliance).
        await Sentry.flush(1000);
      }
    })();
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
      .EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work);
  }

  return json(202, { ok: true, accepted: accepted.length, rejected });
}

Deno.serve((req) => withSentryScope(req, "document-intake-email", () => handler(req)));

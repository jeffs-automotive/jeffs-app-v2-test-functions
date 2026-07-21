// document-intake-email — daily cron: renew / sweep / drain / reconcile /
// watchdog (plan D8 + D13). Each step is failure-isolated: one step's error
// is captured + reported, the rest still run. The whole cycle is serialized
// by a LEASE-ROW claim (fix B1 — session advisory locks cannot serialize
// pooled PostgREST rpc() calls; the lease is one atomic UPDATE with a TTL,
// crash-safe by expiry).
//
// Fix round 1 (verify 2026-07-21): every Supabase call checks `error`
// (observability rule 9 — a failing watchdog query is itself a flag, never
// an implicit all-clear); the drain reclaims stale `processing` rows (a
// killed isolate can no longer strand an event); reconcile paginates past
// PostgREST's max_rows cap and never guesses a tenant; a skipped run and a
// failed lease release are Sentry events, not console whispers.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Sentry } from "../_shared/sentry-edge.ts";
import { GraphClient } from "./graph.ts";
import { BUCKET, processEvent, type EventRow } from "./process.ts";

const SWEEP_WINDOW_DAYS = 7;
// ≤ 2.5 days: valid under the documented 10,080-min mail cap AND the stricter
// 4,230-min figure one cross-verify reviewer asserted (plan D8 — neutralized).
const RENEWAL_MINUTES = 60 * 60; // 2.5 days
const LEASE_TTL_MINUTES = 45;
const PROCESSING_STALE_MINUTES = 60;
const HEARTBEAT_STALE_HOURS = 2;
const INTAKE_STALE_DAYS = Number(Deno.env.get("INTAKE_STALE_DAYS") ?? "4");

function log(msg: string, ctx: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", surface: "document-intake-email", msg, ...ctx }));
}

function watchdogAlert(msg: string): void {
  console.warn(JSON.stringify({ level: "warn", surface: "document-intake-email", msg }));
  Sentry.captureMessage(`document-intake watchdog: ${msg}`, "warning");
}

export interface CronReport {
  locked: boolean;
  renewed: number;
  recreated: number;
  swept_new: number;
  reclaimed_processing: number;
  drained: number;
  reconciled_orphans: number;
  watchdog_flags: string[];
  step_errors: string[];
}

export function newClientState(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

export async function sha256HexString(s: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s) as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function notificationUrls(): { notificationUrl: string; lifecycleNotificationUrl: string } {
  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/document-intake-email`;
  return { notificationUrl: base, lifecycleNotificationUrl: base };
}

/** Create-or-renew both mailbox subscriptions. Returns [renewed, recreated]. */
export async function renewSubscriptions(
  sb: SupabaseClient,
  graph: GraphClient,
  bootstrap = false,
): Promise<[number, number]> {
  let renewed = 0;
  let recreated = 0;
  const expiration = new Date(Date.now() + RENEWAL_MINUTES * 60_000).toISOString();
  const urls = notificationUrls();

  // Tenant rides with the mailbox config (fix S1) — never guessed later.
  const { data: mailboxes, error: mbErr } = await sb
    .from("document_intake_mailboxes")
    .select("address, profile_key, document_intake_profiles(shop_id)");
  if (mbErr) throw new Error(`mailboxes query failed: ${mbErr.message}`);

  // Cast via unknown: without generated DB types the client infers the
  // to-one join as an array; the runtime shape for this FK is an object.
  for (const mb of (mailboxes ?? []) as unknown as Array<{
    address: string;
    document_intake_profiles: { shop_id: number } | null;
  }>) {
    const mailbox = mb.address.toLowerCase();
    const shopId = mb.document_intake_profiles?.shop_id ?? null;
    const { data: subRow, error: subErr } = await sb
      .from("graph_mail_subscriptions")
      .select("id, subscription_id, expires_at, lifecycle_state")
      .eq("mailbox", mailbox)
      .maybeSingle();
    if (subErr) throw new Error(`subscription row query failed: ${subErr.message}`);
    const existing = subRow as
      | { id: string; subscription_id: string | null; expires_at: string | null; lifecycle_state: string | null }
      | null;

    const needsCreate = bootstrap ||
      !existing?.subscription_id ||
      existing.lifecycle_state === "subscriptionRemoved" ||
      (existing.expires_at !== null && new Date(existing.expires_at).getTime() < Date.now());

    if (!needsCreate && existing?.subscription_id) {
      try {
        const sub = await graph.renewSubscription(existing.subscription_id, expiration);
        const { error } = await sb.from("graph_mail_subscriptions").update({
          shop_id: shopId,
          expires_at: sub.expirationDateTime,
          last_renewed_at: new Date().toISOString(),
          lifecycle_state: null,
          updated_at: new Date().toISOString(),
        }).eq("mailbox", mailbox);
        if (error) throw new Error(`renewal persist failed: ${error.message}`);
        renewed++;
        continue;
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        if (status !== 404) throw e;
        // Graph lost it — fall through to recreate.
      }
    }

    // (Re)create: fresh per-subscription clientState, hash stored (plan D7).
    if (existing?.subscription_id) {
      try {
        await graph.deleteSubscription(existing.subscription_id);
      } catch (e) {
        // Best effort, but VISIBLE: an orphan Graph sub keeps a stale
        // clientState that every delivery will fail against (rejected).
        Sentry.captureMessage(
          `document-intake: could not delete old Graph subscription (${existing.subscription_id}): ${
            e instanceof Error ? e.message : String(e)
          }`,
          "warning",
        );
      }
    }
    const clientState = newClientState();
    const sub = await graph.createSubscription({
      mailbox,
      notificationUrl: urls.notificationUrl,
      lifecycleNotificationUrl: urls.lifecycleNotificationUrl,
      clientState,
      expirationDateTime: expiration,
    });
    const { error: upErr } = await sb.from("graph_mail_subscriptions").upsert({
      mailbox,
      shop_id: shopId,
      subscription_id: sub.id,
      client_state_hash: await sha256HexString(clientState),
      expires_at: sub.expirationDateTime,
      last_renewed_at: new Date().toISOString(),
      lifecycle_state: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "mailbox" });
    if (upErr) throw new Error(`subscription row upsert failed: ${upErr.message}`);
    recreated++;
  }
  return [renewed, recreated];
}

/** Rolling-window sweep, Inbox AND Junk (EOP false positives — plan D8). */
export async function sweepMailboxes(sb: SupabaseClient, graph: GraphClient): Promise<number> {
  const sinceIso = new Date(Date.now() - SWEEP_WINDOW_DAYS * 86_400_000).toISOString();
  let discovered = 0;

  const { data: mailboxes, error } = await sb.from("document_intake_mailboxes").select("address");
  if (error) throw new Error(`mailboxes query failed: ${error.message}`);

  for (const mb of (mailboxes ?? []) as Array<{ address: string }>) {
    const mailbox = mb.address.toLowerCase();
    for (const folder of ["inbox", "junkemail"] as const) {
      const messages = await graph.listMessagesSince(mailbox, folder, sinceIso);
      for (const m of messages) {
        const { data: inserted, error: insErr } = await sb.from("graph_mail_events").upsert({
          mailbox,
          graph_message_id: m.id,
          internet_message_id: m.internetMessageId,
          from_address: m.from,
          subject: m.subject,
          received_datetime: m.receivedDateTime,
          status: "pending",
        }, { onConflict: "mailbox,graph_message_id", ignoreDuplicates: true })
          .select("id")
          .maybeSingle();
        if (insErr) throw new Error(`sweep event upsert failed: ${insErr.message}`);
        if (inserted) discovered++;
      }
    }
    const { error: sweepErr } = await sb.from("graph_mail_subscriptions")
      .update({ last_sweep_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("mailbox", mailbox);
    if (sweepErr) throw new Error(`last_sweep_at update failed: ${sweepErr.message}`);
  }
  return discovered;
}

/**
 * Reclaim rows stranded in `processing` by a killed isolate (fix B2) —
 * back to `retryable` so the drain below picks them up. Returns count.
 */
export async function reclaimStaleProcessing(sb: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - PROCESSING_STALE_MINUTES * 60_000).toISOString();
  const { data, error } = await sb
    .from("graph_mail_events")
    .update({ status: "retryable", next_retry_at: null, updated_at: new Date().toISOString() })
    .eq("status", "processing")
    .lt("updated_at", cutoff)
    .select("id");
  if (error) throw new Error(`stale-processing reclaim failed: ${error.message}`);
  const n = (data ?? []).length;
  if (n > 0) {
    Sentry.captureMessage(`document-intake: reclaimed ${n} stale processing event(s)`, "warning");
  }
  return n;
}

/** Drain every pending/retryable(due) event. */
export async function drainEvents(sb: SupabaseClient, graph: GraphClient): Promise<number> {
  const { data, error } = await sb
    .from("graph_mail_events")
    .select("id, mailbox, graph_message_id, status, attempts, next_retry_at")
    .in("status", ["pending", "retryable"])
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`drain query failed: ${error.message}`);
  let processed = 0;
  const now = Date.now();
  for (const row of (data ?? []) as Array<EventRow & { next_retry_at?: string | null }>) {
    if (row.status === "retryable" && row.next_retry_at &&
      new Date(row.next_retry_at).getTime() > now) continue;
    const result = await processEvent(sb, graph, row);
    if (result !== "unclaimed") processed++;
  }
  return processed;
}

/** storage.objects <-> document_intake_files diff; register orphans (plan D3).
 *  The diff runs entirely in SQL via a SECURITY DEFINER RPC (deploy-fix F2:
 *  the storage schema is NOT exposed through the Data API on this project,
 *  so sb.schema("storage") 400s — found by the live §1e bootstrap). One
 *  RPC call ≤ max_rows orphans per run; normally ~0, watchdog reports the
 *  count, a larger backlog drains across daily runs. */
export async function reconcileStorage(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.rpc("document_intake_orphan_objects", { p_bucket: BUCKET });
  if (error) throw new Error(`orphan diff rpc failed: ${error.message}`);
  const objects = (data ?? []) as Array<{ name: string; mimetype: string | null; size_bytes: number | null }>;

  let orphans = 0;
  for (const obj of objects) {
    const tokens = obj.name.split("/");
    const shopId = Number(tokens[0]);
    if (!Number.isFinite(shopId) || shopId <= 0) {
      // NEVER guess a tenant (fix S1/shop-agnostic): park in the error log,
      // surfaced by the watchdog's error-log flag below.
      const { error } = await sb.from("document_intake_error_log").insert({
        origin: "reconcile",
        origin_id: obj.name,
        message: "orphan object with unparseable shop segment — not registered",
      });
      if (error) throw new Error(`orphan error-log insert failed: ${error.message}`);
      orphans++;
      continue;
    }
    const { data: profile, error: pErr } = await sb
      .from("document_intake_profiles")
      .select("key")
      .eq("key", tokens[1] ?? "")
      .maybeSingle();
    if (pErr) throw new Error(`orphan profile lookup failed: ${pErr.message}`);
    const { error: insErr } = await sb.from("document_intake_files").upsert({
      shop_id: shopId,
      profile_key: (profile as { key: string } | null)?.key ?? null,
      source: ["scan", "email"].includes(tokens[2] ?? "") ? tokens[2] : "other",
      bucket: BUCKET,
      object_path: obj.name,
      mime_type: obj.mimetype,
      size_bytes: obj.size_bytes,
      status: "pending",
    }, { onConflict: "object_path", ignoreDuplicates: true });
    if (insErr) throw new Error(`orphan registration failed: ${insErr.message}`);
    orphans++;
  }
  if (orphans > 0) {
    watchdogAlert(`${orphans} storage object(s) had no intake row (registered/parked)`);
  }
  return orphans;
}

/** D13 silent-stall detection. A FAILING check is itself a flag — the
 *  watchdog must never report all-clear because its own query broke. */
export async function runWatchdog(sb: SupabaseClient): Promise<string[]> {
  const flags: string[] = [];
  const now = Date.now();

  const check = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      flags.push(`watchdog check '${label}' itself failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await check("agent_heartbeat", async () => {
    const { data, error } = await sb
      .from("document_intake_agent_state")
      .select("hostname, last_heartbeat_at");
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as Array<{ hostname: string; last_heartbeat_at: string | null }>) {
      const age = a.last_heartbeat_at ? now - new Date(a.last_heartbeat_at).getTime() : Infinity;
      if (age > HEARTBEAT_STALE_HOURS * 3_600_000) {
        flags.push(`agent ${a.hostname} heartbeat stale (> ${HEARTBEAT_STALE_HOURS}h)`);
      }
    }
  });

  await check("subscription_expiry", async () => {
    const { data, error } = await sb
      .from("graph_mail_subscriptions")
      .select("mailbox, expires_at");
    if (error) throw new Error(error.message);
    for (const s of (data ?? []) as Array<{ mailbox: string; expires_at: string | null }>) {
      if (!s.expires_at || new Date(s.expires_at).getTime() < now + 12 * 3_600_000) {
        flags.push(`subscription for ${s.mailbox} missing or expiring within 12h`);
      }
    }
  });

  await check("intake_staleness", async () => {
    const { data, error } = await sb
      .from("document_intake_files")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const lastReceived = (data as { received_at?: string } | null)?.received_at;
    if (lastReceived && now - new Date(lastReceived).getTime() > INTAKE_STALE_DAYS * 86_400_000) {
      flags.push(`no documents received in > ${INTAKE_STALE_DAYS} days`);
    }
  });

  await check("event_backlog", async () => {
    // processing included (fix B2): a stuck claim is backlog, not progress.
    const { count, error } = await sb
      .from("graph_mail_events")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "retryable", "processing"])
      .lt("created_at", new Date(now - 86_400_000).toISOString());
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) flags.push(`${count} mail event(s) stuck > 24h`);
  });

  await check("error_log", async () => {
    const { count, error } = await sb
      .from("document_intake_error_log")
      .select("id", { count: "exact", head: true })
      .gt("occurred_at", new Date(now - 86_400_000).toISOString());
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) flags.push(`${count} error-log row(s) in the last 24h`);
  });

  for (const f of flags) watchdogAlert(f);
  return flags;
}

/** The full daily cycle (bootstrap = also force-create subscriptions). */
export async function runCron(
  sb: SupabaseClient,
  graph: GraphClient,
  bootstrap: boolean,
): Promise<CronReport> {
  const report: CronReport = {
    locked: false, renewed: 0, recreated: 0, swept_new: 0,
    reclaimed_processing: 0, drained: 0, reconciled_orphans: 0,
    watchdog_flags: [], step_errors: [],
  };
  const runId = crypto.randomUUID();

  const { data: claimed, error: leaseErr } = await sb.rpc("document_intake_claim_cron_lease", {
    p_run_id: runId,
    p_ttl_minutes: LEASE_TTL_MINUTES,
  });
  if (leaseErr) throw new Error(`cron lease rpc failed: ${leaseErr.message}`);
  if (claimed !== true) {
    // A second skipped run in a row would mean a wedged lease — loud, not a whisper.
    Sentry.captureMessage("document-intake: cron run skipped — lease held by another run", "warning");
    log("cron lease held elsewhere — exiting", {});
    return report;
  }
  report.locked = true;

  try {
    const steps: Array<[string, () => Promise<void>]> = [
      ["renew", async () => {
        [report.renewed, report.recreated] = await renewSubscriptions(sb, graph, bootstrap);
      }],
      ["sweep", async () => {
        report.swept_new = await sweepMailboxes(sb, graph);
      }],
      ["reclaim", async () => {
        report.reclaimed_processing = await reclaimStaleProcessing(sb);
      }],
      ["drain", async () => {
        report.drained = await drainEvents(sb, graph);
      }],
      ["reconcile", async () => {
        report.reconciled_orphans = await reconcileStorage(sb);
      }],
      ["watchdog", async () => {
        report.watchdog_flags = await runWatchdog(sb);
      }],
    ];
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (e) {
        const msg = `${name}: ${e instanceof Error ? e.message : String(e)}`;
        report.step_errors.push(msg);
        Sentry.captureException(e, { tags: { module: "document-intake", cron_step: name } });
      }
    }
  } finally {
    const { data: released, error: relErr } = await sb.rpc("document_intake_release_cron_lease", {
      p_run_id: runId,
    });
    if (relErr || released !== true) {
      // TTL will clear it, but a failed release is a real signal.
      Sentry.captureMessage(
        `document-intake: cron lease release failed (${relErr?.message ?? "no row matched"}) — TTL will expire it`,
        "warning",
      );
    }
  }
  log("cron cycle done", { ...report });
  return report;
}

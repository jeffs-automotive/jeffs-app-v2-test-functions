// document-intake-email — daily cron: renew / sweep / drain / reconcile /
// watchdog (plan D8 + D13). Each step is failure-isolated: one step's error
// is captured + reported, the rest still run. The whole cycle is serialized
// by the document_intake_try_cron_lock advisory lock (companion migration).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Sentry } from "../_shared/sentry-edge.ts";
import { GraphClient } from "./graph.ts";
import { BUCKET, processEvent, type EventRow } from "./process.ts";

const SWEEP_WINDOW_DAYS = 7;
// ≤ 2.5 days: valid under the documented 10,080-min mail cap AND the stricter
// 4,230-min figure one cross-verify reviewer asserted (plan D8 — neutralized).
const RENEWAL_MINUTES = 60 * 60; // 2.5 days
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

  const { data: mailboxes, error: mbErr } = await sb
    .from("document_intake_mailboxes")
    .select("address");
  if (mbErr) throw new Error(`mailboxes query failed: ${mbErr.message}`);

  for (const mb of (mailboxes ?? []) as Array<{ address: string }>) {
    const mailbox = mb.address.toLowerCase();
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
        await sb.from("graph_mail_subscriptions").update({
          expires_at: sub.expirationDateTime,
          last_renewed_at: new Date().toISOString(),
          lifecycle_state: null,
          updated_at: new Date().toISOString(),
        }).eq("mailbox", mailbox);
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
      } catch {
        // best effort — an orphan Graph sub with a stale clientState is rejected on delivery
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
    await sb.from("graph_mail_subscriptions")
      .update({ last_sweep_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("mailbox", mailbox);
  }
  return discovered;
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

/** storage.objects <-> document_intake_files diff; register orphans (plan D3). */
export async function reconcileStorage(sb: SupabaseClient): Promise<number> {
  const { data: objects, error: oErr } = await sb
    .schema("storage")
    .from("objects")
    .select("name, metadata")
    .eq("bucket_id", BUCKET)
    .limit(10000);
  if (oErr) throw new Error(`storage.objects query failed: ${oErr.message}`);

  const { data: files, error: fErr } = await sb
    .from("document_intake_files")
    .select("object_path")
    .limit(10000);
  if (fErr) throw new Error(`files query failed: ${fErr.message}`);

  const known = new Set(((files ?? []) as Array<{ object_path: string }>).map((f) => f.object_path));
  let orphans = 0;
  for (const obj of (objects ?? []) as Array<{ name: string; metadata: Record<string, unknown> | null }>) {
    if (known.has(obj.name)) continue;
    orphans++;
    const tokens = obj.name.split("/");
    const shopId = Number(tokens[0]);
    const { data: profile } = await sb
      .from("document_intake_profiles")
      .select("key")
      .eq("key", tokens[1] ?? "")
      .maybeSingle();
    const { error: insErr } = await sb.from("document_intake_files").upsert({
      shop_id: Number.isFinite(shopId) && shopId > 0
        ? shopId
        : Number(Deno.env.get("INTAKE_SHOP_ID") ?? "7476"),
      profile_key: (profile as { key: string } | null)?.key ?? null,
      source: ["scan", "email"].includes(tokens[2] ?? "") ? tokens[2] : "other",
      bucket: BUCKET,
      object_path: obj.name,
      mime_type: (obj.metadata?.mimetype as string | undefined) ?? null,
      size_bytes: obj.metadata?.size !== undefined ? Number(obj.metadata.size) : null,
      status: "pending",
    }, { onConflict: "object_path", ignoreDuplicates: true });
    if (insErr) throw new Error(`orphan registration failed: ${insErr.message}`);
  }
  if (orphans > 0) {
    watchdogAlert(`${orphans} storage object(s) had no intake row (registered as pending)`);
  }
  return orphans;
}

/** D13 silent-stall detection. Returns human-readable flags (each already Sentry'd). */
export async function runWatchdog(sb: SupabaseClient): Promise<string[]> {
  const flags: string[] = [];
  const now = Date.now();

  const { data: agents } = await sb
    .from("document_intake_agent_state")
    .select("hostname, last_heartbeat_at");
  for (const a of (agents ?? []) as Array<{ hostname: string; last_heartbeat_at: string | null }>) {
    const age = a.last_heartbeat_at ? now - new Date(a.last_heartbeat_at).getTime() : Infinity;
    if (age > HEARTBEAT_STALE_HOURS * 3_600_000) {
      flags.push(`agent ${a.hostname} heartbeat stale (> ${HEARTBEAT_STALE_HOURS}h)`);
    }
  }

  const { data: subs } = await sb
    .from("graph_mail_subscriptions")
    .select("mailbox, expires_at");
  for (const s of (subs ?? []) as Array<{ mailbox: string; expires_at: string | null }>) {
    if (!s.expires_at || new Date(s.expires_at).getTime() < now + 12 * 3_600_000) {
      flags.push(`subscription for ${s.mailbox} missing or expiring within 12h`);
    }
  }

  const { data: lastFile } = await sb
    .from("document_intake_files")
    .select("received_at")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastReceived = (lastFile as { received_at?: string } | null)?.received_at;
  if (lastReceived && now - new Date(lastReceived).getTime() > INTAKE_STALE_DAYS * 86_400_000) {
    flags.push(`no documents received in > ${INTAKE_STALE_DAYS} days`);
  }

  const { count: backlog } = await sb
    .from("graph_mail_events")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "retryable"])
    .lt("created_at", new Date(now - 86_400_000).toISOString());
  if ((backlog ?? 0) > 0) {
    flags.push(`${backlog} mail event(s) stuck > 24h`);
  }

  const { count: recentErrors } = await sb
    .from("document_intake_error_log")
    .select("id", { count: "exact", head: true })
    .gt("occurred_at", new Date(now - 86_400_000).toISOString());
  if ((recentErrors ?? 0) > 0) {
    flags.push(`${recentErrors} error-log row(s) in the last 24h`);
  }

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
    drained: 0, reconciled_orphans: 0, watchdog_flags: [], step_errors: [],
  };

  const { data: gotLock, error: lockErr } = await sb.rpc("document_intake_try_cron_lock");
  if (lockErr) throw new Error(`cron lock rpc failed: ${lockErr.message}`);
  if (gotLock !== true) {
    log("cron already running elsewhere — exiting", {});
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
    await sb.rpc("document_intake_release_cron_lock");
  }
  log("cron cycle done", { ...report });
  return report;
}

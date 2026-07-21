// scan-agent entrypoint — wires config → ledger replay → watcher → pipeline
// → heartbeat/purge tickers. Runs as a Windows Service (service/install-
// service.mjs): boots with the PC, needs nobody logged in (plan D6).

import path from "node:path";
import * as Sentry from "@sentry/node";
import { loadConfig, layout, ensureDirs, fetchGatewayConfig } from "./config.mjs";
import { createLedger } from "./ledger.mjs";
import { startWatching } from "./watcher.mjs";
import {
  claimFile, createGateway, hasFreeSpace, processJob, purgeUploaded, waitForStable,
} from "./pipeline.mjs";

const log = (msg, ctx = {}) =>
  console.log(JSON.stringify({ level: "info", surface: "scan-agent", msg, ...ctx }));
const warn = (msg, ctx = {}) =>
  console.warn(JSON.stringify({ level: "warn", surface: "scan-agent", msg, ...ctx }));

// PII scrubber (sentry-compliance): the edge fns ride sentry-edge.ts's
// beforeSend, but scan-agent events go out on its OWN DSN — raw fs error
// messages embed C:\Scans\{profile}\{original filename} (filename = PII per
// plan D2). Node twin of the shared scrubString: emails, +1-phones, and any
// path component after a Scans/work/archive dir become placeholders.
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_E164_RE = /\+1\d{6}(\d{4})/g;
// Filename = everything after the last separator, lazily through the file
// extension (scan filenames routinely contain spaces — "jane doe 4411.pdf"
// must redact WHOLE, caught by the test suite); extensionless fallback stops
// at whitespace.
const SCAN_PATH_FILE_RE =
  /([\\/](?:Scans|ScanAgent)[\\/][^\s"']*[\\/])(?:[^"'\\/\n]+?\.[A-Za-z0-9]{2,5}|[^\s"'\\/]+)/g;
export function scrubString(s) {
  if (typeof s !== "string" || s.length === 0) return s;
  return s
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_E164_RE, "+1******$1")
    .replace(SCAN_PATH_FILE_RE, "$1[file]");
}
function scrubEvent(event) {
  try {
    if (typeof event.message === "string") event.message = scrubString(event.message);
    for (const ex of event.exception?.values ?? []) {
      if (typeof ex.value === "string") ex.value = scrubString(ex.value);
    }
    for (const b of event.breadcrumbs ?? []) {
      if (typeof b.message === "string") b.message = scrubString(b.message);
    }
    return event;
  } catch {
    return null; // scrubbing failed — drop rather than leak
  }
}

export async function main() {
  const cfg = loadConfig();
  const dirs = layout(cfg);

  // DSN is required (loadConfig throws without it) — sentry is always live
  // in production. Init happens here rather than a --import preload module:
  // this agent only uses manual captures, so pre-init auto-instrumentation
  // has nothing to catch (intentional deviation from the ESM preload docs).
  const sentry = Sentry;
  Sentry.init({
    dsn: cfg.sentryDsn,
    release: `jeffs-scan-agent@${cfg.agentVersion}`,
    environment: "production",
    initialScope: { tags: { surface: "scan-agent", module: "document-intake", host: cfg.hostname } },
    beforeSend: scrubEvent,
  });

  const gwConfig = await fetchGatewayConfig(cfg);
  const profileKeys = gwConfig.profiles.map((p) => p.key);
  if (gwConfig.stale) warn("gateway config is a stale cache", { reason: gwConfig.staleReason });
  ensureDirs(cfg, profileKeys);

  const ledger = createLedger(dirs.ledgerPath);
  ledger.replay();
  const kept = ledger.compact(cfg.retentionDays);
  log("ledger replayed", { activeJobs: ledger.active().length, keptRecords: kept });

  const gateway = createGateway(cfg);
  const inFlight = new Set();

  async function runJob(job) {
    if (inFlight.has(job.id)) return;
    inFlight.add(job.id);
    try {
      const result = await processJob(job, { ledger, gateway, layoutDirs: dirs, sentry });
      log("job pass finished", { id: job.id, result });
    } finally {
      inFlight.delete(job.id);
    }
  }

  async function onCandidate(filePath, profileKey) {
    try {
      if (!(await hasFreeSpace(cfg.workRoot, cfg.minFreeBytes))) {
        warn("free-space floor reached — intake paused", { minFreeBytes: cfg.minFreeBytes });
        sentry?.captureMessage?.("scan-agent: disk free-space floor reached, intake paused", "error");
        return;
      }
      const stable = await waitForStable(filePath, { stabilityMs: cfg.stabilityMs });
      if (!stable.ok) {
        if (stable.reason !== "vanished") warn("file never stabilized", { filePath, reason: stable.reason });
        return;
      }
      const claim = await claimFile(filePath, dirs.workDir, profileKey);
      if (!claim) return; // raced — someone else claimed it
      const job = ledger.append({
        id: claim.id,
        state: "claimed",
        stagedPath: claim.stagedPath,
        originalName: claim.originalName,
        profileKey,
        attempts: 0,
      });
      log("file claimed", { id: claim.id, originalName: claim.originalName, profileKey });
      await runJob(job);
    } catch (e) {
      warn("candidate handling failed", { filePath, error: e instanceof Error ? e.message : String(e) });
      sentry?.captureException?.(e);
    }
  }

  // Resume anything the last run left unfinished.
  for (const job of ledger.active()) {
    void runJob(job);
  }

  const watcher = startWatching({
    scansRoot: cfg.scansRoot,
    profileKeys,
    rescanMinutes: cfg.rescanMinutes,
    onCandidate,
  });

  // Retry ticker: due jobs re-run every minute.
  const retryTimer = setInterval(() => {
    const now = Date.now();
    const due = ledger.active().filter(
      (j) => !inFlight.has(j.id) && (!j.nextRetryAt || new Date(j.nextRetryAt).getTime() <= now),
    );
    const failedCount = ledger.active().filter((j) => (j.attempts ?? 0) > 0).length;
    if (failedCount > cfg.failedAlarmCount) {
      sentry?.captureMessage?.(`scan-agent: ${failedCount} jobs stuck in retry`, "error");
    }
    for (const job of due) void runJob(job);
  }, 60_000);
  retryTimer.unref?.();

  // Heartbeat ticker (D13 watchdog input).
  const beat = async () => {
    const { status } = await gateway.heartbeat({
      active_jobs: ledger.active().length,
      version: cfg.agentVersion,
    }).catch(() => ({ status: 0 }));
    if (status !== 200) warn("heartbeat failed", { status });
  };
  await beat();
  const heartbeatTimer = setInterval(() => void beat(), cfg.heartbeatMinutes * 60_000);
  heartbeatTimer.unref?.();

  // Daily purge of archived-uploaded copies + config refresh.
  const dailyTimer = setInterval(async () => {
    // Purge failure = the 30-day PII-retention control silently stopping —
    // never a bare catch (observability rule 15).
    const removed = await purgeUploaded(dirs.uploadedDir, cfg.retentionDays).catch((e) => {
      warn("purge failed", { error: e instanceof Error ? e.message : String(e) });
      sentry.captureException(e);
      return 0;
    });
    if (removed) log("purged uploaded archives", { removed });
    try {
      const fresh = await fetchGatewayConfig(cfg);
      if (!fresh.stale) log("gateway config refreshed", { profiles: fresh.profiles.length });
    } catch (e) {
      warn("config refresh failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }, 24 * 3_600_000);
  dailyTimer.unref?.();

  const shutdown = async (signal) => {
    log("shutting down", { signal });
    clearInterval(retryTimer);
    clearInterval(heartbeatTimer);
    clearInterval(dailyTimer);
    await watcher.close();
    await sentry?.flush?.(2000);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  log("scan-agent running", { host: cfg.hostname, profiles: profileKeys });
}

const isDirectRun = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (isDirectRun) {
  main().catch(async (e) => {
    // A headless-service boot crash must reach Sentry (sentry-compliance):
    // the handled rejection here bypasses onUnhandledRejection, and a crash
    // before the first heartbeat is invisible to the server-side watchdog.
    console.error(JSON.stringify({ level: "error", surface: "scan-agent", msg: "fatal", error: e instanceof Error ? e.message : String(e) }));
    try {
      if (Sentry.getClient?.()) {
        Sentry.captureException(e);
        await Sentry.flush(2000);
      }
    } catch { /* Sentry itself unavailable — the console line above stands */ }
    process.exit(1);
  });
}

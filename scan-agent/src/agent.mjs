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

export async function main() {
  const cfg = loadConfig();
  const dirs = layout(cfg);

  const sentry = cfg.sentryDsn ? Sentry : null;
  if (sentry) {
    Sentry.init({
      dsn: cfg.sentryDsn,
      initialScope: { tags: { surface: "scan-agent", module: "document-intake", host: cfg.hostname } },
    });
  }

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
    const removed = await purgeUploaded(dirs.uploadedDir, cfg.retentionDays).catch(() => 0);
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
  main().catch((e) => {
    console.error(JSON.stringify({ level: "error", surface: "scan-agent", msg: "fatal", error: e instanceof Error ? e.message : String(e) }));
    process.exit(1);
  });
}

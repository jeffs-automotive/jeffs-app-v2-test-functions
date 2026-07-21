// scan-agent config — env + gateway-served profile map (plan D4/D5).
// The DB is the source of truth for profiles; the agent fetches the map from
// the gateway and caches the last-good copy so a Supabase outage never
// strands scanning (files queue locally regardless).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";

export function loadConfig(envPath = path.join(process.cwd(), ".env")) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

  const gatewayUrl = process.env.GATEWAY_URL ?? "";
  const agentToken = process.env.AGENT_TOKEN ?? "";
  const sentryDsn = process.env.SENTRY_DSN ?? "";
  // SENTRY_DSN is REQUIRED (plan D13): an unmonitored-but-alive agent is the
  // silent-failure mode this module exists to prevent. Fail loudly at boot
  // like the other two — the service restarts into the same clear error
  // until the .env is fixed.
  if (!gatewayUrl || !agentToken || !sentryDsn) {
    throw new Error(
      "scan-agent: GATEWAY_URL, AGENT_TOKEN, and SENTRY_DSN are all required (see .env.example)",
    );
  }

  return {
    gatewayUrl: gatewayUrl.replace(/\/+$/, ""),
    agentToken,
    sentryDsn,
    hostname: process.env.AGENT_HOSTNAME ?? os.hostname(),
    scansRoot: process.env.SCANS_ROOT ?? "C:\\Scans",
    workRoot: process.env.WORK_ROOT ?? "C:\\ScanAgent",
    retentionDays: Number(process.env.RETENTION_DAYS ?? "30"),
    heartbeatMinutes: Number(process.env.HEARTBEAT_MINUTES ?? "15"),
    configRefreshMinutes: Number(process.env.CONFIG_REFRESH_MINUTES ?? "60"),
    rescanMinutes: Number(process.env.RESCAN_MINUTES ?? "5"),
    stabilityMs: Number(process.env.STABILITY_MS ?? "10000"),
    minFreeBytes: Number(process.env.MIN_FREE_BYTES ?? String(5 * 1024 ** 3)),
    failedAlarmCount: Number(process.env.FAILED_ALARM_COUNT ?? "25"),
    agentVersion: "1.0.0",
  };
}

/** Derived filesystem layout (plan D12: archives OUTSIDE the SMB share). */
export function layout(cfg) {
  return {
    workDir: path.join(cfg.workRoot, "work"),
    uploadedDir: path.join(cfg.workRoot, "archive", "uploaded"),
    failedDir: path.join(cfg.workRoot, "archive", "failed"),
    ledgerPath: path.join(cfg.workRoot, "ledger.jsonl"),
    configCachePath: path.join(cfg.workRoot, "config-cache.json"),
  };
}

export function ensureDirs(cfg, profileKeys) {
  const l = layout(cfg);
  const dirs = [cfg.workRoot, l.workDir, l.uploadedDir, l.failedDir];
  for (const key of profileKeys) {
    dirs.push(path.join(cfg.scansRoot, key));
    dirs.push(path.join(l.uploadedDir, key));
    dirs.push(path.join(l.failedDir, key));
  }
  for (const d of dirs) fs.mkdirSync(d, { recursive: true });
}

/** Fetch the profile map from the gateway; fall back to the cached copy. */
export async function fetchGatewayConfig(cfg, fetchImpl = fetch) {
  const cachePath = layout(cfg).configCachePath;
  try {
    const res = await fetchImpl(cfg.gatewayUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.agentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ op: "config", hostname: cfg.hostname, agent_version: cfg.agentVersion }),
    });
    if (!res.ok) throw new Error(`gateway config HTTP ${res.status}`);
    const body = await res.json();
    if (!body.ok || !Array.isArray(body.profiles)) throw new Error("gateway config malformed");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(body, null, 2));
    return body;
  } catch (e) {
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      return { ...cached, stale: true, staleReason: e instanceof Error ? e.message : String(e) };
    }
    throw e;
  }
}

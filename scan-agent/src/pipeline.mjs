// scan-agent pipeline (plan D12): stability gate → atomic claim → ledger →
// gateway request-upload → PUT → confirm → archive. Failures back off and
// retry forever; a scan is never deleted un-uploaded and never lost to a
// crash (the ledger + startup replay carry every state transition).

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { sniffMime } from "./sniff.mjs";
import { nextRetryMs } from "./ledger.mjs";

const log = (msg, ctx = {}) =>
  console.log(JSON.stringify({ level: "info", surface: "scan-agent", msg, ...ctx }));
const warn = (msg, ctx = {}) =>
  console.warn(JSON.stringify({ level: "warn", surface: "scan-agent", msg, ...ctx }));

// ─── Stability gate ─────────────────────────────────────────────────────────
// A network scanner writes over SMB in chunks; an fs event does not mean the
// file is complete (cross-verify). Stable = size+mtime unchanged across the
// window AND we can open it exclusively (r+ fails while the scanner holds a
// write handle). Scanners don't temp-rename, so this is the strongest
// available completion signal.
export async function waitForStable(filePath, { stabilityMs = 10_000, pollMs = 1_000, maxWaitMs = 120_000, sleep = defaultSleep } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let last = null;
  let stableSince = null;
  while (Date.now() < deadline) {
    let st;
    try {
      st = await fsp.stat(filePath);
    } catch {
      return { ok: false, reason: "vanished" };
    }
    const sig = `${st.size}:${st.mtimeMs}`;
    if (st.size > 0 && sig === last) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= stabilityMs) {
        try {
          const fh = await fsp.open(filePath, "r+");
          await fh.close();
          return { ok: true, size: st.size };
        } catch {
          stableSince = null; // still locked by the writer
        }
      }
    } else {
      last = sig;
      stableSince = null;
    }
    await sleep(pollMs);
  }
  return { ok: false, reason: "never_stabilized" };
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Atomic claim ───────────────────────────────────────────────────────────
// Rename into the agent-owned work dir under a UUID name BEFORE any other
// work: kills source-name collisions and double-processing (two watcher
// paths racing on one file — exactly one rename wins).
export async function claimFile(srcPath, workDir, profileKey) {
  const id = crypto.randomUUID();
  const ext = path.extname(srcPath).toLowerCase() || ".bin";
  const stagedPath = path.join(workDir, `${id}${ext}`);
  try {
    await fsp.rename(srcPath, stagedPath);
  } catch (e) {
    if (e.code === "EXDEV") {
      // Cross-volume: copy+fsync+unlink (rename is not atomic across drives).
      await copyThenUnlink(srcPath, stagedPath);
    } else if (e.code === "ENOENT") {
      return null; // another path claimed it first — not an error
    } else {
      throw e;
    }
  }
  return { id, stagedPath, originalName: path.basename(srcPath), profileKey };
}

async function copyThenUnlink(src, dest) {
  await fsp.copyFile(src, dest);
  const fh = await fsp.open(dest, "r+");
  await fh.sync();
  await fh.close();
  await fsp.unlink(src);
}

export async function moveSafe(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    await copyThenUnlink(src, dest);
  }
}

export async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

// ─── Gateway client ─────────────────────────────────────────────────────────
export function createGateway(cfg, fetchImpl = fetch) {
  async function call(body) {
    const res = await fetchImpl(cfg.gatewayUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.agentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, hostname: cfg.hostname, agent_version: cfg.agentVersion }),
    });
    const text = await res.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch { /* non-JSON error body */ }
    return { status: res.status, body: parsed };
  }
  return {
    requestUpload: (args) => call({ op: "request_upload", ...args }),
    confirm: (args) => call({ op: "confirm", ...args }),
    heartbeat: (details) => call({ op: "heartbeat", details }),
  };
}

// ─── Job processing ─────────────────────────────────────────────────────────
/**
 * Drive ONE ledger job to done (or record the failure for retry). Every
 * transition is appended to the ledger before the next side effect.
 * Returns the terminal-or-current state string.
 */
export async function processJob(job, deps) {
  const { ledger, gateway, layoutDirs, fetchImpl = fetch, sentry = null } = deps;
  try {
    if (!fs.existsSync(job.stagedPath)) {
      // Staged file gone (manual intervention?) — permanent, loudly.
      ledger.append({ id: job.id, state: "failed_permanent", error: "staged_file_missing" });
      sentry?.captureMessage?.(`scan-agent: staged file missing for job ${job.id}`, "error");
      return "failed_permanent";
    }

    const bytesHead = await readHead(job.stagedPath, 16);
    const mime = sniffMime(bytesHead);
    if (!mime) {
      // Not one of ours (D9) — park it in failed/ for a human, terminal.
      const dest = path.join(layoutDirs.failedDir, job.profileKey, `${job.id}_${job.originalName}`);
      await moveSafe(job.stagedPath, dest);
      ledger.append({ id: job.id, state: "failed_permanent", error: "unrecognized_magic_bytes", parkedAt: dest });
      sentry?.captureMessage?.("scan-agent: file failed magic-byte validation (parked)", "warning");
      return "failed_permanent";
    }

    const sha256 = job.sha256 ?? await sha256File(job.stagedPath);
    const size = (await fsp.stat(job.stagedPath)).size;

    // Mint (or re-request against the persisted path — idempotent, D2).
    const mintRes = await gateway.requestUpload({
      profile_key: job.profileKey,
      original_filename: job.originalName,
      sha256,
      size_bytes: size,
      mime_type: mime,
      ...(job.objectPath ? { object_path: job.objectPath } : {}),
    });
    if (mintRes.status === 422) {
      const dest = path.join(layoutDirs.failedDir, job.profileKey, `${job.id}_${job.originalName}`);
      await moveSafe(job.stagedPath, dest);
      ledger.append({ id: job.id, state: "failed_permanent", error: `gateway_rejected:${mintRes.body.error}`, parkedAt: dest });
      sentry?.captureMessage?.(`scan-agent: gateway rejected upload (${mintRes.body.error})`, "warning");
      return "failed_permanent";
    }
    if (mintRes.status !== 200) throw new Error(`request_upload HTTP ${mintRes.status}: ${JSON.stringify(mintRes.body).slice(0, 200)}`);

    const objectPath = mintRes.body.object_path;
    ledger.append({ id: job.id, state: "minted", objectPath, sha256, size, mime });

    if (!mintRes.body.already_uploaded) {
      const put = await fetchImpl(mintRes.body.signed_url, {
        method: "PUT",
        headers: {
          "Content-Type": mime,
          ...(mintRes.body.token ? { Authorization: `Bearer ${mintRes.body.token}` } : {}),
          "x-upsert": "false",
        },
        body: await fsp.readFile(job.stagedPath),
      });
      // 409 = object already there from a lost earlier attempt — success.
      if (!put.ok && put.status !== 409) {
        throw new Error(`signed PUT HTTP ${put.status}`);
      }
      ledger.append({ id: job.id, state: "uploaded", objectPath });
    }

    const confirmRes = await gateway.confirm({ object_path: objectPath, sha256, size_bytes: size });
    if (confirmRes.status === 409) throw new Error("confirm says object missing — retrying upload");
    if (confirmRes.status !== 200) throw new Error(`confirm HTTP ${confirmRes.status}`);

    const archived = path.join(layoutDirs.uploadedDir, job.profileKey, `${job.id}_${job.originalName}`);
    await moveSafe(job.stagedPath, archived);
    ledger.append({ id: job.id, state: "done", objectPath, archivedAt: archived });
    log("job done", { id: job.id, objectPath });
    return "done";
  } catch (e) {
    const attempts = (job.attempts ?? 0) + 1;
    const msg = e instanceof Error ? e.message : String(e);
    ledger.append({
      id: job.id,
      state: job.state === "uploaded" ? "uploaded" : (job.objectPath ? "minted" : "claimed"),
      attempts,
      nextRetryAt: new Date(Date.now() + nextRetryMs(attempts)).toISOString(),
      lastError: msg.slice(0, 300),
    });
    warn("job failed, will retry", { id: job.id, attempts, error: msg.slice(0, 200) });
    if (attempts === 3) {
      sentry?.captureException?.(e instanceof Error ? e : new Error(msg));
    }
    return "retry_scheduled";
  }
}

async function readHead(filePath, n) {
  const fh = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return new Uint8Array(buf.subarray(0, bytesRead));
  } finally {
    await fh.close();
  }
}

// ─── Housekeeping ───────────────────────────────────────────────────────────
/** Purge archived-uploaded files older than the retention window (D12). */
export async function purgeUploaded(uploadedDir, retentionDays, now = Date.now()) {
  const cutoff = now - retentionDays * 86_400_000;
  let removed = 0;
  if (!fs.existsSync(uploadedDir)) return removed;
  for (const profile of await fsp.readdir(uploadedDir)) {
    const dir = path.join(uploadedDir, profile);
    let entries;
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const p = path.join(dir, name);
      try {
        const st = await fsp.stat(p);
        if (st.isFile() && st.mtimeMs < cutoff) {
          await fsp.unlink(p);
          removed++;
        }
      } catch { /* raced */ }
    }
  }
  return removed;
}

/** Free-space floor (D12): pause intake + alarm below the threshold. */
export async function hasFreeSpace(dirPath, minFreeBytes) {
  const st = await fsp.statfs(dirPath);
  return st.bavail * st.bsize >= minFreeBytes;
}

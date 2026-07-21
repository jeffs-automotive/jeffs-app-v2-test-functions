// Persistent local job ledger (plan D12) — the crash-proof memory of every
// file the agent has claimed. JSONL append-only during operation; compacted
// on startup (last record per job id wins; terminal jobs older than the
// retention window are dropped). A scan is NEVER represented only in RAM:
// claim → append BEFORE any network work, so a reboot resumes exactly.

import fs from "node:fs";
import path from "node:path";

export const JOB_STATES = ["claimed", "minted", "uploaded", "done", "failed_permanent"];

export function createLedger(ledgerPath) {
  /** @type {Map<string, object>} */
  const jobs = new Map();

  function append(record) {
    const withTs = { ...record, at: new Date().toISOString() };
    jobs.set(record.id, { ...(jobs.get(record.id) ?? {}), ...withTs });
    fs.appendFileSync(ledgerPath, JSON.stringify(withTs) + "\n");
    return jobs.get(record.id);
  }

  function replay() {
    jobs.clear();
    if (!fs.existsSync(ledgerPath)) return jobs;
    const lines = fs.readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (!rec.id) continue;
        jobs.set(rec.id, { ...(jobs.get(rec.id) ?? {}), ...rec });
      } catch {
        // A torn final line from a crash mid-append is expected — skip it.
      }
    }
    return jobs;
  }

  /** Rewrite the file: active jobs + recent terminal jobs only. */
  function compact(retentionDays = 30) {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const keep = [];
    for (const [id, job] of jobs) {
      const terminal = job.state === "done" || job.state === "failed_permanent";
      const at = job.at ? new Date(job.at).getTime() : Date.now();
      if (terminal && at < cutoff) {
        jobs.delete(id);
        continue;
      }
      keep.push(job);
    }
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    const tmp = ledgerPath + ".tmp";
    fs.writeFileSync(tmp, keep.map((j) => JSON.stringify(j)).join("\n") + (keep.length ? "\n" : ""));
    fs.renameSync(tmp, ledgerPath);
    return keep.length;
  }

  /** Jobs that still need work (not done / not permanently failed). */
  function active() {
    return [...jobs.values()].filter(
      (j) => j.state !== "done" && j.state !== "failed_permanent",
    );
  }

  return { append, replay, compact, active, jobs };
}

/** Exponential backoff for job retries: 5min * 2^attempts, capped at 30min. */
export function nextRetryMs(attempts) {
  return Math.min(5 * 60_000 * 2 ** attempts, 30 * 60_000);
}

/**
 * Source-state hashing — the staleness fingerprint shared across the daily pipeline.
 *
 * The per-RO/payment posting path (qteklink_postings + its enqueue/approve/reject/poster
 * + the read-only /postings ledger read) was fully retired by the daily-JE rework
 * (step 6); posting is bulk-per-day via `qteklink_daily_postings` (daily-postings.ts +
 * daily-poster.ts), and /postings is now the date-move queue. What remains here is the
 * one function that survived that move:
 *   - `sourceStateHash` — the canonical deterministic hash, used by the DAILY diff
 *     (`dailySourceState`), the approve scope, and the poster's staleness recheck.
 */
import { createHash } from "node:crypto";

/** Recursively key-sorted JSON so the same logical value always hashes the same. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** sha256 of the canonical source state — the staleness fingerprint (daily diff +
 *  approve scope_hash + claim-time recheck all use this). */
export function sourceStateHash(sourceState: unknown): string {
  return createHash("sha256").update(stableStringify(sourceState)).digest("hex");
}

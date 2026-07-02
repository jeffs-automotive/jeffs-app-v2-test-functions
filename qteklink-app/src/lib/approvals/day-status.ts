/**
 * Posted-day status helpers (resolution-workflow Part F) — pure derivations over the
 * day's posting ledger for the approvals page: who approved+posted the day (Chris's
 * "Approved and posted on {date} by {user}" panel) and whether a correction is
 * pending. Human attribution wins: a nightly auto-correction ("system (…)") must
 * never displace the person who actually approved the day.
 */
import type { DailyPostingRow } from "@/lib/dal/daily-postings";

export interface ApprovedStamp {
  by: string;
  at: string | null;
}

/** True for the system actors (auto-correction / withdrawals) — not a human. */
function isSystemActor(actor: string | null): boolean {
  return actor != null && actor.trim().toLowerCase().startsWith("system");
}

/**
 * The day's approval attribution: the EARLIEST-version posted row with a HUMAN
 * approver (the person who pressed "Approve + post this day"); falls back to any
 * posted row's approver. Null when nothing is posted.
 */
export function deriveApprovedStamp(postings: DailyPostingRow[]): ApprovedStamp | null {
  const posted = postings
    .filter((p) => p.status === "posted" && p.approvedBy != null)
    .sort((a, b) => a.postingVersion - b.postingVersion || a.category.localeCompare(b.category));
  if (posted.length === 0) return null;
  const human = posted.find((p) => !isSystemActor(p.approvedBy));
  const pick = human ?? posted[0]!;
  return { by: pick.approvedBy!, at: pick.approvedAt ?? null };
}

/** True when a PENDING correction supersedes a posted version in any category. */
export function hasPendingCorrection(postings: DailyPostingRow[]): boolean {
  const postedCats = new Set(postings.filter((p) => p.status === "posted").map((p) => p.category));
  return postings.some((p) => p.status === "pending" && postedCats.has(p.category));
}

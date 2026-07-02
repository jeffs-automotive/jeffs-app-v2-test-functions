/**
 * JE delta classification (resolution-workflow plan Part C) — PURE helpers shared by
 * the posted-day sweep (correction emails), the daily-postings diff (cosmetic
 * suppression + moot-correction obsoletion), and the approve-day scope.
 *
 * The load-bearing idea: a correction whose ONLY difference from the live posted JE
 * is line-description TEXT (same docNumber, same txnDate, same constituent
 * membership, identical account|type|amount line sequence) changes nothing an
 * accountant cares about — and QBO rejects ANY update to a deposited JE (6540,
 * proven live 2026-06-22/26/29: even a one-description change and a purely additive
 * update were both refused). So cosmetic deltas must never STAGE a correction, and a
 * stuck failed/pending correction that became cosmetic (or moot) must be obsoleted.
 *
 * Everything here is structural + conservative: ANY amount, account, posting-type,
 * order, count, docNumber, txnDate, or membership difference is NOT cosmetic.
 */

/** The minimal line shape both DailyPostingRow.lines and DailyJournalEntry.lines satisfy. */
export interface DeltaLine {
  accountId: string;
  postingType: "Debit" | "Credit";
  amountCents: number;
}

/** The minimal JE-side shape (a stored posting row OR a freshly built category JE). */
export interface DeltaSide {
  docNumber: string | null;
  txnDate: string | null;
  constituents: { roIds: number[]; paymentIds: string[] };
  lines: DeltaLine[];
}

/** How a posted JE category changed between two versions (the sweep's email taxonomy). */
export type ChangeKind = "deleted" | "membership" | "amounts" | "descriptions-only" | "no-change";

/** account|type|amount signature of a JE's lines, IGNORING description — tells a
 *  descriptions-only correction (line TEXT changed, accounts/amounts identical) from a
 *  real amounts/accounts change. Sequence-sensitive on purpose (a reorder is NOT cosmetic). */
export function lineSignature(lines: DeltaLine[]): string {
  return lines.map((l) => `${l.accountId}|${l.postingType}|${l.amountCents}`).join("\n");
}

/** Set-equality on a category's constituent ids (sales → RO ids; payments/fees → payment ids). */
function membershipDelta(
  category: "sales" | "payments" | "fees",
  prior: DeltaSide,
  next: DeltaSide,
): { added: string[]; removed: string[] } {
  const priorIds = (category === "sales" ? prior.constituents.roIds : prior.constituents.paymentIds).map(String);
  const nextIds = (category === "sales" ? next.constituents.roIds : next.constituents.paymentIds).map(String);
  const priorSet = new Set(priorIds);
  const nextSet = new Set(nextIds);
  return {
    added: nextIds.filter((id) => !priorSet.has(id)),
    removed: priorIds.filter((id) => !nextSet.has(id)),
  };
}

/**
 * Classify what changed between a posted prior JE and a correction (the sweep's
 * email taxonomy — moved here verbatim from posted-day-sweep so the diff layer can
 * share it):
 *   deleted          — the category emptied (the correction is a delete).
 *   membership       — repair orders / payments were added or removed.
 *   descriptions-only— same constituents + identical account/amount lines; only text differs.
 *   amounts          — same constituents, but the amounts/accounts changed.
 */
export function classifyDelta(
  category: "sales" | "payments" | "fees",
  prior: DeltaSide,
  next: DeltaSide & { isDelete?: boolean },
): { changeKind: ChangeKind; added: string[]; removed: string[] } {
  if (next.isDelete) return { changeKind: "deleted", added: [], removed: [] };
  const { added, removed } = membershipDelta(category, prior, next);
  if (added.length || removed.length) return { changeKind: "membership", added, removed };
  const descriptionsOnly = lineSignature(prior.lines) === lineSignature(next.lines);
  return { changeKind: descriptionsOnly ? "descriptions-only" : "amounts", added: [], removed: [] };
}

/**
 * True when `desired` differs from the LIVE POSTED JE only cosmetically — same
 * docNumber, same txnDate, same constituent membership, identical
 * account|type|amount line sequence; only description text differs (or nothing
 * differs at all — the caller usually catches exact-hash equality first, but a
 * no-op is trivially cosmetic). Strictly conservative: any structural difference
 * → false.
 */
export function isCosmeticDelta(
  category: "sales" | "payments" | "fees",
  livePosted: DeltaSide,
  desired: DeltaSide,
): boolean {
  if ((livePosted.docNumber ?? null) !== (desired.docNumber ?? null)) return false;
  if ((livePosted.txnDate ?? null) !== (desired.txnDate ?? null)) return false;
  if (livePosted.lines.length !== desired.lines.length) return false;
  const { added, removed } = membershipDelta(category, livePosted, desired);
  if (added.length || removed.length) return false;
  return lineSignature(livePosted.lines) === lineSignature(desired.lines);
}

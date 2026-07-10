/**
 * Daily-postings DAL (daily-JE rework step 3, docs/qteklink/daily-je-rework-plan.md §3/§4)
 * — the desired-vs-posted DIFF at the (shop, realm, business_date, category) grain over
 * `qteklink_daily_postings`:
 *
 *   enqueueDailyPosting(date, category, je|null) decides per the day's LIVE QBO state:
 *     no live JE + desired      → CREATE  (v1, or vN+1 after a posted delete / failed / rejected)
 *     live JE + desired changed → UPDATE  (vN+1 full-replacement correction)
 *     live JE + desired EMPTY   → DELETE  (vN+1; a QBO JE can't be updated to zero lines)
 *     live JE + desired same    → skip    (posted, unchanged)
 *     pending slot              → the enqueue RPC REFRESHES it in place (the day moves
 *                                 all day; the approval UI must show the real bundle)
 *     approved / posting slot   → FROZEN  (what the human confirmed; the poster's
 *                                 claim-time recheck owns divergence)
 *     unbalanced / over-cap je  → blocked (never enqueued; the reconcile layer raises
 *                                 the review item)
 *     pending slot + desired empty + no live JE → withdrawn (system-rejected — there is
 *                                 nothing to post and nothing to delete)
 *
 * "Live JE" = the latest POSTED version's QBO JournalEntry, unless that version was a
 * delete (then nothing is live and the next non-empty desired CREATEs a fresh JE).
 *
 * The source-state hash covers {category, businessDate, docNumber, constituents,
 * per-constituent lines} — membership changes trip it even when totals coincide.
 * requestid + the ledger marker are keyed on (shop, realm, day, category, version). The
 * marker is ledger-internal ONLY (proposed_je.marker) — it is NOT sent to QBO as
 * PrivateNote: the bank-deposit screen renders the JE-level memo for undeposited rows
 * and only falls back to per-line descriptions when it's absent (2026-07-09).
 *
 * Fat-DAL: the diff is deterministic; the RPCs own the writes. MULTI-TENANT: realmId is
 * the caller's bound realm; every query scopes shop_id + realm_id. Errors throw.
 */
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRealmForShop } from "@/lib/dal/realm";
import { QboClientError } from "@/lib/qbo/errors";
import { sourceStateHash } from "@/lib/dal/postings";
import { isCosmeticDelta } from "@/lib/daily/je-delta";
import type { DailyCategory, DailyJournalEntry } from "@/lib/daily/daily-je-builder";

export type DailyAction = "create" | "update" | "delete";

/** The canonical hashed source state of a day-category (null je = "category is empty"). */
export function dailySourceState(
  category: DailyCategory,
  businessDate: string,
  je: DailyJournalEntry | null,
): unknown {
  if (!je) return { category, businessDate, empty: true };
  return {
    category,
    businessDate,
    docNumber: je.docNumber,
    constituents: je.constituents,
    lines: je.lines,
  };
}

/**
 * Stable QBO requestid: `qtl-` + 40 hex = 44 ≤ 50 chars, keyed on the day-category
 * identity AND the source-state hash. The hash matters: a pending row's CONTENT can
 * be refreshed in place (enqueue diff / the poster's stale release), and QBO dedupes
 * by requestid — re-sending CHANGED content under the old id would return the
 * ORIGINAL response and silently diverge the books (audit 2026-06-12). Same content
 * → same id (the crash-safe resend contract); changed content → new id.
 */
export function dailyRequestIdFor(
  shopId: number,
  realmId: string,
  businessDate: string,
  category: DailyCategory,
  version: number,
  sourceHash: string,
): string {
  const identity = `${shopId}:${realmId}:day:${businessDate}:${category}:v${version}:${sourceHash}`;
  return `qtl-${createHash("sha256").update(identity).digest("hex").slice(0, 40)}`;
}

/**
 * Deterministic ledger marker — stored in proposed_je.marker for audit/traceability
 * of exactly which (shop, realm, day, category, version) a queued JE belongs to.
 * NOT sent to QBO (see the module doc + daily-poster); idempotency rides on the
 * requestid. Name kept for history: it used to be posted as the JE PrivateNote.
 */
export function dailyPrivateNoteMarker(
  shopId: number,
  realmId: string,
  businessDate: string,
  category: DailyCategory,
  version: number,
): string {
  return `QTL|${shopId}|${realmId}|day=${businessDate}|${category}|v${version}`;
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

export interface DailyPostingLine {
  accountId: string;
  postingType: "Debit" | "Credit";
  amountCents: number;
  description: string;
}

export interface DailyPostingRow {
  id: string;
  businessDate: string;
  category: DailyCategory;
  postingVersion: number;
  action: DailyAction;
  status: string;
  docNumber: string | null;
  txnDate: string | null;
  lines: DailyPostingLine[];
  /** Σ debit cents (the JE's gross); null when the version carries no lines (a delete). */
  totalCents: number | null;
  constituents: { roIds: number[]; paymentIds: string[] };
  sourceStateHash: string | null;
  requestid: string;
  qboJeId: string | null;
  qboSyncToken: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

interface DailyPostingDbRow {
  id: string;
  business_date: string;
  category: string;
  posting_version: number;
  action: string;
  status: string;
  proposed_je: {
    je?: { lines?: { accountId?: string; postingType?: string; amountCents?: number; description?: string }[]; docNumber?: string; txnDate?: string };
    source_state_hash?: string;
  } | null;
  constituents: { ro_ids?: number[]; payment_ids?: string[] } | null;
  source_state_hash: string | null;
  requestid: string;
  qbo_je_id: string | null;
  qbo_sync_token: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

const DAILY_SELECT =
  "id, business_date, category, posting_version, action, status, proposed_je, constituents, source_state_hash, requestid, qbo_je_id, qbo_sync_token, approved_by, approved_at, created_at";

function mapDailyRow(r: DailyPostingDbRow): DailyPostingRow {
  const rawLines = r.proposed_je?.je?.lines ?? [];
  const lines: DailyPostingLine[] = rawLines.map((l) => ({
    accountId: String(l.accountId ?? ""),
    postingType: l.postingType === "Credit" ? "Credit" : "Debit",
    amountCents: Number.isSafeInteger(l.amountCents) ? (l.amountCents as number) : 0,
    description: String(l.description ?? ""),
  }));
  const totalCents = lines.filter((l) => l.postingType === "Debit").reduce((a, l) => a + l.amountCents, 0);
  return {
    id: r.id,
    businessDate: r.business_date,
    category: r.category as DailyCategory,
    postingVersion: r.posting_version,
    action: (r.action as DailyAction) ?? "create",
    status: r.status,
    docNumber: r.proposed_je?.je?.docNumber ?? null,
    txnDate: r.proposed_je?.je?.txnDate ?? null,
    lines,
    totalCents: lines.length > 0 ? totalCents : null,
    constituents: {
      roIds: (r.constituents?.ro_ids ?? []).map(Number).filter(Number.isSafeInteger),
      paymentIds: (r.constituents?.payment_ids ?? []).map(String),
    },
    sourceStateHash: r.source_state_hash ?? r.proposed_je?.source_state_hash ?? null,
    requestid: r.requestid,
    qboJeId: r.qbo_je_id,
    qboSyncToken: r.qbo_sync_token,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    createdAt: r.created_at,
  };
}

/** ALL versions/statuses for one business day (the approvals view + the diff). */
export async function listDailyPostingsForDay(
  shopId: number,
  businessDate: string,
): Promise<{ realmId: string | null; postings: DailyPostingRow[] }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) return { realmId: null, postings: [] };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_daily_postings")
    .select(DAILY_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("business_date", businessDate)
    .order("category", { ascending: true })
    .order("posting_version", { ascending: true });
  if (error) throw new Error(`listDailyPostingsForDay failed: ${error.message}`);
  return { realmId, postings: ((data ?? []) as DailyPostingDbRow[]).map(mapDailyRow) };
}

/** The newest version row for a day-category (any status), or null. */
export async function findLatestDailyPosting(
  shopId: number,
  realmId: string,
  businessDate: string,
  category: DailyCategory,
): Promise<DailyPostingRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_daily_postings")
    .select(DAILY_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("business_date", businessDate)
    .eq("category", category)
    .order("posting_version", { ascending: false })
    .limit(1);
  if (error) throw new Error(`findLatestDailyPosting failed: ${error.message}`);
  const row = ((data ?? []) as DailyPostingDbRow[])[0];
  return row ? mapDailyRow(row) : null;
}

/** The newest POSTED version row for a day-category, or null. The day-category has a
 *  LIVE QBO JE iff this row exists and its action is not 'delete'. */
export async function findLatestPostedDaily(
  shopId: number,
  realmId: string,
  businessDate: string,
  category: DailyCategory,
): Promise<DailyPostingRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_daily_postings")
    .select(DAILY_SELECT)
    .eq("shop_id", shopId)
    .eq("realm_id", realmId)
    .eq("business_date", businessDate)
    .eq("category", category)
    .eq("status", "posted")
    .order("posting_version", { ascending: false })
    .limit(1);
  if (error) throw new Error(`findLatestPostedDaily failed: ${error.message}`);
  const row = ((data ?? []) as DailyPostingDbRow[])[0];
  return row ? mapDailyRow(row) : null;
}

// ─── Status index (the snapshot/breakdown views' day-grain truth) ─────────────

export interface DailyStatusIndex {
  /** ROs whose A/R line is LIVE in QBO (in the latest POSTED sales JE, not a delete). */
  postedSaleRos: Set<number>;
  /** roId → the LATEST sales-version's status (any status — a staged correction too). */
  latestSaleStatusByRo: Map<number, string>;
  postedPaymentIds: Set<string>;
  latestPaymentStatusById: Map<string, string>;
  postedFeePaymentIds: Set<string>;
  latestFeeStatusById: Map<string, string>;
  /** category → a posted version exists AND a newer staged version supersedes it
   *  (the day needs re-approval — surface it, don't hide it). */
  correctionStaged: Record<DailyCategory, boolean>;
}

/** PURE: index the day's category rows for per-RO/payment status resolution:
 *  a constituent of the live POSTED JE is "posted"; else the latest version's status
 *  applies; else the caller falls back to postable/blocked. */
export function buildDailyStatusIndex(postings: DailyPostingRow[]): DailyStatusIndex {
  const latest: Partial<Record<DailyCategory, DailyPostingRow>> = {};
  const latestPosted: Partial<Record<DailyCategory, DailyPostingRow>> = {};
  for (const r of postings) {
    const l = latest[r.category];
    if (!l || r.postingVersion > l.postingVersion) latest[r.category] = r;
    if (r.status === "posted") {
      const lp = latestPosted[r.category];
      if (!lp || r.postingVersion > lp.postingVersion) latestPosted[r.category] = r;
    }
  }
  const live = (c: DailyCategory): DailyPostingRow | undefined => {
    const p = latestPosted[c];
    return p && p.action !== "delete" ? p : undefined;
  };
  const idx: DailyStatusIndex = {
    postedSaleRos: new Set(live("sales")?.constituents.roIds ?? []),
    latestSaleStatusByRo: new Map((latest.sales?.constituents.roIds ?? []).map((ro) => [ro, latest.sales!.status])),
    postedPaymentIds: new Set(live("payments")?.constituents.paymentIds ?? []),
    latestPaymentStatusById: new Map((latest.payments?.constituents.paymentIds ?? []).map((id) => [id, latest.payments!.status])),
    postedFeePaymentIds: new Set(live("fees")?.constituents.paymentIds ?? []),
    latestFeeStatusById: new Map((latest.fees?.constituents.paymentIds ?? []).map((id) => [id, latest.fees!.status])),
    correctionStaged: { sales: false, payments: false, fees: false },
  };
  for (const c of ["sales", "payments", "fees"] as const) {
    const p = latestPosted[c];
    const l = latest[c];
    idx.correctionStaged[c] = Boolean(p && l && l.postingVersion > p.postingVersion && l.status !== "posted");
  }
  return idx;
}

// ─── The desired-vs-posted diff (enqueue) ─────────────────────────────────────

export type DailyEnqueueAction =
  | "new"          // a fresh version was enqueued (create/update/delete per `action`)
  | "refreshed"    // an existing PENDING version absorbed the new content
  | "exists"       // an existing PENDING version already matches (no-op)
  | "skip"         // posted + unchanged (or a cosmetic-only delta) — nothing to do
  | "frozen"       // approved/posting version in flight — recheck at post time owns it
  | "blocked"      // the je is unbalanced/over-cap — never enqueued (gate's review item)
  | "withdrawn"    // pending version for a now-empty day with no live JE — system-rejected
  | "obsoleted"    // a stuck pending/failed correction became moot (desired matches the
                   //   posted JE, or differs only in descriptions) — system-rejected
  | "noop";        // nothing desired, nothing live, nothing pending

export interface DailyEnqueueResult {
  enqueueAction: DailyEnqueueAction;
  action: DailyAction | null;
  postingId: string | null;
  postingVersion: number | null;
}

async function callEnqueueRpc(
  shopId: number,
  realmId: string,
  businessDate: string,
  category: DailyCategory,
  version: number,
  action: DailyAction,
  je: DailyJournalEntry | null,
  hash: string,
): Promise<string> {
  const admin = createSupabaseAdminClient();
  const proposedJe = {
    je: je
      ? { lines: je.lines, docNumber: je.docNumber, txnDate: je.txnDate }
      : { lines: [], docNumber: null, txnDate: businessDate },
    marker: dailyPrivateNoteMarker(shopId, realmId, businessDate, category, version),
    source_state_hash: hash,
  };
  const constituents = je
    ? { ro_ids: je.constituents.roIds, payment_ids: je.constituents.paymentIds }
    : {};
  const { data, error } = await admin.rpc("qteklink_enqueue_daily_posting", {
    p_shop_id: shopId,
    p_realm_id: realmId,
    p_business_date: businessDate,
    p_category: category,
    p_posting_version: version,
    p_action: action,
    p_proposed_je: proposedJe,
    p_constituents: constituents,
    p_source_state_hash: hash,
    p_requestid: dailyRequestIdFor(shopId, realmId, businessDate, category, version, hash),
  });
  if (error) throw new Error(`qteklink_enqueue_daily_posting failed: ${error.message}`);
  if (typeof data !== "string") {
    throw new Error(`qteklink_enqueue_daily_posting returned a non-uuid result: ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Apply the desired-vs-posted diff for ONE day-category. `je` is the freshly built
 * category JE (null = the category is empty today). Decides create/update/delete +
 * version per the table state; never touches approved/posting/terminal rows.
 */
export async function enqueueDailyPosting(
  shopId: number,
  realmId: string,
  businessDate: string,
  category: DailyCategory,
  je: DailyJournalEntry | null,
): Promise<DailyEnqueueResult> {
  // Fail closed: an unbalanced or over-cap bundle never reaches the ledger (the
  // reconcile layer raises the review item; this guard is belt-and-suspenders).
  if (je && (!je.balanced || je.overLineCap)) {
    return { enqueueAction: "blocked", action: null, postingId: null, postingVersion: null };
  }

  const hash = sourceStateHash(dailySourceState(category, businessDate, je));
  const latest = await findLatestDailyPosting(shopId, realmId, businessDate, category);
  const latestPosted =
    latest?.status === "posted" ? latest : await findLatestPostedDaily(shopId, realmId, businessDate, category);
  const liveJe = latestPosted && latestPosted.action !== "delete" ? latestPosted : null;
  const desiredAction: DailyAction | null = je ? (liveJe ? "update" : "create") : liveJe ? "delete" : null;

  // Nothing desired and nothing live.
  if (!desiredAction) {
    if (latest && latest.status === "pending") {
      // A pending version for a day that emptied before approval — withdraw it.
      await rejectDailyPosting(shopId, latest.id, "system (day-category emptied before approval)");
      return { enqueueAction: "withdrawn", action: null, postingId: latest.id, postingVersion: latest.postingVersion };
    }
    return { enqueueAction: "noop", action: null, postingId: null, postingVersion: null };
  }

  // An ACKNOWLEDGED day-category is TERMINAL — approved WITHOUT posting (Accounting
  // Link owns that day's books). Never re-enqueue it, no matter what changes.
  if (latest && latest.status === "acknowledged") {
    return { enqueueAction: "skip", action: null, postingId: latest.id, postingVersion: latest.postingVersion };
  }

  // Posted and unchanged (the latest version IS the posted one and the hash matches).
  if (latest && latest.status === "posted" && latest.sourceStateHash === hash) {
    return { enqueueAction: "skip", action: null, postingId: null, postingVersion: latest.postingVersion };
  }

  // An in-flight version: frozen (claim-time recheck owns divergence).
  if (latest && (latest.status === "approved" || latest.status === "posting")) {
    return { enqueueAction: "frozen", action: null, postingId: latest.id, postingVersion: latest.postingVersion };
  }

  // ── Cosmetic / moot corrections (resolution-workflow Part C) ────────────────
  // When a live posted JE exists and the desired state matches it exactly (hash) or
  // differs ONLY in line-description text, there is nothing QBO-worthy to post:
  // QBO rejects ANY update to a deposited JE (6540 — proven live on a one-word
  // description change AND on a purely additive update), and a wording-only delta
  // changes nothing an accountant cares about. Never stage it — and OBSOLETE a
  // stuck pending/failed correction that became moot (e.g. a deposit-locked v2
  // whose late payment was since voided, or a deploy/cache-warm rewording), so the
  // day CONVERGES instead of wedging (incidents 2026-06-22/26/29).
  if (liveJe && je) {
    const matchesLive = liveJe.sourceStateHash != null && hash === liveJe.sourceStateHash;
    const cosmetic =
      matchesLive ||
      isCosmeticDelta(category, liveJe, {
        docNumber: je.docNumber,
        txnDate: je.txnDate,
        constituents: je.constituents,
        lines: je.lines,
      });
    if (cosmetic) {
      if (latest && latest.id !== liveJe.id && (latest.status === "pending" || latest.status === "failed")) {
        await rejectDailyPosting(
          shopId,
          latest.id,
          matchesLive
            ? "system (superseded — desired matches the posted JE)"
            : "system (cosmetic delta — descriptions only, never posted)",
        );
        return { enqueueAction: "obsoleted", action: null, postingId: latest.id, postingVersion: latest.postingVersion };
      }
      return { enqueueAction: "skip", action: null, postingId: liveJe.id, postingVersion: liveJe.postingVersion };
    }
  }

  let version: number;
  let enqueueAction: DailyEnqueueAction;
  if (!latest) {
    version = 1;
    enqueueAction = "new";
  } else if (latest.status === "pending") {
    // The RPC refreshes the pending slot in place when the hash moved.
    version = latest.postingVersion;
    enqueueAction = latest.sourceStateHash === hash ? "exists" : "refreshed";
  } else if (
    latest.status === "failed" || latest.status === "rejected" ||
    latest.status === "needs_resolution" || latest.status === "accepted"
  ) {
    if (latest.sourceStateHash === hash) {
      // Unchanged since a human-relevant terminal state — never silently re-enqueue.
      return { enqueueAction: "skip", action: null, postingId: latest.id, postingVersion: latest.postingVersion };
    }
    version = latest.postingVersion + 1;
    enqueueAction = "new";
  } else {
    // latest.status === 'posted' with a hash change → the correction version.
    version = latest.postingVersion + 1;
    enqueueAction = "new";
  }

  const postingId = await callEnqueueRpc(shopId, realmId, businessDate, category, version, desiredAction, je, hash);
  return { enqueueAction, action: desiredAction, postingId, postingVersion: version };
}

// ─── Approve / reject (the human gate) ────────────────────────────────────────

export async function approveDailyPosting(
  shopId: number,
  id: string,
  approvedBy: string,
): Promise<{ approved: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_approve_daily_posting", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_approved_by: approvedBy,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_approve_daily_posting failed: ${error.message}`);
  }
  return { approved: data === true };
}

/** Mark a PENDING day-category as acknowledged — approved WITHOUT posting (the day
 *  is already in QuickBooks via Accounting Link). Terminal: the diff never touches
 *  an acknowledged category again. */
export async function acknowledgeDailyPosting(
  shopId: number,
  id: string,
  acknowledgedBy: string,
): Promise<{ acknowledged: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_acknowledge_daily_posting", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_acknowledged_by: acknowledgedBy,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_acknowledge_daily_posting failed: ${error.message}`);
  }
  return { acknowledged: data === true };
}

/** Human RETRY of a FAILED daily posting (failed → approved) — "I unlinked the
 *  deposit — retry now". Same version, same content (the caller's Pattern S flow
 *  verifies the source hash is unchanged); the poster's claim-time recheck remains
 *  the last guard. Returns whether a failed row was flipped. */
export async function retryDailyPosting(
  shopId: number,
  id: string,
  retriedBy: string,
): Promise<{ retried: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_retry_daily_posting", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_retried_by: retriedBy,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_retry_daily_posting failed: ${error.message}`);
  }
  return { retried: data === true };
}

/** Terminal human ACCEPTANCE of a FAILED daily correction (failed → accepted) —
 *  "Keep QuickBooks as-is". The day stops counting it as needs-attention; the
 *  version stays in history; a later REAL source change still stages v(N+1). */
export async function acceptDailyVariance(
  shopId: number,
  id: string,
  acceptedBy: string,
): Promise<{ accepted: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_accept_daily_variance", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_accepted_by: acceptedBy,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_accept_daily_variance failed: ${error.message}`);
  }
  return { accepted: data === true };
}

export async function rejectDailyPosting(
  shopId: number,
  id: string,
  rejectedBy: string,
): Promise<{ rejected: boolean }> {
  const realmId = await resolveRealmForShop(shopId);
  if (!realmId) throw new QboClientError("QuickBooks is not connected for this shop.", { kind: "reconnect_required" });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_reject_daily_posting", {
    p_shop_id: shopId, p_realm_id: realmId, p_id: id, p_rejected_by: rejectedBy,
  });
  if (error) {
    if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
    throw new Error(`qteklink_reject_daily_posting failed: ${error.message}`);
  }
  return { rejected: data === true };
}

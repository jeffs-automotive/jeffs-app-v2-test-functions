/**
 * Payroll DAL — the LIVE-snapshot substrate (round-7 decisions #40/#41; migration
 * 20260711200000). Internal support module for src/lib/dal/payroll.ts (the public
 * entrypoint) — split out per the ~500-line file policy.
 *
 * OPEN runs carry a stored DISPLAY CACHE of their full RunSnapshot
 * (qteklink_payroll_runs.live_snapshot + live_snapshot_at + live_snapshot_stale):
 *
 *   READ (computePayrollRun / getOrComputeLiveSnapshot): fresh cache → serve it;
 *     stale/absent/unparseable/older-calc-version → compute ONCE, store via the
 *     qteklink_payroll_store_live_snapshot RPC, serve (read-through).
 *   WRITE INVALIDATION: the webhook mirror-apply pipeline + the nightly/manual
 *     ingests call qteklink_payroll_mark_open_runs_stale; open-run edits recompute
 *     INLINE (refreshLiveSnapshotAfterMutation) so the edit path stays consistent.
 *     RACE GUARD: every store carries the compute's START time — the RPC keeps
 *     stale=true when a mark fired mid-compute (multi-second builds: mirror reads
 *     + a QBO P&L call), so an invalidation is never lost to a concurrent store.
 *   DEBOUNCE (#40): the webhook path skips a recompute when one ran < 60s ago
 *     (live_snapshot_at) — the run just stays stale and the next read/notify/nightly
 *     recomputes.
 *   QBO MEMO (#41): the month tech cost fetched during a recompute rides inside the
 *     snapshot provenance; debounced/inline/read-through recomputes reuse it while
 *     < 6h old (same realm + month). Dry-run / nightly / manual refresh pass
 *     freshQbo and always re-fetch.
 *
 * THE LIVE SNAPSHOT NEVER FREEZES MONEY: completion (Pattern S) recomputes fresh —
 * completePayrollRun calls buildOpenRunSnapshot directly and the complete RPC
 * re-hashes state in-transaction; nothing in that path reads live_snapshot
 * (asserted by payroll.test.ts). Completed/voided runs render EXCLUSIVELY from the
 * frozen `snapshot` column.
 *
 * MULTI-TENANT: every query is shop-scoped; the webhook apply path groups events by
 * their stored shop_id (bound server-side by the qteklink-webhook realm resolve).
 * No silent failures: every Supabase call checks `error`. The two deliberate
 * capture-and-continue spots (cache-fill store on the read path; the post-mutation
 * inline recompute) are safe BECAUSE the stale flag guarantees the next read
 * recomputes — each is Sentry-captured with the shop_id tag and documented inline.
 */
import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildOpenRunSnapshot,
} from "@/lib/dal/payroll-compute";
import { QBO_TECH_COST_MEMO_MAX_AGE_MS, type QboTechCostMemo } from "@/lib/dal/payroll-compute-gp";
import {
  fetchRunGuarded,
  runFromRow,
  RUN_COLS,
  type PayrollRun,
  type RunDbRow,
} from "@/lib/dal/payroll-shared";
import {
  createAlertCollector,
  flushAlerts,
  upsertPage,
  type MirrorDb,
} from "@/lib/payroll/mirror-ingest";
import { CALC_VERSION } from "@/lib/payroll/calc";
import { RunSnapshotSchema, type RunSnapshot } from "@/lib/payroll/types";

/** #40: skip a webhook-triggered recompute when one ran this recently. */
export const LIVE_RECOMPUTE_DEBOUNCE_MS = 60_000;

export { QBO_TECH_COST_MEMO_MAX_AGE_MS };
export type { QboTechCostMemo };

// ── RPC wrappers ───────────────────────────────────────────────────────────────

/** Flip live_snapshot_stale=true on every OPEN run of the shop. Returns the number
 *  of runs newly invalidated (already-stale rows don't count). */
export async function markPayrollOpenRunsStale(shopId: number): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_payroll_mark_open_runs_stale", {
    p_shop_id: shopId,
  });
  if (error) throw new Error(`qteklink_payroll_mark_open_runs_stale failed: ${error.message}`);
  return typeof data === "number" ? data : 0;
}

/** Store a computed live snapshot on an OPEN run (the RPC RAISEs on any other
 *  status and deliberately never bumps updated_at / the Pattern S state hash).
 *  `computeStartedAt` (captured just BEFORE buildOpenRunSnapshot) is the
 *  lost-invalidation race guard: the RPC stores the snapshot but keeps
 *  live_snapshot_stale=true when a mark_open_runs_stale fired AFTER that instant —
 *  a webhook landing mid-recompute (mirror reads + a QBO P&L call span seconds)
 *  re-marked the run for data this snapshot cannot contain. */
export async function storeLiveSnapshot(
  runId: string,
  snapshot: RunSnapshot,
  computeStartedAt: Date,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("qteklink_payroll_store_live_snapshot", {
    p_run_id: runId,
    p_snapshot: snapshot,
    p_computed_at: new Date().toISOString(),
    p_compute_started_at: computeStartedAt.toISOString(),
  });
  if (error) throw new Error(`qteklink_payroll_store_live_snapshot failed: ${error.message}`);
}

// ── Cache read + the QBO tech-cost memo (#41) ──────────────────────────────────

/** Parse a run's stored live snapshot. null (recompute) when absent, unparseable,
 *  or computed under an OLDER calc version — a formula change invalidates caches. */
export function parseLiveSnapshot(run: RunDbRow): RunSnapshot | null {
  if (run.live_snapshot == null) return null;
  const parsed = RunSnapshotSchema.safeParse(run.live_snapshot);
  if (!parsed.success) return null;
  if (parsed.data.calc_version !== CALC_VERSION) return null;
  return parsed.data;
}

/**
 * Extract the reusable QBO tech-cost memo from a run's PREVIOUS live snapshot
 * (raw jsonb — tolerant reads; the provenance keys were written by
 * buildOpenRunSnapshot). Age/realm validity is judged inside resolveMonthGp — this
 * only requires the structural shape + the qbo_tech_cost source + a month match
 * with the run's CURRENT bonus month.
 */
export function extractQboTechCostMemo(run: RunDbRow): QboTechCostMemo | null {
  if (!run.bonus_period || !run.bonus_month) return null;
  const month = run.bonus_month.slice(0, 7);
  const provenance = (run.live_snapshot as { derived_provenance?: Record<string, unknown> } | null)
    ?.derived_provenance;
  if (!provenance || provenance.month_gp_source !== "qbo_tech_cost") return null;
  const valueCents = provenance.month_qbo_tech_cost_cents;
  const accountLabel = provenance.month_qbo_tech_cost_account;
  const fetchedAt = provenance.month_qbo_tech_cost_fetched_at;
  const realmId = provenance.month_qbo_tech_cost_realm_id;
  const snapMonth = typeof provenance.bonus_month === "string" ? provenance.bonus_month.slice(0, 7) : null;
  if (
    typeof valueCents !== "number" ||
    !Number.isSafeInteger(valueCents) ||
    typeof accountLabel !== "string" ||
    typeof fetchedAt !== "string" ||
    typeof realmId !== "string" ||
    snapMonth !== month
  ) {
    return null;
  }
  return { month, valueCents, accountLabel, fetchedAt, realmId };
}

// ── Read-through + recompute ───────────────────────────────────────────────────

/**
 * The OPEN-run read path (#41 instant tabs): serve the stored live snapshot when
 * fresh; otherwise compute once (reusing the < 6h QBO memo), store, serve. A store
 * failure is captured + tolerated — the computed snapshot is still the correct
 * answer for THIS read, and the run simply stays stale so the next read recomputes
 * (the ONLY reason this catch is sanctioned).
 */
export async function getOrComputeLiveSnapshot(shopId: number, run: RunDbRow): Promise<RunSnapshot> {
  if (run.status !== "open") {
    throw new Error(`payroll live: getOrComputeLiveSnapshot called on a ${run.status} run ${run.id}`);
  }
  if (!run.live_snapshot_stale) {
    const cached = parseLiveSnapshot(run);
    if (cached) return cached;
  }
  const computeStartedAt = new Date();
  const snapshot = await buildOpenRunSnapshot(shopId, run, {
    qboTechCostMemo: extractQboTechCostMemo(run),
  });
  try {
    await storeLiveSnapshot(run.id, snapshot, computeStartedAt);
  } catch (e) {
    // Cache-fill only: the freshly computed snapshot is returned regardless, and the
    // run stays stale (next read recomputes). Typical cause: the run completed in the
    // race window (the RPC RAISEs on non-open runs). Visible, never silent:
    Sentry.captureException(e, {
      tags: { qteklink_action: "payroll-live-store", shop_id: String(shopId) },
      extra: { run_id: run.id },
    });
  }
  return snapshot;
}

export interface PayrollRunComputation {
  run: PayrollRun;
  snapshot: RunSnapshot;
}

/**
 * The run's computed sheets + summary. Read-path rule: OPEN runs read through the
 * stored live snapshot (recompute-on-stale); COMPLETED/VOIDED runs render
 * exclusively from the frozen snapshot — never recomputed, never the live cache.
 */
export async function computePayrollRun(shopId: number, runId: string): Promise<PayrollRunComputation> {
  const run = await fetchRunGuarded(shopId, runId);
  if (run.status !== "open") {
    return { run: runFromRow(run), snapshot: RunSnapshotSchema.parse(run.snapshot) };
  }
  return { run: runFromRow(run), snapshot: await getOrComputeLiveSnapshot(shopId, run) };
}

/**
 * Recompute one OPEN run's live snapshot and store it. `freshQbo` (dry-run /
 * nightly / manual refresh) skips the memo — the tech cost is re-fetched live.
 * Returns null when the run is no longer open (nothing to do). THROWS on
 * compute/store failure — callers own their isolation policy.
 */
export async function recomputeAndStoreLiveSnapshot(
  shopId: number,
  runId: string,
  opts: { freshQbo?: boolean } = {},
): Promise<RunSnapshot | null> {
  const run = await fetchRunGuarded(shopId, runId);
  if (run.status !== "open") return null;
  const computeStartedAt = new Date();
  const snapshot = await buildOpenRunSnapshot(shopId, run, {
    qboTechCostMemo: opts.freshQbo ? null : extractQboTechCostMemo(run),
  });
  await storeLiveSnapshot(runId, snapshot, computeStartedAt);
  return snapshot;
}

/**
 * The post-mutation hook (entry/run/roster edits): mark EVERY open run of the shop
 * stale (an edit in one run can shift another open run's computed-GP fallback),
 * then recompute THIS run inline so the editing user's next read is instant and
 * consistent. The mutation already COMMITTED when this runs — a recompute failure
 * must not misreport the edit as failed, and correctness is preserved by the stale
 * flag (the next read recomputes), so this captures + continues (documented
 * departure, mirroring the write-through half-apply idiom).
 */
export async function refreshLiveSnapshotAfterMutation(shopId: number, runId: string): Promise<void> {
  try {
    await markPayrollOpenRunsStale(shopId);
    await recomputeAndStoreLiveSnapshot(shopId, runId);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { qteklink_action: "payroll-live-mutation-recompute", shop_id: String(shopId) },
      extra: { run_id: runId },
    });
  }
}

// ── The #40 webhook mirror-apply pipeline ──────────────────────────────────────

/** A qteklink_events row as loaded for the mirror-apply route. */
export interface MirrorApplyEventRow {
  id: string;
  shop_id: number;
  event_kind: string;
  tekmetric_ro_id: number | string | null;
  raw_body: { data?: unknown } | null;
}

export async function fetchMirrorApplyEvents(eventIds: string[]): Promise<MirrorApplyEventRow[]> {
  if (eventIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  // received_at ASC: .in() alone returns arbitrary order — the per-RO dedupe in
  // applyMirrorEventsAndRecompute breaks payload-recency ties toward the LATER event.
  const { data, error } = await admin
    .from("qteklink_events")
    .select("id, shop_id, event_kind, tekmetric_ro_id, raw_body")
    .in("id", eventIds)
    .order("received_at", { ascending: true });
  if (error) throw new Error(`payroll live: qteklink_events fetch failed: ${error.message}`);
  return (data ?? []) as MirrorApplyEventRow[];
}

/** A webhook payload is applied ONLY when it is a FULL RO object (numeric id +
 *  a jobs ARRAY): a partial payload run through the delete-then-insert child sync
 *  would wipe mirror children the payload merely omitted. Skipped payloads still
 *  mark the runs stale — the nightly ingest / dry-run reconcile the gap. */
export function isFullRoPayload(data: unknown): data is Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return typeof d.id === "number" && Number.isSafeInteger(d.id) && Array.isArray(d.jobs);
}

export interface MirrorApplyShopResult {
  shopId: number;
  eventsSeen: number;
  payloadsApplied: number;
  /** Not a full RO payload (partial payloads never run the delete-then-insert child sync). */
  payloadsSkipped: number;
  /** Recency drops: in-batch duplicates superseded by a newer payload for the same RO,
   *  plus payloads OLDER than the mirror row (a stale write must never regress it). */
  payloadsStale: number;
  markedStale: number;
  recomputedRunIds: string[];
  debouncedRunIds: string[];
  error: string | null;
}

/** Payload recency in ms — Tekmetric `updatedDate`. Null/absent/unparseable sorts
 *  OLDEST (updatedDate stays null until an RO is first updated, so any payload or
 *  mirror row WITH an updatedDate postdates one without). */
function payloadUpdatedMs(payload: Record<string, unknown>): number {
  const ms = typeof payload.updatedDate === "string" ? Date.parse(payload.updatedDate) : NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** The mirror's current updated_date per RO id (shop-scoped) — the recency floor
 *  a webhook payload must meet to be applied. Missing rows simply aren't in the map. */
async function fetchMirrorUpdatedMs(shopId: number, roIds: number[]): Promise<Map<number, number>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tekmetric_ros")
    .select("id, updated_date")
    .eq("shop_id", shopId)
    .in("id", roIds);
  if (error) throw new Error(`payroll live: tekmetric_ros recency fetch failed: ${error.message}`);
  const out = new Map<number, number>();
  for (const row of (data ?? []) as { id: number; updated_date: string | null }[]) {
    const ms = row.updated_date === null ? NaN : Date.parse(row.updated_date);
    out.set(row.id, Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY);
  }
  return out;
}

async function listOpenRuns(shopId: number): Promise<RunDbRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_payroll_runs")
    .select(RUN_COLS)
    .eq("shop_id", shopId)
    .eq("status", "open");
  if (error) throw new Error(`payroll live: open runs fetch failed: ${error.message}`);
  return (data ?? []) as RunDbRow[];
}

/**
 * Recompute the shop's STALE open runs, debounced (#40): a run whose snapshot was
 * computed < 60s ago is skipped (stays stale; the next notify/read/nightly picks it
 * up). The < 6h QBO memo applies — the debounced path never blocks on a P&L call.
 * `freshQbo` (the nightly ingest) disables BOTH the debounce and the memo: a
 * deliberate refresh always recomputes with a live tech-cost fetch.
 */
export async function recomputeStaleOpenRuns(
  shopId: number,
  opts: { freshQbo?: boolean; now?: () => number } = {},
): Promise<{ recomputedRunIds: string[]; debouncedRunIds: string[] }> {
  const now = opts.now ?? Date.now;
  const recomputedRunIds: string[] = [];
  const debouncedRunIds: string[] = [];
  for (const run of await listOpenRuns(shopId)) {
    if (!run.live_snapshot_stale) continue;
    const computedAtMs = run.live_snapshot_at ? Date.parse(run.live_snapshot_at) : NaN;
    if (!opts.freshQbo && Number.isFinite(computedAtMs) && now() - computedAtMs < LIVE_RECOMPUTE_DEBOUNCE_MS) {
      debouncedRunIds.push(run.id);
      continue;
    }
    const computeStartedAt = new Date();
    const snapshot = await buildOpenRunSnapshot(shopId, run, {
      qboTechCostMemo: opts.freshQbo ? null : extractQboTechCostMemo(run),
    });
    await storeLiveSnapshot(run.id, snapshot, computeStartedAt);
    recomputedRunIds.push(run.id);
  }
  return { recomputedRunIds, debouncedRunIds };
}

/**
 * The #40 pipeline body (called by app/api/payroll/mirror-apply/route.ts): group
 * the notified events by shop; per shop, dedupe to the NEWEST full RO payload per
 * RO (duplicate ids in one upsert are a Postgres 21000 + duplicate-child-PK
 * failure), drop payloads OLDER than the mirror row (unordered concurrent notifies
 * must never regress it), apply the survivors into the tekmetric_ros* mirror
 * through the SAME single-sourced TS mappers the ingest uses (payload-only — no
 * Tekmetric API call), mark the shop's open runs stale, then recompute them
 * debounced. Per-shop failures are isolated (captured + reported in the result)
 * so one shop's problem never blocks another's events.
 */
export async function applyMirrorEventsAndRecompute(
  events: MirrorApplyEventRow[],
): Promise<MirrorApplyShopResult[]> {
  const byShop = new Map<number, MirrorApplyEventRow[]>();
  for (const ev of events) {
    const shopId = Number(ev.shop_id);
    if (!Number.isSafeInteger(shopId) || shopId <= 0) continue;
    const list = byShop.get(shopId) ?? [];
    list.push(ev);
    byShop.set(shopId, list);
  }

  const results: MirrorApplyShopResult[] = [];
  for (const [shopId, shopEvents] of byShop) {
    const result: MirrorApplyShopResult = {
      shopId,
      eventsSeen: shopEvents.length,
      payloadsApplied: 0,
      payloadsSkipped: 0,
      payloadsStale: 0,
      markedStale: 0,
      recomputedRunIds: [],
      debouncedRunIds: [],
      error: null,
    };
    try {
      // Per-RO dedupe (keep the NEWEST payload): two events for the same RO in one
      // batch would put duplicate ids into ONE upsert statement (Postgres 21000
      // "ON CONFLICT DO UPDATE cannot affect row a second time") and duplicate
      // child PKs into the delete-then-insert — the RO's jobs/labor would read as
      // ZERO until the nightly heals. Newest = payload updatedDate; ties/absent
      // fall to event order (fetchMirrorApplyEvents orders by received_at ASC, so
      // the later-received event wins).
      const byRoId = new Map<number, Record<string, unknown>>();
      for (const ev of shopEvents) {
        const data = ev.raw_body?.data;
        if (!isFullRoPayload(data)) {
          result.payloadsSkipped += 1;
          continue;
        }
        const roId = data.id as number;
        const prev = byRoId.get(roId);
        if (prev && payloadUpdatedMs(prev) > payloadUpdatedMs(data)) {
          result.payloadsStale += 1; // an older payload delivered later — drop it
          continue;
        }
        if (prev) result.payloadsStale += 1; // superseded by this newer payload
        byRoId.set(roId, data);
      }
      // Recency guard vs the mirror: concurrent single-event notifies are unordered
      // (fire-and-forget), so an OLDER payload committing last would regress
      // posted/completed dates + money the newer write already landed — and a run
      // completing in that window would freeze the regressed numbers. Payload-based
      // writes are the only path that can regress (the nightly API ingest always
      // fetches current); skip anything strictly older than the mirror row.
      let payloads = [...byRoId.values()];
      if (payloads.length > 0) {
        const mirrorMs = await fetchMirrorUpdatedMs(shopId, [...byRoId.keys()]);
        payloads = payloads.filter((payload) => {
          const floor = mirrorMs.get(payload.id as number);
          if (floor !== undefined && payloadUpdatedMs(payload) < floor) {
            result.payloadsStale += 1;
            return false;
          }
          return true;
        });
      }
      if (payloads.length > 0) {
        const db = createSupabaseAdminClient() as unknown as MirrorDb;
        const alerts = createAlertCollector();
        const applied = await upsertPage(db, shopId, payloads, alerts);
        await flushAlerts(db, shopId, alerts);
        result.payloadsApplied = applied.ros;
      }
      // Mark stale even when every payload was skipped: the RO event still means
      // the underlying Tekmetric data changed (the nightly backstop refills).
      result.markedStale = await markPayrollOpenRunsStale(shopId);
      const { recomputedRunIds, debouncedRunIds } = await recomputeStaleOpenRuns(shopId);
      result.recomputedRunIds = recomputedRunIds;
      result.debouncedRunIds = debouncedRunIds;
    } catch (e) {
      // Per-shop isolation (the route returns 200 with the per-shop error; the
      // nightly ingest is the reconciliation backstop for anything missed here).
      Sentry.captureException(e, {
        tags: { qteklink_action: "payroll-mirror-apply", shop_id: String(shopId) },
      });
      result.error = e instanceof Error ? e.message : String(e);
    }
    results.push(result);
  }
  return results;
}

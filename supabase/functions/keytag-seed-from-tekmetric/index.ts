// keytag-seed-from-tekmetric
//
// Idempotent backfill function — pulls every WIP and A/R repair order from
// Tekmetric, finds the ones that already have a key tag (1-100) sitting on
// the physical car, and reserves those tag numbers in our keytags table so
// the assign_next_keytag picker won't hand them out again.
//
// Run this:
//   - ONCE after the keytag system is first deployed (so existing in-shop
//     tags don't get reused)
//   - ANY TIME you want to reconcile our DB with Tekmetric's record (e.g.
//     after a manual change in Tekmetric, after dev/test resets)
//
// Idempotency: only seeds rows where keytags.status = 'available'. Already-
// assigned tags are left alone — re-running is safe and additive.
//
// Auth: relies on Supabase JWT verification at the edge gateway (verify_jwt
// = true). Caller passes anon or service_role JWT in Authorization header.
// The function uses its own service_role client internally for DB writes.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  ENV_NAMES,
  TEKMETRIC_RO_STATUS,
} from "../_shared/tekmetric.ts";
import {
  type TekmetricPage,
  type TekmetricRepairOrder,
  tekmetricGetJson,
} from "../_shared/tekmetric-client.ts";
import { parseKeytag } from "../_shared/keytag-format.ts";
import { withSentryScope } from "../_shared/sentry-edge.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface SeedResult {
  ok: boolean;
  shop_id: number;
  scanned: { wip: number; ar: number };
  seeded: Array<{
    tag_color: "red" | "yellow";
    tag_number: number;
    ro_id: number;
    ro_number: number;
    status: "assigned" | "posted_ar";
    legacy_format?: boolean;
  }>;
  skipped: Array<{
    ro_id: number;
    ro_number: number;
    reason: string;
    tag_color?: "red" | "yellow";
    tag_number?: number;
    raw_keytag?: unknown;
    winner_ro_number?: number;
    error?: string;
  }>;
  error?: string;
}

/**
 * Comparator for "most recent RO" used to resolve duplicate-keytag conflicts.
 *
 * Tekmetric's `keytag` field on an RO is a free-text marker that doesn't auto-
 * clear when the physical tag moves to another car. As a result the same
 * keytag value can appear on multiple WIP/AR ROs simultaneously: the oldest
 * RO has stale data; the newest is the actual current holder.
 *
 * Recency signal preference (most reliable first):
 *   1. appointmentStartTime — when the car came in for this work
 *   2. repairOrderNumber    — Tekmetric assigns these monotonically; higher = newer
 *
 * Returns true if `a` is more recent than `b`.
 */
function isMoreRecent(a: TekmetricRepairOrder, b: TekmetricRepairOrder): boolean {
  const ta = a.appointmentStartTime ? Date.parse(a.appointmentStartTime) : 0;
  const tb = b.appointmentStartTime ? Date.parse(b.appointmentStartTime) : 0;
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb;
  return a.repairOrderNumber > b.repairOrderNumber;
}

/** Fetches every RO in a given status, paginating through all pages (size=100). */
async function fetchAllRosByStatus(statusId: number): Promise<TekmetricRepairOrder[]> {
  const all: TekmetricRepairOrder[] = [];
  let page = 0;
  // Hard-cap pages to prevent runaway loops if Tekmetric reports `last: false` forever
  const MAX_PAGES = 20;
  while (page < MAX_PAGES) {
    const res = await tekmetricGetJson<TekmetricPage<TekmetricRepairOrder>>(
      sb,
      "/repair-orders",
      { shop: SHOP_ID, repairOrderStatusId: statusId, size: 100, page },
    );
    all.push(...res.content);
    if (res.last || res.content.length === 0) break;
    page++;
  }
  return all;
}

// PLAN-02 Phase 1 — per-request Sentry isolation scope + flush before response.
Deno.serve((req) => withSentryScope(req, "keytag-seed-from-tekmetric", async () => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(
      JSON.stringify({ ok: false, error: "Use POST or GET" }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }

  const result: SeedResult = {
    ok: true,
    shop_id: SHOP_ID,
    scanned: { wip: 0, ar: 0 },
    seeded: [],
    skipped: [],
  };

  // ── 1. Fetch WIP + A/R repair orders ────────────────────────────────────
  let wipRos: TekmetricRepairOrder[];
  let arRos: TekmetricRepairOrder[];
  try {
    [wipRos, arRos] = await Promise.all([
      fetchAllRosByStatus(TEKMETRIC_RO_STATUS.WIP),
      fetchAllRosByStatus(TEKMETRIC_RO_STATUS.POSTED_AR),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ ok: false, error: `Tekmetric fetch failed: ${msg}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  result.scanned.wip = wipRos.length;
  result.scanned.ar = arRos.length;

  // ── 2. Build (RO, target_status) targets and dedupe by keytag ──────────
  // Tekmetric leaves the keytag field on an RO even when the physical tag
  // moves to another car. So multiple ROs can carry the same keytag value
  // simultaneously — the oldest is stale, the newest is real. We resolve by
  // grouping on keytag and keeping the most recent RO per group; the rest
  // are reported under skipped with reason 'stale_keytag_in_tekmetric'.

  type Target = {
    ro: TekmetricRepairOrder;
    targetStatus: "assigned" | "posted_ar";
    color: "red" | "yellow";
    number: number;
    legacy: boolean;
  };
  const allTargets: Target[] = [];

  // First pass: parse + validate keytag for every RO. Out-of-range / unparseable
  // values land in skipped immediately.
  for (const ro of wipRos) {
    const parsed = parseKeytag(ro.keytag);
    if (parsed === null) {
      // Either no keytag or unparseable. We only flag unparseable (raw value present
      // but not in our format) — missing keytags on WIP ROs are fine, they just
      // haven't been tagged yet.
      if (ro.keytag !== null && ro.keytag !== undefined && String(ro.keytag).trim() !== "") {
        result.skipped.push({
          ro_id: ro.id,
          ro_number: ro.repairOrderNumber,
          raw_keytag: ro.keytag,
          reason: "keytag_unparseable",
        });
      }
      continue;
    }
    allTargets.push({ ro, targetStatus: "assigned", color: parsed.color, number: parsed.number, legacy: parsed.legacy });
  }
  for (const ro of arRos) {
    const parsed = parseKeytag(ro.keytag);
    if (parsed === null) {
      if (ro.keytag !== null && ro.keytag !== undefined && String(ro.keytag).trim() !== "") {
        result.skipped.push({
          ro_id: ro.id,
          ro_number: ro.repairOrderNumber,
          raw_keytag: ro.keytag,
          reason: "keytag_unparseable",
        });
      }
      continue;
    }
    allTargets.push({ ro, targetStatus: "posted_ar", color: parsed.color, number: parsed.number, legacy: parsed.legacy });
  }

  // Dedupe by (color, number). When multiple ROs claim the same tag (Tekmetric
  // doesn't auto-clear keytag fields when physical tags move), the most recent
  // RO wins; older ones are reported as stale.
  const tagKey = (c: "red" | "yellow", n: number) => `${c}-${n}`;
  const winnerByTag = new Map<string, Target>();
  const losers: Array<{ target: Target; winner: Target }> = [];

  for (const t of allTargets) {
    const k = tagKey(t.color, t.number);
    const existingWinner = winnerByTag.get(k);
    if (!existingWinner) {
      winnerByTag.set(k, t);
    } else if (isMoreRecent(t.ro, existingWinner.ro)) {
      losers.push({ target: existingWinner, winner: t });
      winnerByTag.set(k, t);
    } else {
      losers.push({ target: t, winner: existingWinner });
    }
  }

  for (const { target, winner } of losers) {
    result.skipped.push({
      ro_id: target.ro.id,
      ro_number: target.ro.repairOrderNumber,
      tag_color: target.color,
      tag_number: target.number,
      reason: "stale_keytag_in_tekmetric",
      winner_ro_number: winner.ro.repairOrderNumber,
      error: `RO ${target.ro.repairOrderNumber} carries keytag ${target.color}-${target.number} in Tekmetric, but RO ${winner.ro.repairOrderNumber} is the more recent holder. The value on RO ${target.ro.repairOrderNumber} is likely stale (physical tag moved). Consider clearing it manually in Tekmetric.`,
    });
  }

  // ── 3. Attempt to seed each winner ──────────────────────────────────────
  for (const t of winnerByTag.values()) {
    const { ro, targetStatus, color, number, legacy } = t;
    const now = new Date().toISOString();

    // Conditional update: only write if the tag is currently 'available'.
    const { data, error } = await sb
      .from("keytags")
      .update({
        status: targetStatus,
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
        customer_id: ro.customerId,
        vehicle_id: ro.vehicleId,
        advisor_id: ro.serviceWriterId,
        technician_id: ro.technicianId,
        assigned_at: now,
        posted_at: targetStatus === "posted_ar" ? now : null,
        released_at: null,
        updated_at: now,
      })
      .eq("tag_color", color)
      .eq("tag_number", number)
      .eq("status", "available")
      .select("tag_color, tag_number")
      .maybeSingle();

    if (error) {
      result.skipped.push({
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
        tag_color: color,
        tag_number: number,
        reason: "db_error",
        error: error.message,
      });
      continue;
    }

    if (!data) {
      const { data: holder } = await sb
        .from("keytags")
        .select("status, ro_id, ro_number")
        .eq("tag_color", color)
        .eq("tag_number", number)
        .maybeSingle();
      result.skipped.push({
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
        tag_color: color,
        tag_number: number,
        reason: "tag_already_held",
        ...(holder ? { error: `${color}-${number} already held by RO ${holder.ro_number} (${holder.status})` } : {}),
      });
      continue;
    }

    result.seeded.push({
      tag_color: color,
      tag_number: number,
      ro_id: ro.id,
      ro_number: ro.repairOrderNumber,
      status: targetStatus,
      ...(legacy ? { legacy_format: true } : {}),
    });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}));

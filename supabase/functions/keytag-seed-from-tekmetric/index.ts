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

import "@supabase/functions-js/edge-runtime.d.ts";
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
    tag_number: number;
    ro_id: number;
    ro_number: number;
    status: "assigned" | "posted_ar";
  }>;
  skipped: Array<{
    ro_id: number;
    ro_number: number;
    reason: string;
    tag_number?: number;
    raw_keytag?: unknown;
    error?: string;
  }>;
  error?: string;
}

/** Parses Tekmetric's `keytag` field into a number, or null if missing/invalid. */
function parseKeyTag(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
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

Deno.serve(async (req) => {
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

  // ── 2. Process each RO and reserve its keytag if applicable ─────────────
  // Pair each RO with the status we want to write into our table.
  const targets: Array<{ ro: TekmetricRepairOrder; targetStatus: "assigned" | "posted_ar" }> = [
    ...wipRos.map((ro) => ({ ro, targetStatus: "assigned" as const })),
    ...arRos.map((ro) => ({ ro, targetStatus: "posted_ar" as const })),
  ];

  for (const { ro, targetStatus } of targets) {
    const tag = parseKeyTag(ro.keytag);
    if (tag === null) {
      // RO is in WIP/AR but has no keytag — nothing to seed for this row
      continue;
    }
    if (tag < 1 || tag > 100) {
      result.skipped.push({
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
        raw_keytag: ro.keytag,
        reason: "keytag_out_of_range",
      });
      continue;
    }

    const now = new Date().toISOString();

    // Conditional update: only write if the tag is currently 'available'.
    // This makes the function idempotent — running it twice doesn't overwrite
    // assignments made by webhook traffic in between.
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
      .eq("tag_number", tag)
      .eq("status", "available")
      .select("tag_number")
      .maybeSingle();

    if (error) {
      result.skipped.push({
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
        tag_number: tag,
        reason: "db_error",
        error: error.message,
      });
      continue;
    }

    if (!data) {
      // Tag was already non-available (assigned to another RO, or seeded earlier).
      // Look up who currently holds it, for the report.
      const { data: holder } = await sb
        .from("keytags")
        .select("status, ro_id, ro_number")
        .eq("tag_number", tag)
        .maybeSingle();
      result.skipped.push({
        ro_id: ro.id,
        ro_number: ro.repairOrderNumber,
        tag_number: tag,
        reason: "tag_already_held",
        ...(holder ? { error: `tag ${tag} already held by RO ${holder.ro_number} (${holder.status})` } : {}),
      });
      continue;
    }

    result.seeded.push({
      tag_number: tag,
      ro_id: ro.id,
      ro_number: ro.repairOrderNumber,
      status: targetStatus,
    });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

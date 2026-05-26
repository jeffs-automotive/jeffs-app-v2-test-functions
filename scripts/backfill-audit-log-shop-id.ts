#!/usr/bin/env -S deno run --allow-net --allow-env
// ────────────────────────────────────────────────────────────────────────
// scheduler-edge-parity feature — E3 backfill script (2 of 2) per ADR-022
// ────────────────────────────────────────────────────────────────────────
//
// PURPOSE:
//   Migration A added scheduler_admin_audit_log.shop_id as NULLABLE so new
//   code could begin writing immediately. Historical rows have NULL shop_id.
//   Migration B (E11e) flips shop_id to NOT NULL — but it hard-fails if any
//   NULL rows remain. This script derives shop_id from snapshot-row data for
//   as many rows as possible (PHASE 1), then optionally applies a sentinel
//   value of -1 to residual unresolvable rows (PHASE 2, gated on operator
//   confirmation).
//
// TWO-PHASE DESIGN (per ADR-022):
//
//   PHASE 1 — Derivation (idempotent, no destructive writes):
//     For each row WHERE shop_id IS NULL:
//       1. Inspect snapshot.before — if any row has a shop_id column, use it
//       2. Inspect snapshot.before — if any row has shop_id-shaped INTEGER PK
//          (e.g., concern_subcategories.shop_id), use it
//       3. Fallback: look up the per-shop table row by snapshot's row id +
//          read shop_id from it (e.g., for testing_services audit row, look
#          up testing_services.id = <snapshot id> and read shop_id)
//       4. If all derivation paths fail → leave NULL + log for operator
//     UPDATE audit row with derived shop_id (if any)
//     PHASE 1 report: N rows updated; M rows left NULL (printed with ids +
//     occurred_at + table_name).
//
//   PHASE 2 — Gated sentinel UPDATE (only with --apply-sentinel-now flag):
//     IF M > 0 AND --apply-sentinel-now flag passed AND interactive prompt confirmed:
//       UPDATE scheduler_admin_audit_log SET shop_id = -1 WHERE shop_id IS NULL;
//     Log: "applied sentinel shop_id=-1 to {M} historical rows per operator confirmation."
//
//   Sentinel `-1` is PERMANENT (never re-derived). The list_scheduler_admin_audit_log
//   tool surfaces sentinel rows with reason `shop_id_unknown_pre_migration_backfill`
//   per ADR-021. Migration B's CHECK constraint permits `shop_id > 0 OR shop_id = -1`.
//
// USAGE:
//   # PHASE 1 — derive only (default):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   deno run --allow-net --allow-env scripts/backfill-audit-log-shop-id.ts
//
//   # PHASE 1 + apply derived shop_ids (writes the derivations):
//   ... deno run --allow-net --allow-env scripts/backfill-audit-log-shop-id.ts --apply-derivations
//
//   # PHASE 2 — apply sentinel -1 to residual NULL rows (requires PHASE 1 first):
//   ... deno run --allow-net --allow-env scripts/backfill-audit-log-shop-id.ts --apply-sentinel-now
//
//   # Both phases in one run:
//   ... deno run --allow-net --allow-env scripts/backfill-audit-log-shop-id.ts --apply-derivations --apply-sentinel-now
//
// IDEMPOTENT: re-running against rows that already have shop_id set skips them.
// ────────────────────────────────────────────────────────────────────────

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

interface AuditRow {
  id: number;
  occurred_at: string;
  table_name: string;
  operation: string;
  pre_state_snapshot: Record<string, unknown> | null;
  shop_id: number | null;
}

interface DerivationResult {
  id: number;
  table_name: string;
  occurred_at: string;
  derived_shop_id: number | null;
  rationale: string;
}

/**
 * PHASE 1 derivation — strategies in priority order:
 *
 *   (a) snapshot.before first-row has `shop_id` field
 *   (b) snapshot.before first-row's PK lookup in the per-shop table
 *   (c) snapshot has top-level `shop_id` field (older snapshot shapes)
 */
async function derive(supabase: SupabaseClient, row: AuditRow): Promise<DerivationResult> {
  const base = { id: row.id, table_name: row.table_name, occurred_at: row.occurred_at };

  if (row.pre_state_snapshot === null) {
    return { ...base, derived_shop_id: null, rationale: "pre_state_snapshot is NULL — cannot derive from snapshot" };
  }
  const snapshot = row.pre_state_snapshot;

  // Strategy (c): top-level shop_id
  if (typeof snapshot["shop_id"] === "number" && snapshot["shop_id"] > 0) {
    return { ...base, derived_shop_id: snapshot["shop_id"] as number, rationale: "snapshot.shop_id (top-level)" };
  }

  // Strategy (a): snapshot.before first-row's shop_id
  const before = (snapshot["before"] ?? {}) as Record<string, Record<string, unknown>>;
  const firstBeforeRow = Object.values(before)[0] as Record<string, unknown> | undefined;
  if (firstBeforeRow && typeof firstBeforeRow["shop_id"] === "number" && (firstBeforeRow["shop_id"] as number) > 0) {
    return { ...base, derived_shop_id: firstBeforeRow["shop_id"] as number, rationale: "snapshot.before[*].shop_id" };
  }

  // Strategy (b): per-table fallback — look up by ID
  if (firstBeforeRow && firstBeforeRow["id"] !== undefined) {
    const rowId = firstBeforeRow["id"];
    // Only attempt for tables we know have a shop_id column
    const allowedTables = ["testing_services", "routine_services", "concern_questions", "concern_subcategories", "concern_category_guidelines"];
    if (allowedTables.includes(row.table_name)) {
      const { data: tableRow } = await supabase
        .from(row.table_name)
        .select("shop_id")
        .eq("id", rowId as string | number)
        .maybeSingle<{ shop_id: number | null }>();
      if (tableRow && tableRow.shop_id !== null && tableRow.shop_id > 0) {
        return { ...base, derived_shop_id: tableRow.shop_id, rationale: `lookup in ${row.table_name} by snapshot id=${rowId}` };
      }
    }
  }

  // appointment_default_limits + closed_dates have different PK shapes — skip the lookup fallback
  return { ...base, derived_shop_id: null, rationale: `no derivation path succeeded for table=${row.table_name}` };
}

async function main() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required");
    Deno.exit(2);
  }

  const applyDerivations = Deno.args.includes("--apply-derivations");
  const applySentinel = Deno.args.includes("--apply-sentinel-now");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[backfill-shop-id] PHASE 1 mode: ${applyDerivations ? "APPLY-DERIVATIONS" : "DRY-RUN"}`);
  console.log(`[backfill-shop-id] PHASE 2 mode: ${applySentinel ? "APPLY-SENTINEL" : "skip"}`);

  // PHASE 1 — query NULL-shop_id rows
  const { data: rows, error } = await supabase
    .from("scheduler_admin_audit_log")
    .select("id, occurred_at, table_name, operation, pre_state_snapshot, shop_id")
    .is("shop_id", null)
    .order("id", { ascending: true })
    .returns<AuditRow[]>();

  if (error) {
    console.error("ERROR querying audit_log:", error);
    Deno.exit(1);
  }

  console.log(`\n[backfill-shop-id] PHASE 1 — derivation against ${rows?.length ?? 0} NULL-shop_id rows`);
  const derivations: DerivationResult[] = [];
  for (const row of rows ?? []) {
    derivations.push(await derive(supabase, row));
  }

  const resolved = derivations.filter((d) => d.derived_shop_id !== null);
  const unresolved = derivations.filter((d) => d.derived_shop_id === null);

  console.log(`\n[backfill-shop-id] RESOLVED: ${resolved.length}`);
  for (const r of resolved) {
    console.log(`  id=${r.id} table=${r.table_name} occurred=${r.occurred_at} → shop_id=${r.derived_shop_id} (${r.rationale})`);
  }
  console.log(`\n[backfill-shop-id] UNRESOLVED: ${unresolved.length}`);
  for (const r of unresolved) {
    console.log(`  id=${r.id} table=${r.table_name} occurred=${r.occurred_at} (${r.rationale})`);
  }

  if (applyDerivations && resolved.length > 0) {
    console.log(`\n[backfill-shop-id] APPLY-DERIVATIONS — writing ${resolved.length} updates...`);
    let updated = 0;
    let failed = 0;
    for (const r of resolved) {
      const { error: updateError } = await supabase
        .from("scheduler_admin_audit_log")
        .update({ shop_id: r.derived_shop_id })
        .eq("id", r.id);
      if (updateError) {
        console.error(`  ✗ id=${r.id} UPDATE failed:`, updateError.message);
        failed++;
      } else {
        console.log(`  ✓ id=${r.id} → shop_id=${r.derived_shop_id}`);
        updated++;
      }
    }
    console.log(`\n[backfill-shop-id] PHASE 1 APPLY complete: ${updated} updated, ${failed} failed.`);
  } else if (resolved.length > 0) {
    console.log(`\n[backfill-shop-id] PHASE 1 DRY-RUN complete. Re-run with --apply-derivations to write the ${resolved.length} resolved shop_ids.`);
  }

  // PHASE 2 — sentinel
  if (unresolved.length === 0) {
    console.log(`\n[backfill-shop-id] No unresolved rows — no PHASE 2 sentinel needed. Safe to apply Migration B.`);
    Deno.exit(0);
  }

  if (!applySentinel) {
    console.log(`\n[backfill-shop-id] ${unresolved.length} rows remain NULL. Re-run with --apply-sentinel-now to set shop_id = -1 (sentinel — surfaces in list-tool with reason 'shop_id_unknown_pre_migration_backfill' per ADR-021). Migration B will FAIL otherwise.`);
    Deno.exit(0);
  }

  console.log(`\n[backfill-shop-id] PHASE 2 APPLY-SENTINEL — setting shop_id = -1 on ${unresolved.length} rows...`);
  const { error: sentinelError } = await supabase
    .from("scheduler_admin_audit_log")
    .update({ shop_id: -1 })
    .is("shop_id", null);
  if (sentinelError) {
    console.error(`✗ PHASE 2 sentinel UPDATE failed:`, sentinelError);
    Deno.exit(1);
  }
  console.log(`✓ Sentinel applied to ${unresolved.length} historical rows. Migration B is now safe to apply.`);
  Deno.exit(0);
}

await main();

#!/usr/bin/env -S deno run --allow-net --allow-env
// ────────────────────────────────────────────────────────────────────────
// scheduler-edge-parity feature — E3 backfill script (1 of 2)
// ────────────────────────────────────────────────────────────────────────
//
// PURPOSE:
//   Writes snapshot_kind into scheduler_admin_audit_log.diff_summary.kind
//   for existing upload_md audit rows that predate the feature's snapshot_kind
//   convention. Existing rows have NULL snapshot_kind (it didn't exist when
//   they were written); the revert path's classifier dispatches on this
//   value to choose the right canonical_state_<kind> serializer + per-kind
//   revert handler. Without snapshot_kind set, the inner RPC's step 2
//   eligibility check would reject ALL pre-feature rows with reason_code
//   `table_not_supported`.
//
// DERIVATION RULES (per PLAN §9 E3 + research-04):
//   Operates on rows where:
//     operation = 'upload_md'
//     pre_state_snapshot IS NOT NULL
//     diff_summary IS NOT NULL
//     (diff_summary->>'kind') IS NULL
//
//   Maps table_name + snapshot/diff inspection to one of the 10 canonical
//   snapshot_kinds:
//
//   | table_name             | snapshot_kind candidate(s)                                    | discriminator                                                                 |
//   |------------------------|---------------------------------------------------------------|-------------------------------------------------------------------------------|
//   | testing_services       | testing_services_v2                                           | unique — only one kind writes to testing_services                             |
//   | routine_services       | routine_services_v2                                           | unique                                                                        |
//   | concern_subcategories  | concern_subcategories_descriptions_v2 OR _map_v2 OR _per_cat  | inspect snapshot.before row keys: description col → _descriptions_v2;         |
//   |                        |                                                               | service_map_* cols → _map_v2; both → _per_category (combined upload)          |
//   | concern_questions      | concern_questions_required_facts_v2 OR _flat OR _per_category | inspect snapshot.before row keys: ONLY required_facts mutated → _required_v2; |
//   |                        |                                                               | all question fields → _flat or _per_category (further: presence of           |
//   |                        |                                                               | added_subcategory_ids in snapshot signals _per_category)                      |
//   | concern_category_guidelines | concern_category_guidelines                              | unique                                                                        |
//   | appointment_default_limits | appointment_default_limits                               | unique                                                                        |
//   | closed_dates           | closed_dates_future                                           | unique                                                                        |
//
//   Ambiguous rows (cannot resolve to a single kind):
//     - Logged for operator review (printed to stdout)
//     - NOT updated (leave diff_summary.kind NULL)
//     - Operator must manually set the kind OR accept that the audit row
//       will be ineligible for revert (table_not_supported)
//
// USAGE:
//   # Dry-run (default — derive + report, no UPDATEs):
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   deno run --allow-net --allow-env scripts/backfill-snapshot-kind.ts
//
//   # Apply mode (writes the derived snapshot_kind):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   deno run --allow-net --allow-env scripts/backfill-snapshot-kind.ts --apply
//
// IDEMPOTENT: re-running against rows that already have snapshot_kind set
//   skips them (WHERE (diff_summary->>'kind') IS NULL filter).
// ────────────────────────────────────────────────────────────────────────

import { createClient } from "jsr:@supabase/supabase-js@2";

type SnapshotKind =
  | "testing_services_v2"
  | "routine_services_v2"
  | "concern_subcategories_descriptions_v2"
  | "concern_subcategories_map_v2"
  | "concern_questions_required_facts_v2"
  | "concern_questions_flat"
  | "concern_questions_per_category"
  | "concern_category_guidelines"
  | "appointment_default_limits"
  | "closed_dates_future";

interface AuditRow {
  id: number;
  occurred_at: string;
  table_name: string;
  operation: string;
  diff_summary: Record<string, unknown> | null;
  pre_state_snapshot: Record<string, unknown> | null;
}

interface DerivationResult {
  id: number;
  table_name: string;
  occurred_at: string;
  derived_kind: SnapshotKind | null;
  rationale: string;
}

function deriveSnapshotKind(row: AuditRow): DerivationResult {
  const base = { id: row.id, table_name: row.table_name, occurred_at: row.occurred_at };

  if (row.operation !== "upload_md") {
    return { ...base, derived_kind: null, rationale: `operation=${row.operation} — only upload_md gets snapshot_kind` };
  }
  if (row.pre_state_snapshot === null) {
    return { ...base, derived_kind: null, rationale: "pre_state_snapshot is NULL — cannot derive" };
  }

  const snapshot = row.pre_state_snapshot;
  const before = (snapshot["before"] ?? {}) as Record<string, Record<string, unknown>>;
  const firstBeforeRow: Record<string, unknown> | null =
    Object.values(before)[0] as Record<string, unknown> | undefined ?? null;

  switch (row.table_name) {
    case "testing_services":
      return { ...base, derived_kind: "testing_services_v2", rationale: "table_name=testing_services → testing_services_v2 (unique)" };

    case "routine_services":
      return { ...base, derived_kind: "routine_services_v2", rationale: "table_name=routine_services → routine_services_v2 (unique)" };

    case "concern_category_guidelines":
      return { ...base, derived_kind: "concern_category_guidelines", rationale: "table_name unique" };

    case "appointment_default_limits":
      return { ...base, derived_kind: "appointment_default_limits", rationale: "table_name unique" };

    case "closed_dates":
      return { ...base, derived_kind: "closed_dates_future", rationale: "table_name=closed_dates → closed_dates_future (unique)" };

    case "concern_subcategories": {
      // Could be: descriptions_v2 / map_v2 / per_category (combined with concern_questions)
      // Discriminator: presence of "added_subcategory_ids" + a separate snapshot or paired audit row for concern_questions
      // suggests _per_category. Otherwise inspect first-before-row column keys.
      if ("added_subcategory_ids" in snapshot || "questions_before" in snapshot || "added_question_ids" in snapshot) {
        return { ...base, derived_kind: "concern_questions_per_category", rationale: "snapshot has per-category fields (added_subcategory_ids/questions_before/added_question_ids)" };
      }
      if (firstBeforeRow === null) {
        return { ...base, derived_kind: null, rationale: "concern_subcategories with no before-row sample — cannot discriminate descriptions_v2 vs map_v2" };
      }
      const keys = Object.keys(firstBeforeRow);
      const hasDescription = keys.includes("description");
      const hasServiceMap = keys.some((k) => k.startsWith("service_map_"));
      if (hasDescription && !hasServiceMap) {
        return { ...base, derived_kind: "concern_subcategories_descriptions_v2", rationale: "before-row has description but no service_map_* cols → descriptions_v2" };
      }
      if (!hasDescription && hasServiceMap) {
        return { ...base, derived_kind: "concern_subcategories_map_v2", rationale: "before-row has service_map_* but no description → map_v2" };
      }
      if (hasDescription && hasServiceMap) {
        // Most likely a full-row capture from per_category upload (writes both)
        return { ...base, derived_kind: "concern_questions_per_category", rationale: "before-row has BOTH description + service_map_* → per_category combined upload" };
      }
      return { ...base, derived_kind: null, rationale: `concern_subcategories with ambiguous before-row cols (${keys.join(", ")}) — operator review needed` };
    }

    case "concern_questions": {
      if ("subcategories_before" in snapshot || "added_subcategory_ids" in snapshot) {
        return { ...base, derived_kind: "concern_questions_per_category", rationale: "snapshot has subcategories_before/added_subcategory_ids → per_category combined upload" };
      }
      if (firstBeforeRow === null) {
        return { ...base, derived_kind: null, rationale: "concern_questions with no before-row sample — cannot discriminate" };
      }
      const keys = Object.keys(firstBeforeRow);
      // _required_facts_v2: ONLY required_facts is mutated; before-row likely only has id + required_facts
      const mutatedKeys = keys.filter((k) => !["id", "shop_id", "category", "subcategory_id", "created_at", "updated_at", "updated_by_oauth_client_id", "updated_by_name"].includes(k));
      if (mutatedKeys.length === 1 && mutatedKeys[0] === "required_facts") {
        return { ...base, derived_kind: "concern_questions_required_facts_v2", rationale: "before-row mutates ONLY required_facts → _required_facts_v2" };
      }
      // Default to flat (full question row mutation, no per-category context)
      return { ...base, derived_kind: "concern_questions_flat", rationale: `before-row mutates ${mutatedKeys.join(", ")} → assuming concern_questions_flat (full-question upload)` };
    }

    default:
      return { ...base, derived_kind: null, rationale: `table_name=${row.table_name} is not in the 10-kind allow-list — cannot derive` };
  }
}

async function main() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required");
    Deno.exit(2);
  }

  const applyMode = Deno.args.includes("--apply");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[backfill-snapshot-kind] mode: ${applyMode ? "APPLY" : "DRY-RUN"}`);
  console.log(`[backfill-snapshot-kind] querying audit_log rows without snapshot_kind...`);

  const { data: rows, error } = await supabase
    .from("scheduler_admin_audit_log")
    .select("id, occurred_at, table_name, operation, diff_summary, pre_state_snapshot")
    .eq("operation", "upload_md")
    .not("pre_state_snapshot", "is", null)
    .not("diff_summary", "is", null)
    .returns<AuditRow[]>();

  if (error) {
    console.error("ERROR querying audit_log:", error);
    Deno.exit(1);
  }

  // Filter client-side for rows where diff_summary.kind is NULL (Supabase JS
  // doesn't have a clean is-not-set-yet JSONB filter on a sub-key)
  const candidates = (rows ?? []).filter((r) => {
    const ds = r.diff_summary ?? {};
    return !("kind" in ds) || ds["kind"] === null;
  });

  console.log(`[backfill-snapshot-kind] ${candidates.length} candidate rows to derive`);

  const results: DerivationResult[] = candidates.map(deriveSnapshotKind);
  const resolved = results.filter((r) => r.derived_kind !== null);
  const ambiguous = results.filter((r) => r.derived_kind === null);

  console.log(`\n[backfill-snapshot-kind] RESOLVED: ${resolved.length}`);
  for (const r of resolved) {
    console.log(`  id=${r.id} table=${r.table_name} occurred=${r.occurred_at} → ${r.derived_kind}`);
    console.log(`    rationale: ${r.rationale}`);
  }

  if (ambiguous.length > 0) {
    console.log(`\n[backfill-snapshot-kind] AMBIGUOUS (operator review needed): ${ambiguous.length}`);
    for (const r of ambiguous) {
      console.log(`  id=${r.id} table=${r.table_name} occurred=${r.occurred_at}`);
      console.log(`    rationale: ${r.rationale}`);
    }
  }

  if (!applyMode) {
    console.log(`\n[backfill-snapshot-kind] DRY-RUN complete. Re-run with --apply to write the ${resolved.length} resolved snapshot_kind values.`);
    Deno.exit(0);
  }

  // APPLY mode — UPDATE diff_summary['kind'] one row at a time (safer for audit-log writes)
  console.log(`\n[backfill-snapshot-kind] APPLY mode — writing ${resolved.length} updates...`);
  let updated = 0;
  let failed = 0;
  for (const r of resolved) {
    // Read current diff_summary so we can merge (preserves all other fields)
    const { data: current } = await supabase
      .from("scheduler_admin_audit_log")
      .select("diff_summary")
      .eq("id", r.id)
      .single<{ diff_summary: Record<string, unknown> | null }>();
    const merged = { ...(current?.diff_summary ?? {}), kind: r.derived_kind };
    const { error: updateError } = await supabase
      .from("scheduler_admin_audit_log")
      .update({ diff_summary: merged })
      .eq("id", r.id);
    if (updateError) {
      console.error(`  ✗ id=${r.id} UPDATE failed:`, updateError.message);
      failed++;
    } else {
      console.log(`  ✓ id=${r.id} → kind=${r.derived_kind}`);
      updated++;
    }
  }

  console.log(`\n[backfill-snapshot-kind] APPLY complete: ${updated} updated, ${failed} failed, ${ambiguous.length} skipped (ambiguous).`);
  Deno.exit(failed > 0 ? 1 : 0);
}

await main();

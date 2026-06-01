// services MD-upload surface.
// Extracted from scheduler-admin-catalog.ts (file-size-refactor). Mechanical
// split — no logic changes. Public API preserved via the ./index.ts barrel +
// the scheduler-admin-catalog.ts re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeCanonicalAfterState,
  formatPriceCents,
  logAuditEntry,
  parseBool,
  parseCsvList,
  parseIntField,
  parseMdSections,
  parsePriceCents,
  parseStringField,
  serializeMdSections,
  sha256Hex,
  type SectionSpec,
} from "../../scheduler-admin-md.ts";
import type { UploadResult, ValidationFinding } from "../scheduler-admin.ts";
import {
  CONCERN_CATEGORY_SLUGS,
  MIN_DESCRIPTION_LEN,
  MAX_DESCRIPTION_LEN,
  MAX_ABBREVIATION_LEN,
  PRICE_WARN_PCT,
  type UploadV2Args,
  type RowDiff,
  type CatalogConfig,
} from "./_shared.ts";
import { _failResult, _logAuditError } from "./helpers.ts";

interface TestingServiceRow {
  service_key: string;
  display_name: string;
  abbreviation: string;
  starting_price_cents: number;
  notes: string | null;
  description: string | null;
  example_keywords: string[] | null;
  concern_categories: string[];
  active: boolean;
}

const TESTING_CONFIG: CatalogConfig<TestingServiceRow> = {
  tableName: "testing_services",
  snapshotKind: "testing_services_v2",
  surfaceFilter: "testing_services",
  selectColumns:
    "service_key, display_name, abbreviation, starting_price_cents, notes, description, example_keywords, concern_categories, active",
  parseSection: (section, findings) => {
    const fields = section.fields;
    const errs: ValidationFinding[] = [];
    const push = (field: string, message: string) =>
      errs.push({ key: section.key, field, level: "error", message });

    const display_name = parseStringField(fields.display_name);
    if (!display_name) push("display_name", "missing or blank");

    const abbreviation = parseStringField(fields.abbreviation);
    if (!abbreviation) push("abbreviation", "missing or blank");
    else if (abbreviation.length > MAX_ABBREVIATION_LEN) {
      push("abbreviation", `>${MAX_ABBREVIATION_LEN} chars`);
    }

    let price = 0;
    try {
      const parsed = parsePriceCents(fields.starting_price);
      if (parsed === null) push("starting_price", "required (use 'Free' for $0)");
      else price = parsed;
    } catch (e) {
      push("starting_price", e instanceof Error ? e.message : String(e));
    }

    const notes = parseStringField(fields.notes);
    const description = parseStringField(fields.description);
    if (description && description.length < MIN_DESCRIPTION_LEN) {
      push("description", `<${MIN_DESCRIPTION_LEN} chars (too short — write a complete sentence)`);
    }
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      push("description", `>${MAX_DESCRIPTION_LEN} chars (too long — trim to 1-2 sentences)`);
    }

    const example_keywords = fields.example_keywords ? parseCsvList(fields.example_keywords) : null;

    const concern_categories = parseCsvList(fields.concern_categories);
    for (const cat of concern_categories) {
      if (!CONCERN_CATEGORY_SLUGS.has(cat)) {
        push("concern_categories", `"${cat}" is not one of the 14 canonical slugs`);
      }
    }

    let active: boolean;
    try {
      active = parseBool(fields.active, "active");
    } catch (e) {
      push("active", e instanceof Error ? e.message : String(e));
      active = true;
    }

    findings.push(...errs);
    if (errs.length > 0) return null;

    return {
      service_key: section.key,
      display_name: display_name!,
      abbreviation: abbreviation!,
      starting_price_cents: price,
      notes,
      description,
      example_keywords,
      concern_categories,
      active,
    };
  },
  diffFields: (before, after) => {
    const changed: string[] = [];
    if (before.display_name !== after.display_name) changed.push("display_name");
    if (before.abbreviation !== after.abbreviation) changed.push("abbreviation");
    if (before.starting_price_cents !== after.starting_price_cents) changed.push("starting_price_cents");
    if ((before.notes ?? null) !== (after.notes ?? null)) changed.push("notes");
    if ((before.description ?? null) !== (after.description ?? null)) changed.push("description");
    if (
      JSON.stringify([...(before.example_keywords ?? [])].sort()) !==
      JSON.stringify([...(after.example_keywords ?? [])].sort())
    ) changed.push("example_keywords");
    if (
      JSON.stringify([...before.concern_categories].sort()) !==
      JSON.stringify([...after.concern_categories].sort())
    ) changed.push("concern_categories");
    if (before.active !== after.active) changed.push("active");
    return changed;
  },
  toUpsertRow: (row, shopId) => ({ ...row, shop_id: shopId }),
  prettyRow: (row) =>
    `${row.service_key} (${row.display_name}, ${formatPriceCents(row.starting_price_cents)}, active=${row.active})`,
};

export async function uploadTestingServicesMdV2(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
): Promise<UploadResult> {
  return await _uploadCatalogV2(sb, shopId, args, TESTING_CONFIG);
}

// ═══════════════════════════════════════════════════════════════════════
// routine_services — Option B
// ═══════════════════════════════════════════════════════════════════════

interface RoutineServiceRow {
  service_key: string;
  display_name: string;
  abbreviation: string;
  display_order: number;
  wait_eligible: boolean;
  requires_explanation: boolean;
  concern_categories: string[] | null;
  starting_price_cents: number | null;
  price_waived_note: string | null;
  description: string | null;
  active: boolean;
}

const ROUTINE_CONFIG: CatalogConfig<RoutineServiceRow> = {
  tableName: "routine_services",
  snapshotKind: "routine_services_v2",
  surfaceFilter: "routine_services",
  selectColumns:
    "service_key, display_name, abbreviation, display_order, wait_eligible, requires_explanation, concern_categories, starting_price_cents, price_waived_note, description, active",
  parseSection: (section, findings) => {
    const fields = section.fields;
    const errs: ValidationFinding[] = [];
    const push = (field: string, message: string) =>
      errs.push({ key: section.key, field, level: "error", message });

    const display_name = parseStringField(fields.display_name);
    if (!display_name) push("display_name", "missing or blank");

    const abbreviation = parseStringField(fields.abbreviation);
    if (!abbreviation) push("abbreviation", "missing or blank");
    else if (abbreviation.length > MAX_ABBREVIATION_LEN) {
      push("abbreviation", `>${MAX_ABBREVIATION_LEN} chars`);
    }

    let display_order = 999;
    try {
      display_order = parseIntField(fields.display_order, "display_order");
      if (display_order < 0) push("display_order", "must be >= 0");
    } catch (e) {
      push("display_order", e instanceof Error ? e.message : String(e));
    }

    let wait_eligible = false;
    try { wait_eligible = parseBool(fields.wait_eligible, "wait_eligible"); }
    catch (e) { push("wait_eligible", e instanceof Error ? e.message : String(e)); }

    let requires_explanation = false;
    try { requires_explanation = parseBool(fields.requires_explanation, "requires_explanation"); }
    catch (e) { push("requires_explanation", e instanceof Error ? e.message : String(e)); }

    let starting_price_cents: number | null = null;
    try {
      starting_price_cents = parsePriceCents(fields.starting_price);
      if (starting_price_cents !== null && starting_price_cents < 0) {
        push("starting_price", "must be >= 0");
      }
    } catch (e) {
      push("starting_price", e instanceof Error ? e.message : String(e));
    }

    const price_waived_note = parseStringField(fields.price_waived_note);
    const description = parseStringField(fields.description);
    if (description && description.length < MIN_DESCRIPTION_LEN) {
      push("description", `<${MIN_DESCRIPTION_LEN} chars (too short — write a complete sentence)`);
    }
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      push("description", `>${MAX_DESCRIPTION_LEN} chars (too long — trim to 1-2 sentences)`);
    }

    const concern_categories = fields.concern_categories ? parseCsvList(fields.concern_categories) : null;
    if (concern_categories) {
      for (const cat of concern_categories) {
        if (!CONCERN_CATEGORY_SLUGS.has(cat)) {
          push("concern_categories", `"${cat}" is not one of the 14 canonical slugs`);
        }
      }
    }

    let active = true;
    try { active = parseBool(fields.active, "active"); }
    catch (e) { push("active", e instanceof Error ? e.message : String(e)); }

    findings.push(...errs);
    if (errs.length > 0) return null;

    return {
      service_key: section.key,
      display_name: display_name!,
      abbreviation: abbreviation!,
      display_order,
      wait_eligible,
      requires_explanation,
      concern_categories,
      starting_price_cents,
      price_waived_note,
      description,
      active,
    };
  },
  diffFields: (before, after) => {
    const changed: string[] = [];
    if (before.display_name !== after.display_name) changed.push("display_name");
    if (before.abbreviation !== after.abbreviation) changed.push("abbreviation");
    if (before.display_order !== after.display_order) changed.push("display_order");
    if (before.wait_eligible !== after.wait_eligible) changed.push("wait_eligible");
    if (before.requires_explanation !== after.requires_explanation) changed.push("requires_explanation");
    if (
      JSON.stringify([...(before.concern_categories ?? [])].sort()) !==
      JSON.stringify([...(after.concern_categories ?? [])].sort())
    ) changed.push("concern_categories");
    if ((before.starting_price_cents ?? null) !== (after.starting_price_cents ?? null)) changed.push("starting_price_cents");
    if ((before.price_waived_note ?? null) !== (after.price_waived_note ?? null)) changed.push("price_waived_note");
    if ((before.description ?? null) !== (after.description ?? null)) changed.push("description");
    if (before.active !== after.active) changed.push("active");
    return changed;
  },
  toUpsertRow: (row, shopId) => ({ ...row, shop_id: shopId }),
  prettyRow: (row) =>
    `${row.service_key} (${row.display_name}, ${formatPriceCents(row.starting_price_cents)}, active=${row.active})`,
};

export async function uploadRoutineServicesMdV2(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
): Promise<UploadResult> {
  return await _uploadCatalogV2(sb, shopId, args, ROUTINE_CONFIG);
}

// ═══════════════════════════════════════════════════════════════════════
// Shared catalog uploader
// ═══════════════════════════════════════════════════════════════════════

async function _uploadCatalogV2<TRow extends {
  service_key: string;
  active: boolean;
  starting_price_cents?: number | null;
}>(
  sb: SupabaseClient,
  shopId: number,
  args: UploadV2Args,
  config: CatalogConfig<TRow>,
): Promise<UploadResult> {
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;
  const hash = await sha256Hex(md_content);

  // ── Parse
  let sections;
  try {
    sections = parseMdSections(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, config.tableName, hash, msg);
    }
    return _failResult(config.tableName, hash, 0, msg, dry_run);
  }

  // ── Validate per-section
  const findings: ValidationFinding[] = [];
  const seenKeys = new Set<string>();
  const validRows: TRow[] = [];
  for (const section of sections.sections) {
    if (seenKeys.has(section.key)) {
      findings.push({ key: section.key, field: "service_key", level: "error", message: "duplicate service_key in this upload" });
      continue;
    }
    seenKeys.add(section.key);
    const row = config.parseSection(section, findings);
    if (row) validRows.push(row);
  }

  const errors = findings.filter((f) => f.level === "error");
  if (validRows.length === 0 || errors.length > 0) {
    const msg = `${errors.length} validation error(s); 0 valid rows`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, config.tableName, hash, msg);
    }
    return {
      ok: false,
      table_name: config.tableName,
      md_content_hash: hash,
      rows_parsed: sections.sections.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_errors: errors.map((f) => ({ row_index: -1, field: `${f.key}.${f.field}`, message: f.message })),
      validation_warnings: findings.filter((f) => f.level === "warning"),
      dry_run,
      error_message: msg,
    };
  }

  // ── Fetch current state
  const { data: currentRows, error: fetchErr } = await sb
    .from(config.tableName)
    .select(config.selectColumns)
    .eq("shop_id", shopId);
  if (fetchErr) {
    const msg = `current-state fetch failed: ${fetchErr.message}`;
    if (!dry_run) {
      await _logAuditError(sb, shopId, audit, config.tableName, hash, msg);
    }
    return _failResult(config.tableName, hash, sections.sections.length, msg, dry_run);
  }

  const currentByKey = new Map<string, TRow>();
  // `.from(config.tableName)` with a runtime string falls back to
  // postgrest-js GenericStringError[]; the fetchErr branch above already
  // discriminates real errors, so the remaining rows are safe to widen.
  for (const row of (currentRows ?? []) as unknown as TRow[]) {
    currentByKey.set(row.service_key, row);
  }

  // ── Compute diff
  const diff: RowDiff<TRow> = { added: [], modified: [], deactivated: [], unchanged: [] };
  const uploadedKeys = new Set(validRows.map((r) => r.service_key));
  for (const row of validRows) {
    const current = currentByKey.get(row.service_key);
    if (!current) {
      diff.added.push(row);
    } else {
      const changed = config.diffFields(current, row);
      if (changed.length > 0) {
        diff.modified.push({ before: current, after: row, changed_fields: changed });
      } else {
        diff.unchanged.push(row);
      }
    }
  }
  for (const [key, row] of currentByKey) {
    if (!uploadedKeys.has(key) && row.active) {
      diff.deactivated.push(row);
    }
  }

  // ── Smell-test warnings
  const warnings: ValidationFinding[] = [...findings.filter((f) => f.level === "warning")];
  for (const mod of diff.modified) {
    if (mod.changed_fields.includes("starting_price_cents")) {
      const beforeCents = mod.before.starting_price_cents ?? 0;
      const afterCents = mod.after.starting_price_cents ?? 0;
      if (beforeCents > 0) {
        const pct = Math.abs(afterCents - beforeCents) / beforeCents;
        if (pct >= PRICE_WARN_PCT) {
          warnings.push({
            key: mod.after.service_key,
            field: "starting_price_cents",
            level: "warning",
            message: `price changed ${formatPriceCents(beforeCents)} → ${formatPriceCents(afterCents)} (${(pct * 100).toFixed(0)}% change — confirm not a typo)`,
          });
        }
      } else if (afterCents > 0) {
        warnings.push({
          key: mod.after.service_key,
          field: "starting_price_cents",
          level: "warning",
          message: `price set to ${formatPriceCents(afterCents)} (was Free) — confirm not a typo`,
        });
      }
    }
    if (mod.changed_fields.includes("active") && mod.before.active && !mod.after.active) {
      warnings.push({
        key: mod.after.service_key,
        field: "active",
        level: "warning",
        message: "service deactivated (will be hidden from picker)",
      });
    }
  }
  for (const row of diff.deactivated) {
    warnings.push({
      key: row.service_key,
      field: "_omitted",
      level: "warning",
      message: "row present in DB but missing from MD — will be soft-deleted (active=false)",
    });
  }

  // ── Build diff_summary
  //
  // E4 (2026-05-26): `surfaces[]` per ADR-021 + PLAN §7 6-column kind map +
  // PLAN §6.2 surface filter SQL. The list_scheduler_admin_audit_log MCP tool
  // matches rows with diff_summary->'surfaces' ? <surface_filter> on its
  // modern branch (NULL-safe via COALESCE); fallback to table_name on legacy
  // rows. Logical surface filter value (NOT physical table name) so the
  // list tool can disambiguate the 3 logical surfaces that share
  // table_name='concern_subcategories' and the 2 that share
  // table_name='concern_questions'.
  const diffSummary: Record<string, unknown> = {
    surfaces: [config.surfaceFilter],
    added: diff.added.map((r) => config.prettyRow(r)),
    modified: diff.modified.map((m) => ({
      service_key: m.after.service_key,
      changed_fields: m.changed_fields,
      pretty: config.prettyRow(m.after),
    })),
    deactivated: diff.deactivated.map((r) => r.service_key),
    unchanged_count: diff.unchanged.length,
  };

  const confirm_token = await sha256Hex(JSON.stringify({ md: hash, diff: diffSummary }));

  // ── Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: config.tableName,
      md_content_hash: hash,
      rows_parsed: sections.sections.length,
      rows_added: diff.added.length,
      rows_modified: diff.modified.length,
      rows_deactivated: diff.deactivated.length,
      validation_warnings: warnings.length > 0 ? warnings : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // ── Apply path — require matching confirm_token
  if (expected_confirm_token !== confirm_token) {
    return {
      ok: false,
      table_name: config.tableName,
      md_content_hash: hash,
      rows_parsed: sections.sections.length,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_warnings: warnings,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      error_message: expected_confirm_token
        ? "confirm_token mismatch — DB state or MD content changed since dry_run. Re-run dry_run and pass the new token."
        : "missing expected_confirm_token — run dry_run first, then pass the returned token back.",
    };
  }

  // ── Capture pre_state_snapshot.before (BEFORE writes)
  const snapshotBefore: Record<string, TRow> = {};
  for (const mod of diff.modified) snapshotBefore[mod.before.service_key] = mod.before;
  for (const row of diff.deactivated) snapshotBefore[row.service_key] = row;
  const snapshotBase = {
    before: snapshotBefore,
    added_keys: diff.added.map((r) => r.service_key),
  };

  // ── Apply
  let applyError: string | null = null;
  try {
    const toUpsert = [
      ...diff.added.map((r) => config.toUpsertRow(r, shopId)),
      ...diff.modified.map((m) => config.toUpsertRow(m.after, shopId)),
    ];
    if (toUpsert.length > 0) {
      const { error } = await sb.from(config.tableName).upsert(toUpsert, { onConflict: "shop_id,service_key" });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    }
    if (diff.deactivated.length > 0) {
      const { error } = await sb
        .from(config.tableName)
        .update({ active: false })
        .eq("shop_id", shopId)
        .in("service_key", diff.deactivated.map((r) => r.service_key));
      if (error) throw new Error(`deactivate failed: ${error.message}`);
    }
  } catch (e) {
    applyError = e instanceof Error ? e.message : String(e);
  }

  // ── E4 (2026-05-26): Enrich pre_state_snapshot with the byte-parity fields
  // the revert path needs per ADR-025 + ROUND-6-RESIDUALS E2-N1. Only do this
  // on apply-success — on apply failure the snapshot stays null per the
  // existing pattern (no point computing canonical for a half-applied state).
  //
  // `kind`                              — matches the snapshot_kind enum the
  //                                       E3 backfill script writes for
  //                                       historical V2 rows.
  // `expected_after_state_canonical`    — post-mutation read via the E2 helper
  //                                       (byte-parity with plpgsql
  //                                       canonical_state_<kind> serializer
  //                                       per ADR-025; pipe-delimited format).
  // `after_hash`                        — SHA-256 hex of canonical text via
  //                                       WebCrypto; mirrors pgcrypto's
  //                                       encode(digest(..., 'sha256'), 'hex').
  //
  // SEC-17 Phase 1 surface lock is INTENTIONALLY NOT acquired here per the
  // ROUND-6-RESIDUALS E1cf-N1 deferral — V2 TS uploaders remain
  // non-cooperative writers in Phase 1. The byte-parity fields make audit
  // rows revertable; the surface lock concern (concurrent-safety) is
  // tracked separately.
  let enrichedSnapshot: Record<string, unknown> | null = null;
  if (!applyError) {
    try {
      const canonical = await computeCanonicalAfterState({
        kind: config.snapshotKind,
        supabase: sb,
        shopId,
        snapshot: snapshotBase,
      });
      const afterHash = await sha256Hex(canonical);
      enrichedSnapshot = {
        ...snapshotBase,
        kind: config.snapshotKind,
        expected_after_state_canonical: canonical,
        after_hash: afterHash,
      };
    } catch (e) {
      // Soft-fail on canonical compute — the apply already succeeded, so we
      // still write the audit row (with snapshot=null + an error_message
      // suffix), preferring a revertless audit row over no audit row at all.
      // Future revert attempts on this row will surface as
      // reason_code='cannot_safely_verify' per ADR-007 / ADR-021.
      const detail = e instanceof Error ? e.message : String(e);
      console.warn(
        JSON.stringify({
          level: "warning",
          msg: "v2_uploader_canonical_after_state_compute_failed",
          detail,
          shop_id: shopId,
          table_name: config.tableName,
          kind: config.snapshotKind,
        }),
      );
      enrichedSnapshot = null;
      applyError =
        `apply succeeded but expected_after_state_canonical compute failed: ${detail} ` +
        `(audit row written without snapshot — revert on this upload will be blocked)`;
    }
  }

  // ── Audit row (with enriched snapshot if apply succeeded)
  const auditResult = await logAuditEntry({
    supabase: sb,
    shopId,
    oauthClientId: audit.oauth_client_id,
    userLabel: audit.display_name,
    tableName: config.tableName,
    operation: "upload_md",
    rowsAdded: diff.added.length,
    rowsModified: diff.modified.length,
    rowsDeactivated: diff.deactivated.length,
    mdContentHash: hash,
    diffSummary,
    preStateSnapshot: enrichedSnapshot,
    errorMessage: applyError ?? undefined,
  });
  const audit_log_id = "id" in auditResult ? auditResult.id : null;

  return {
    ok: !applyError,
    table_name: config.tableName,
    md_content_hash: hash,
    rows_parsed: sections.sections.length,
    rows_added: diff.added.length,
    rows_modified: diff.modified.length,
    rows_deactivated: diff.deactivated.length,
    validation_warnings: warnings.length > 0 ? warnings : undefined,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: audit_log_id ?? undefined,
    error_message: applyError ?? undefined,
  };
}

const TESTING_EXPORT_SPEC: SectionSpec = {
  title: "Testing Services",
  guidance: [
    "Each `## service_key` block is one diagnostic/testing service the diagnostic LLM",
    "can recommend from the customer's free-text concern. Edit fields inline + re-upload",
    "via Claude Desktop. The orchestrator always shows a diff for advisor approval before",
    "applying — bulk uploads are dry-run by default.",
    "",
    "Required fields per service: Display name, Abbreviation, Starting price, Concern categories, Active.",
    "Optional: Notes (advisor-side), Description (customer-facing), Example keywords (LLM routing hints).",
    "",
    "Price format: \"$XX.XX\" or \"Free\". Description: 1-2 customer-facing sentences (10-500 chars).",
    "Concern categories: comma-separated from the 14 canonical slugs:",
    "  noise, vibration, pulling, smell, smoke, leak, warning_light, performance,",
    "  electrical, hvac, brakes, steering, tires, other",
    "Active: true/false. Soft-delete a service by setting Active: false (preserves history).",
    "",
    "To remove a service from the catalog entirely: delete its `## service_key` block AND",
    "re-upload — the parser will soft-delete any DB rows missing from the file.",
  ].join("\n"),
  fields: [
    { label: "Display name", get: (r) => String(r.display_name ?? "") },
    { label: "Abbreviation", get: (r) => String(r.abbreviation ?? "") },
    { label: "Starting price", get: (r) => formatPriceCents(r.starting_price_cents as number | null) },
    { label: "Notes", get: (r) => (r.notes ? String(r.notes) : "(none)") },
    { label: "Description", get: (r) => (r.description ? String(r.description) : "(none)") },
    { label: "Example keywords", get: (r) => {
      const arr = r.example_keywords as string[] | null | undefined;
      return arr && arr.length > 0 ? arr.join(", ") : "(none)";
    }},
    { label: "Concern categories", get: (r) => {
      const arr = r.concern_categories as string[] | null | undefined;
      return arr && arr.length > 0 ? arr.join(", ") : "(none)";
    }},
    { label: "Active", get: (r) => (r.active ? "true" : "false") },
  ],
};

const ROUTINE_EXPORT_SPEC: SectionSpec = {
  title: "Routine Services",
  guidance: [
    "Each `## service_key` block is one chip on the Step 7 picker. Edit fields inline +",
    "re-upload via Claude Desktop. The orchestrator always shows a diff for advisor approval",
    "before applying — bulk uploads are dry-run by default.",
    "",
    "Required: Display name, Abbreviation, Display order, Wait eligible, Requires explanation, Active.",
    "Optional: Concern categories (only meaningful when Requires explanation: true), Starting price,",
    "Price waived note, Description (customer-facing 1-2 sentence chip caption).",
    "",
    "Wait eligible: true if customer can wait in lobby (oil change, tire rotate, etc.). false = drop-off only.",
    "Requires explanation: true if picking this chip kicks off the concern-explanation diagnostic flow.",
    "  Currently true for the 5 diagnostic-routine chips: Brake Inspection, Check Battery,",
    "  Warning Lights, Check Suspension, Check A/C. Each must have a Concern categories list.",
    "Display order: integer; lower = shown first.",
    "Starting price: \"$XX.XX\" / \"Free\" / \"(none)\" (omit to render no price).",
    "Price waived note: short customer-facing caveat under the price (e.g. \"Fee waived if a repair or more testing is needed and approved\").",
  ].join("\n"),
  fields: [
    { label: "Display name", get: (r) => String(r.display_name ?? "") },
    { label: "Abbreviation", get: (r) => String(r.abbreviation ?? "") },
    { label: "Display order", get: (r) => String(r.display_order ?? 0) },
    { label: "Wait eligible", get: (r) => (r.wait_eligible ? "true" : "false") },
    { label: "Requires explanation", get: (r) => (r.requires_explanation ? "true" : "false") },
    { label: "Concern categories", get: (r) => {
      const arr = r.concern_categories as string[] | null | undefined;
      return arr && arr.length > 0 ? arr.join(", ") : "(none)";
    }},
    { label: "Starting price", get: (r) => formatPriceCents(r.starting_price_cents as number | null) },
    { label: "Price waived note", get: (r) => (r.price_waived_note ? String(r.price_waived_note) : "(none)") },
    { label: "Description", get: (r) => (r.description ? String(r.description) : "(none)") },
    { label: "Active", get: (r) => (r.active ? "true" : "false") },
  ],
};

export async function exportTestingServicesMdV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("testing_services")
    .select(TESTING_CONFIG.selectColumns)
    .eq("shop_id", shopId)
    .order("service_key", { ascending: true });
  if (error) throw new Error(`testing_services export failed: ${error.message}`);
  // see scheduler-admin-catalog.ts:433 comment — runtime table name +
  // un-parameterized SupabaseClient yields GenericStringError[]; cast
  // via unknown after the error branch is discriminated.
  const md = serializeMdSections((data ?? []) as unknown as Record<string, unknown>[], "service_key", TESTING_EXPORT_SPEC);
  return { md_content: md, row_count: (data ?? []).length };
}

export async function exportRoutineServicesMdV2(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ md_content: string; row_count: number }> {
  const { data, error } = await sb
    .from("routine_services")
    .select(ROUTINE_CONFIG.selectColumns)
    .eq("shop_id", shopId)
    .order("display_order", { ascending: true });
  if (error) throw new Error(`routine_services export failed: ${error.message}`);
  // see comment on exportTestingServicesMdV2.
  const md = serializeMdSections((data ?? []) as unknown as Record<string, unknown>[], "service_key", ROUTINE_EXPORT_SPEC);
  return { md_content: md, row_count: (data ?? []).length };
}

// ═══════════════════════════════════════════════════════════════════════
// revert_md_upload — undo a recent upload
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pattern S — two-step revert flow per PLAN §7:
 *   1. dry_run=true (default) returns structured outcome + confirm_token; NO writes.
 *   2. dry_run=false + expected_confirm_token (from step 1) actually performs the revert.
 *
 * Replaces the legacy TS-side dispatcher (E5-era) with a thin wrapper around the
 * outer plpgsql RPC `revert_md_upload_attempt`. The RPC handles dispatch across
 * all 10 snapshot_kinds + audit-trail persistence per ADR-002. TS-side just
 * passes args through, classifies on the structured outcome, and emits Sentry
 * per ADR-010.
 */

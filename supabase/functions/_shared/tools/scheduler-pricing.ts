// Pure tool functions for testing-service + routine-service pricing lookups
// and admin upsert/deactivate operations.
//
// Per appointments_design.md §6.10 + §6.11 + §7.2.
// Used by: _shared/scheduler-tools.ts (AI SDK tool registry).
//
// Pricing rules (per design §7.1 PRICING_SECTION):
//   - Chat agent CAN quote starting prices for testing services.
//   - Chat agent CANNOT quote parts/labor/repair/routine prices.
//   - Always include "starting price; more testing may be needed" caveat.
//
// Admin tools come from Claude Desktop OR scheduler context. Audit fields
// (updated_by_oauth_client_id + updated_by_name) are denormalized at write
// time so historical audit logs stay clear even if a staff member is later
// deactivated.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface TestingServiceRow {
  service_key: string;
  display_name: string;
  abbreviation: string;
  starting_price_cents: number;
  notes: string | null;
  concern_categories: string[] | null;
  active: boolean;
}

export interface RoutineServiceRow {
  service_key: string;
  display_name: string;
  abbreviation: string;
  display_order: number;
  active: boolean;
  /** Added 2026-05-13 (Chunk 1 migration 200): TRUE when this service can be
   *  performed while the customer waits (typically <60 min). Drives waiter
   *  slot eligibility. */
  wait_eligible: boolean;
  /** Added 2026-05-13 (Chunk 1 migration 200): TRUE when picking this chip
   *  requires the customer to also submit a free-form explanation (e.g.
   *  "brake inspection" → "tell us what you're noticing"). Drives Step 7.2. */
  requires_explanation: boolean;
}

export interface ConcernQuestionRow {
  id: number;
  category: string;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  display_order: number;
  active: boolean;
}

// ─── Read tools ──────────────────────────────────────────────────────────────

/**
 * Look up pricing for a testing service. Match by service_key OR by concern
 * category — a category may map to multiple testing services so we return an
 * array.
 *
 * Returns [] when no match — chat agent's pre-canned fallback is "I don't
 * have pricing for that handy — please call us at 6102536565."
 */
export async function lookupTestingServicePricing(
  sb: SupabaseClient,
  shopId: number,
  args: { service_key?: string; concern_category?: string },
): Promise<{ services: TestingServiceRow[]; count: number }> {
  let q = sb
    .from("testing_services")
    .select(
      "service_key, display_name, abbreviation, starting_price_cents, notes, concern_categories, active",
    )
    .eq("shop_id", shopId)
    .eq("active", true);

  if (args.service_key) {
    q = q.eq("service_key", args.service_key);
  } else if (args.concern_category) {
    q = q.contains("concern_categories", [args.concern_category]);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`testing_services lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as TestingServiceRow[];
  return { services: rows, count: rows.length };
}

/**
 * List all active routine_services in display order. Used by the chat agent
 * to populate show_service_and_concern_picker chips. Cached on the Vercel
 * side via routine-services-cache.ts (5-min TTL).
 *
 * Chunk 3 enhancement (2026-05-13): now returns wait_eligible +
 * requires_explanation flags (added in Chunk 1 migration 200). Optional
 * filter args let the chat agent pre-narrow without re-filtering client-side:
 *   - wait_eligible_only: TRUE → only services that can be done while
 *     customer waits (the §7.1 "wait-eligible chip set")
 *   - requires_explanation_only: TRUE → only services that need a
 *     free-form explanation (the §7.2 "concern explanation set")
 */
export async function listRoutineServices(
  sb: SupabaseClient,
  shopId: number,
  args: {
    wait_eligible_only?: boolean;
    requires_explanation_only?: boolean;
  } = {},
): Promise<{ services: RoutineServiceRow[] }> {
  let q = sb
    .from("routine_services")
    .select(
      "service_key, display_name, abbreviation, display_order, active, wait_eligible, requires_explanation",
    )
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (args.wait_eligible_only) {
    q = q.eq("wait_eligible", true);
  }
  if (args.requires_explanation_only) {
    q = q.eq("requires_explanation", true);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`routine_services list failed: ${error.message}`);
  }
  return { services: (data ?? []) as RoutineServiceRow[] };
}

/**
 * List the active concern_questions catalog rows for a given category.
 *
 * Per chat-design.md §7.4: when the customer's free-form explanation gets
 * classified into a concern category (noise, vibration, brakes, etc.), the
 * diagnostic Q&A specialist queries this catalog and picks 2-4 questions
 * the customer hasn't already answered. Options are stored as JSONB array
 * of {label, value} pairs (e.g. [{label:"Front of the car",value:"front"}]).
 *
 * Returns all active questions for the category, sorted by display_order.
 * The diagnostic specialist (Chunk 4) handles picking + answer-tracking.
 *
 * NEW in Chunk 3 (2026-05-13) — seeded by migration 200 with ~50 questions
 * across 14 categories.
 */
export async function listConcernQuestions(
  sb: SupabaseClient,
  shopId: number,
  category: string,
): Promise<{ questions: ConcernQuestionRow[]; count: number }> {
  const { data, error } = await sb
    .from("concern_questions")
    .select("id, category, question_text, options, display_order, active")
    .eq("shop_id", shopId)
    .eq("category", category)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (error) {
    throw new Error(`concern_questions lookup failed: ${error.message}`);
  }
  const rows = (data ?? []) as ConcernQuestionRow[];
  return { questions: rows, count: rows.length };
}

// ─── Admin tools ─────────────────────────────────────────────────────────────

/**
 * Upsert a testing-service row. Match by (shop_id, service_key) — INSERT if
 * new, UPDATE if existing. Audit fields (updated_by_*) captured at write
 * time.
 */
export async function upsertTestingService(
  sb: SupabaseClient,
  shopId: number,
  args: {
    service_key: string;
    display_name: string;
    abbreviation: string;
    starting_price_cents: number;
    notes?: string;
    description?: string;
    example_keywords?: string[];
    concern_categories?: string[];
    active?: boolean;
    updated_by_oauth_client_id: string;
    updated_by_name: string;
  },
): Promise<{ service_id: string; action: "created" | "updated" }> {
  // Existence check first so we can report which path
  const { data: existing } = await sb
    .from("testing_services")
    .select("id")
    .eq("shop_id", shopId)
    .eq("service_key", args.service_key)
    .maybeSingle();

  const payload = {
    shop_id: shopId,
    service_key: args.service_key,
    display_name: args.display_name,
    abbreviation: args.abbreviation,
    starting_price_cents: args.starting_price_cents,
    notes: args.notes ?? null,
    description: args.description ?? null,
    example_keywords: args.example_keywords ?? null,
    concern_categories: args.concern_categories ?? null,
    active: args.active ?? true,
    updated_at: new Date().toISOString(),
    updated_by_oauth_client_id: args.updated_by_oauth_client_id,
    updated_by_name: args.updated_by_name,
  };

  const { data, error } = await sb
    .from("testing_services")
    .upsert(payload, { onConflict: "shop_id,service_key" })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `testing_services upsert failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return {
    service_id: data.id as string,
    action: existing ? "updated" : "created",
  };
}

/**
 * Partial-field update for an existing testing-service row. Unlike
 * `upsertTestingService` (which requires every required field every
 * call), this is for ad-hoc field tweaks — e.g., "set brake_inspection
 * price to $42" without re-supplying display_name/abbreviation/etc.
 *
 * The row must already exist (returns action='not_found' if it doesn't).
 * Soft-delete via the existing `deactivateTestingService` helper.
 *
 * Per Chris's Phase 9b directive 2026-05-15: low-friction pricing edits
 * for testing_services. Routine services do NOT have a pricing column
 * (and won't in Phase 1).
 */
export async function patchTestingServiceFields(
  sb: SupabaseClient,
  shopId: number,
  args: {
    service_key: string;
    display_name?: string;
    abbreviation?: string;
    starting_price_cents?: number;
    notes?: string | null;
    description?: string | null;
    example_keywords?: string[] | null;
    concern_categories?: string[] | null;
    active?: boolean;
    updated_by_oauth_client_id: string;
    updated_by_name: string;
  },
): Promise<
  | { action: "updated"; service_id: string; fields_changed: string[] }
  | { action: "not_found"; service_key: string }
  | { action: "no_changes"; service_id: string }
> {
  const { data: existing, error: lookupErr } = await sb
    .from("testing_services")
    .select(
      "id, display_name, abbreviation, starting_price_cents, notes, description, example_keywords, concern_categories, active",
    )
    .eq("shop_id", shopId)
    .eq("service_key", args.service_key)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(`testing_services lookup failed: ${lookupErr.message}`);
  }
  if (!existing) {
    return { action: "not_found", service_key: args.service_key };
  }

  const existingRow = existing as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  const changed: string[] = [];

  const setIfChanged = <K extends string>(
    field: K,
    incoming: unknown,
    transform: (v: unknown) => unknown = (v) => v,
  ) => {
    if (incoming === undefined) return;
    const newValue = transform(incoming);
    if (JSON.stringify(newValue) === JSON.stringify(existingRow[field])) return;
    update[field] = newValue;
    changed.push(field);
  };

  setIfChanged("display_name", args.display_name);
  setIfChanged("abbreviation", args.abbreviation);
  setIfChanged("starting_price_cents", args.starting_price_cents);
  setIfChanged("notes", args.notes);
  setIfChanged("description", args.description);
  setIfChanged("example_keywords", args.example_keywords);
  setIfChanged("concern_categories", args.concern_categories);
  setIfChanged("active", args.active);

  if (changed.length === 0) {
    return { action: "no_changes", service_id: existing.id as string };
  }

  update.updated_at = new Date().toISOString();
  update.updated_by_oauth_client_id = args.updated_by_oauth_client_id;
  update.updated_by_name = args.updated_by_name;

  const { error } = await sb
    .from("testing_services")
    .update(update)
    .eq("id", existing.id as string);
  if (error) {
    throw new Error(`testing_services patch failed: ${error.message}`);
  }
  return {
    action: "updated",
    service_id: existing.id as string,
    fields_changed: changed,
  };
}

/**
 * Soft-delete a testing-service row by setting active=false. Preserves
 * historical pricing references in transcripts.
 */
export async function deactivateTestingService(
  sb: SupabaseClient,
  shopId: number,
  args: { service_key: string },
): Promise<{ success: true }> {
  const { error } = await sb
    .from("testing_services")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .eq("service_key", args.service_key);
  if (error) {
    throw new Error(`testing_services deactivate failed: ${error.message}`);
  }
  return { success: true };
}

/**
 * Upsert a routine-service chip (one of the 10 customer-facing picker chips).
 * Match by (shop_id, service_key).
 */
export async function upsertRoutineService(
  sb: SupabaseClient,
  shopId: number,
  args: {
    service_key: string;
    display_name: string;
    abbreviation: string;
    display_order: number;
    wait_eligible?: boolean;
    requires_explanation?: boolean;
    concern_categories?: string[];
    active?: boolean;
    updated_by_oauth_client_id: string;
    updated_by_name: string;
  },
): Promise<{ service_id: string; action: "created" | "updated" }> {
  const { data: existing } = await sb
    .from("routine_services")
    .select("id")
    .eq("shop_id", shopId)
    .eq("service_key", args.service_key)
    .maybeSingle();

  const payload = {
    shop_id: shopId,
    service_key: args.service_key,
    display_name: args.display_name,
    abbreviation: args.abbreviation,
    display_order: args.display_order,
    wait_eligible: args.wait_eligible ?? false,
    requires_explanation: args.requires_explanation ?? false,
    concern_categories: args.concern_categories ?? null,
    active: args.active ?? true,
    updated_at: new Date().toISOString(),
    updated_by_oauth_client_id: args.updated_by_oauth_client_id,
    updated_by_name: args.updated_by_name,
  };

  const { data, error } = await sb
    .from("routine_services")
    .upsert(payload, { onConflict: "shop_id,service_key" })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `routine_services upsert failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return {
    service_id: data.id as string,
    action: existing ? "updated" : "created",
  };
}

/**
 * Partial-field update for an existing routine-service row. Unlike
 * `upsertRoutineService` (which requires every required field), this is
 * for ad-hoc edits — e.g., "set check_battery requires_explanation=true"
 * without re-supplying display_name/abbreviation/etc.
 *
 * Per Chris's Phase 9b directive 2026-05-15: routine services do NOT
 * have a pricing column and won't in Phase 1; the partial-update surface
 * here exists for non-pricing field tweaks (display name, wait
 * eligibility, requires_explanation, concern_categories, active).
 */
export async function patchRoutineServiceFields(
  sb: SupabaseClient,
  shopId: number,
  args: {
    service_key: string;
    display_name?: string;
    abbreviation?: string;
    display_order?: number;
    wait_eligible?: boolean;
    requires_explanation?: boolean;
    concern_categories?: string[] | null;
    active?: boolean;
    updated_by_oauth_client_id: string;
    updated_by_name: string;
  },
): Promise<
  | { action: "updated"; service_id: string; fields_changed: string[] }
  | { action: "not_found"; service_key: string }
  | { action: "no_changes"; service_id: string }
> {
  const { data: existing, error: lookupErr } = await sb
    .from("routine_services")
    .select(
      "id, display_name, abbreviation, display_order, wait_eligible, requires_explanation, concern_categories, active",
    )
    .eq("shop_id", shopId)
    .eq("service_key", args.service_key)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(`routine_services lookup failed: ${lookupErr.message}`);
  }
  if (!existing) {
    return { action: "not_found", service_key: args.service_key };
  }

  const existingRow = existing as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  const changed: string[] = [];

  const setIfChanged = <K extends string>(field: K, incoming: unknown) => {
    if (incoming === undefined) return;
    if (JSON.stringify(incoming) === JSON.stringify(existingRow[field])) return;
    update[field] = incoming;
    changed.push(field);
  };

  setIfChanged("display_name", args.display_name);
  setIfChanged("abbreviation", args.abbreviation);
  setIfChanged("display_order", args.display_order);
  setIfChanged("wait_eligible", args.wait_eligible);
  setIfChanged("requires_explanation", args.requires_explanation);
  setIfChanged("concern_categories", args.concern_categories);
  setIfChanged("active", args.active);

  if (changed.length === 0) {
    return { action: "no_changes", service_id: existing.id as string };
  }

  update.updated_at = new Date().toISOString();
  update.updated_by_oauth_client_id = args.updated_by_oauth_client_id;
  update.updated_by_name = args.updated_by_name;

  const { error } = await sb
    .from("routine_services")
    .update(update)
    .eq("id", existing.id as string);
  if (error) {
    throw new Error(`routine_services patch failed: ${error.message}`);
  }
  return {
    action: "updated",
    service_id: existing.id as string,
    fields_changed: changed,
  };
}

/**
 * Soft-delete a routine-service chip. Hides it from the picker but
 * preserves historical references.
 */
export async function deactivateRoutineService(
  sb: SupabaseClient,
  shopId: number,
  args: { service_key: string },
): Promise<{ success: true }> {
  const { error } = await sb
    .from("routine_services")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("shop_id", shopId)
    .eq("service_key", args.service_key);
  if (error) {
    throw new Error(`routine_services deactivate failed: ${error.message}`);
  }
  return { success: true };
}

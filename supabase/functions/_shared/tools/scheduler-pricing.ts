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
 */
export async function listRoutineServices(
  sb: SupabaseClient,
  shopId: number,
): Promise<{ services: RoutineServiceRow[] }> {
  const { data, error } = await sb
    .from("routine_services")
    .select("service_key, display_name, abbreviation, display_order, active")
    .eq("shop_id", shopId)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (error) {
    throw new Error(`routine_services list failed: ${error.message}`);
  }
  return { services: (data ?? []) as RoutineServiceRow[] };
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

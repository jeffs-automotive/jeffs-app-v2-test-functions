/**
 * Tiny in-process cache for the routine_services chip list.
 *
 * The routine-service chips don't change often (a Service Dept admin
 * tweaks them rarely via upsert_routine_service). Cache for 5 minutes
 * to avoid a DB round-trip on every chat turn.
 *
 * Reset on:
 *   - 5-minute TTL
 *   - explicit __resetForTests() (Vitest only)
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

export interface RoutineServiceChip {
  service_key: string;
  display_name: string;
  /** Used when the orchestrator builds the Tekmetric appointment title. */
  abbreviation: string;
}

interface CacheEntry {
  fetchedAt: number;
  rows: RoutineServiceChip[];
}

const TTL_MS = 5 * 60_000;

let cache: CacheEntry | null = null;

/**
 * Returns the active routine_services rows (chip list) for the chat agent's
 * show_service_and_concern_picker tool input.
 */
export async function getRoutineServicesForChips(): Promise<
  RoutineServiceChip[]
> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.rows;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("routine_services")
    .select("service_key, display_name, abbreviation")
    .eq("shop_id", SHOP_ID)
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(
      `getRoutineServicesForChips failed: ${error.message}`,
    );
  }

  const rows = (data ?? []) as RoutineServiceChip[];
  cache = { fetchedAt: Date.now(), rows };
  return rows;
}

/** Vitest-only: clear the cache between tests. */
export function __resetRoutineServicesCacheForTests(): void {
  cache = null;
}

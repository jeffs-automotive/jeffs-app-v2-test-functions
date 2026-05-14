/**
 * resolveServiceCategory — Phase 9a (2026-05-14).
 *
 * Maps a picked service_key to a concern_questions category by reading the
 * concern_categories TEXT[] column on either testing_services or
 * routine_services. Per chat-design.md redesign D1: both routes feed the
 * SAME diagnostic gap-detection flow; this helper hides which table holds
 * the mapping for a given service_key.
 *
 * Lookup order: testing_services first (the more common diagnostic path),
 * then routine_services (the requires_explanation=true fallback). Returns
 * `null` when no row matches OR when the matched row's concern_categories
 * is null/empty — the caller should classify the concern as 'other' in
 * that case (the diagnostic LLM gracefully handles the catch-all category).
 *
 * Single-shop assumption (Phase 1): hardcodes shop_id=7476. A future
 * multi-shop refactor reads the shop from the session row's shop_id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const SHOP_ID = 7476;

interface CategoriesRow {
  concern_categories: string[] | null;
}

export async function resolveServiceCategory(
  supabase: SupabaseClient,
  serviceKey: string,
): Promise<string | null> {
  if (!serviceKey || serviceKey.trim().length === 0) return null;

  const testingRes = await supabase
    .from("testing_services")
    .select("concern_categories")
    .eq("shop_id", SHOP_ID)
    .eq("service_key", serviceKey)
    .eq("active", true)
    .maybeSingle();

  if (testingRes.error) {
    throw new Error(
      `testing_services lookup failed for ${serviceKey}: ${testingRes.error.message}`,
    );
  }
  if (testingRes.data) {
    const cats = (testingRes.data as unknown as CategoriesRow).concern_categories;
    if (cats && cats.length > 0) return cats[0] ?? null;
  }

  const routineRes = await (supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: number) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: boolean) => {
              maybeSingle: () => Promise<{
                data: CategoriesRow | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
  })
    .from("routine_services")
    .select("concern_categories")
    .eq("shop_id", SHOP_ID)
    .eq("service_key", serviceKey)
    .eq("active", true)
    .maybeSingle();

  if (routineRes.error) {
    throw new Error(
      `routine_services lookup failed for ${serviceKey}: ${routineRes.error.message}`,
    );
  }
  if (routineRes.data) {
    const cats = routineRes.data.concern_categories;
    if (cats && cats.length > 0) return cats[0] ?? null;
  }

  return null;
}

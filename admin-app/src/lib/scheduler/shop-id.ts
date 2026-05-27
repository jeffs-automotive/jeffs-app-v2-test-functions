/**
 * resolveAdminShopId — single source of truth for shop_id in admin-app.
 *
 * Single-shop product per plan v0.5 §2 "Out of scope: Multi-shop config".
 * shop_id scoping is NOT out of scope — every Supabase query MUST be
 * filtered by it. This helper centralizes the resolution.
 *
 * Resolution order:
 *   1. SCHEDULER_ADMIN_SHOP_ID env var (preferred — overridable per env)
 *   2. 7476 fallback (the test sandbox shop; documented in
 *      .claude/memory/scheduler_project_state.md as the canonical Jeff's
 *      Automotive shop_id for this test project)
 *
 * Multi-shop migration plan (deferred per plan §2): replace this helper
 * with a per-session lookup that joins admin_users.email → shops.id,
 * cached at the requireAdmin() layer. The single call site below would
 * then become an arg passed in from requireAdmin().
 *
 * Per ROUND-2-RESIDUALS R-BL-1: block/unblock_appointment_capacity tools
 * derive shop_id server-side via the orchestrator's actor-email
 * resolution, NOT from any client-supplied form field. The Direct
 * Supabase reads below use this resolver instead, but the SAME server-
 * only constraint applies — no client-supplied shop_id is honored.
 */

export function resolveAdminShopId(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SCHEDULER_ADMIN_SHOP_ID;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    throw new Error(
      `SCHEDULER_ADMIN_SHOP_ID env var is set to "${raw}" but is not a positive integer.`,
    );
  }
  // Fallback to the test-sandbox canonical shop. Multi-shop migration
  // requires removing this fallback + making the env var REQUIRED, or
  // replacing this helper with a per-session lookup (see file header).
  return 7476;
}

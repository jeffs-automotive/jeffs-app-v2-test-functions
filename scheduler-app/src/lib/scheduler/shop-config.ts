/**
 * Single source of truth for the Tekmetric `shop_id` used across the
 * scheduler-app Vercel surface.
 *
 * P2.8 post-validator fix (2026-05-25). Replaces 13 duplicate
 * `const SHOP_ID = 7476;` declarations scattered across the codebase.
 * Each duplicate was a tiny ticking time bomb for multi-shop migration:
 * a future refactor that updated 12 of 13 and missed one would route
 * one path's Tekmetric calls to the wrong shop. Centralizing the
 * constant collapses the maintenance surface to ONE file.
 *
 * Resolution order:
 *
 *   1. `TEKMETRIC_SHOP_ID` env var (canonical — already in use by the
 *      Deno edge fns via `_shared/tekmetric.ts` ENV_NAMES). Parsed as
 *      int. Lets per-environment overrides land without code change.
 *   2. Hardcoded fallback 7476 (Jeff's Automotive). Phase 1 single-shop
 *      posture; remove the fallback when multi-shop ships AND a missing
 *      env var should be a hard error rather than a quiet default.
 *
 * Multi-shop migration path (future Phase 2+): replace `SHOP_ID` with
 * a `getShopIdForCurrentSession()` async helper that reads
 * `customer_chat_sessions.shop_id` for the active chat. The constant
 * here would then become the Phase-1 fallback only, gated by an
 * "are we in the multi-shop posture?" feature flag.
 *
 * The pattern currently in `wizard/append-bubble.ts:45` (read shop_id
 * from session row, fallback to the default) is the canonical
 * multi-tenant-ready shape. New code should prefer that pattern over
 * importing `SHOP_ID` directly — the constant is for paths where the
 * caller doesn't have a chatId in scope (e.g., catalog scripts, cron
 * helpers, RSC layouts before session hydrate).
 */

const PARSED_ENV_SHOP_ID = (() => {
  const raw = process.env.TEKMETRIC_SHOP_ID;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
})();

/**
 * Tekmetric shop_id for THIS Vercel deployment. Currently a single
 * value because Phase 1 is single-shop. Multi-shop migration replaces
 * this with a session-bound resolver.
 */
export const SHOP_ID: number = PARSED_ENV_SHOP_ID ?? 7476;

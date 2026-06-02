-- =====================================================================
-- pgTAP tests for the SEC-7 per-phone rate limiter
-- =====================================================================
-- Verifies 20260602015500_scheduler_rate_limit_buckets.sql:
--   - rate_limit_buckets table + check_and_increment_rate_limit RPC exist
--   - Architectural claim (cross-module-anchors.md §E): the RPC allows
--     exactly p_max attempts per key within the window, then DENIES the
--     next, returning retry_after_seconds > 0 — and a denied call does
--     NOT record an attempt.
--   - Attempts older than the window do not count (sliding window).
--
-- Assert RETURN VALUES, not exceptions. Tests run as the migration role
-- (BYPASSRLS), so we seed backdated rows directly to simulate window age.
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence ──────────────────────────────────────────────────────────
SELECT has_table('public', 'rate_limit_buckets', 'rate_limit_buckets table exists');
SELECT has_function(
  'public', 'check_and_increment_rate_limit',
  ARRAY['text', 'integer', 'integer'],
  'check_and_increment_rate_limit(text,int,int) exists'
);

-- ─── Allow exactly p_max, then deny (key A, max=3, window=1h) ────────────
SELECT is(
  (SELECT allowed FROM public.check_and_increment_rate_limit('test:A', 3600, 3)),
  true, '1st attempt allowed');
SELECT is(
  (SELECT allowed FROM public.check_and_increment_rate_limit('test:A', 3600, 3)),
  true, '2nd attempt allowed');
SELECT is(
  (SELECT allowed FROM public.check_and_increment_rate_limit('test:A', 3600, 3)),
  true, '3rd attempt allowed');
SELECT is(
  (SELECT allowed FROM public.check_and_increment_rate_limit('test:A', 3600, 3)),
  false, '4th attempt denied (over max)');

-- retry_after_seconds is in (0, window] on denial
SELECT cmp_ok(
  (SELECT retry_after_seconds FROM public.check_and_increment_rate_limit('test:A', 3600, 3)),
  '>', 0, 'denied attempt returns retry_after_seconds > 0');
SELECT cmp_ok(
  (SELECT retry_after_seconds FROM public.check_and_increment_rate_limit('test:A', 3600, 3)),
  '<=', 3600, 'denied retry_after_seconds <= window');

-- Denied calls do NOT record an attempt — only the 3 allowed ones exist.
SELECT is(
  (SELECT count(*)::int FROM public.rate_limit_buckets WHERE key = 'test:A'),
  3, 'denied attempts are not recorded (count stays at max)');

-- ─── Sliding window: attempts older than the window do not count ────────
-- Seed 5 attempts for key B, all 2h old (outside a 1h window).
INSERT INTO public.rate_limit_buckets (key, occurred_at)
SELECT 'test:B', now() - interval '2 hours' FROM generate_series(1, 5);

SELECT is(
  (SELECT allowed FROM public.check_and_increment_rate_limit('test:B', 3600, 3)),
  true, 'attempts older than the window are ignored → allowed');

-- ─── Per-key isolation: a different key has its own budget ──────────────
SELECT is(
  (SELECT allowed FROM public.check_and_increment_rate_limit('test:C', 3600, 3)),
  true, 'a fresh key is allowed regardless of other keys being maxed');

SELECT * FROM finish();
ROLLBACK;

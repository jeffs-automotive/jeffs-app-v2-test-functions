-- =====================================================================
-- pgTAP — keytag manual-review AUTO-RESOLUTION
-- =====================================================================
-- Covers 20260623180000_keytag_auto_resolve_reviews.sql (auto_resolve_manual_review)
-- + 20260623190000_auto_resolve_reviews_for_ro.sql.
--
-- The invariants this guards:
--   1) auto_resolve closes a TAGGED review as moot (system:auto / auto_cleared)
--      + writes a paired manual_review_resolved audit row.
--   2) a tag-less ARN review resolves but writes NO audit row (keytag_audit_log
--      requires tag_color/tag_number NOT NULL — mirrors create_manual_review).
--   3) idempotent: a 2nd call returns already_resolved, never double-resolves.
--   4) it NEVER mutates a key tag (writes no tag-mutation audit action).
--   5) invalid source is rejected.
--   6) auto_resolve_reviews_for_ro closes EVERY open review for one RO.
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- Fixtures: a TAGGED drift review + a tag-less ARN, both on RO 990001.
INSERT INTO public.keytag_manual_reviews (code, category, context, options, issue_summary)
VALUES
  ('DRF-TEST01', 'work_approved_drift',
   '{"ro_id": 990001, "ro_number": 990001, "tag_color": "red", "tag_number": 5}'::jsonb,
   '[]'::jsonb, 'test drift'),
  ('ARN-TEST01', 'ar_no_prior_tag',
   '{"ro_id": 990001, "ro_number": 990001}'::jsonb,
   '[]'::jsonb, 'test arn (no tag)');

-- ── 1) tagged review → ok + resolved metadata + paired audit row ──────────
SELECT is(
  (SELECT ok FROM public.auto_resolve_manual_review('DRF-TEST01', 'moot_ro_closed:test', 'manual_sql')),
  true, 'auto_resolve: tagged review returns ok=true (and resolves it)');
SELECT is(
  (SELECT resolved_by_user_label FROM keytag_manual_reviews WHERE code='DRF-TEST01'),
  'system:auto', 'auto_resolve: resolved_by_user_label = system:auto');
SELECT is(
  (SELECT resolved_choice FROM keytag_manual_reviews WHERE code='DRF-TEST01'),
  'auto_cleared', 'auto_resolve: resolved_choice = auto_cleared');
SELECT isnt(
  (SELECT resolved_at FROM keytag_manual_reviews WHERE code='DRF-TEST01'),
  NULL, 'auto_resolve: resolved_at is set');
SELECT isnt(
  (SELECT resolution_audit_log_id FROM keytag_manual_reviews WHERE code='DRF-TEST01'),
  NULL, 'auto_resolve: tagged review got a paired audit row');
SELECT is(
  (SELECT action FROM keytag_audit_log WHERE manual_review_code='DRF-TEST01'),
  'manual_review_resolved', 'auto_resolve: audit action = manual_review_resolved');

-- ── 2) tag-less ARN → resolved but NO audit row ───────────────────────────
SELECT is(
  (SELECT ok FROM public.auto_resolve_manual_review('ARN-TEST01', 'moot_ro_closed:test', 'manual_sql')),
  true, 'auto_resolve: ARN returns ok=true');
SELECT is(
  (SELECT resolution_audit_log_id FROM keytag_manual_reviews WHERE code='ARN-TEST01'),
  NULL, 'auto_resolve: tag-less ARN writes NO audit row');
SELECT is(
  (SELECT count(*)::int FROM keytag_audit_log WHERE manual_review_code='ARN-TEST01'),
  0, 'auto_resolve: no keytag_audit_log row for the tag-less ARN');

-- ── 3) idempotent — 2nd call → already_resolved ───────────────────────────
SELECT is(
  (SELECT failure_reason FROM public.auto_resolve_manual_review('DRF-TEST01', 'x', 'manual_sql')),
  'already_resolved', 'auto_resolve: 2nd call → already_resolved');

-- ── 4) NEVER mutates a tag (no tag-mutation audit action written) ──────────
SELECT is(
  (SELECT count(*)::int FROM keytag_audit_log
     WHERE manual_review_code IN ('DRF-TEST01','ARN-TEST01')
       AND action IN ('released','released_orphan','assigned','force_assigned','marked_posted','reverted')),
  0, 'auto_resolve: NEVER writes a tag-mutation audit action (auto-RESOLVE, not auto-FIX)');

-- ── 5) invalid source rejected ────────────────────────────────────────────
SELECT is(
  (SELECT failure_reason FROM public.auto_resolve_manual_review('DRF-TEST01', 'x', 'bogus_source')),
  'invalid_source', 'auto_resolve: invalid source rejected');

-- ── 6) auto_resolve_reviews_for_ro closes EVERY open review for one RO ─────
INSERT INTO public.keytag_manual_reviews (code, category, context, options, issue_summary)
VALUES
  ('REG-TEST02', 'ar_regression',
   '{"ro_id": 990002, "ro_number": 990002, "tag_color": "yellow", "tag_number": 7}'::jsonb,
   '[]'::jsonb, 'test reg'),
  ('DRF-TEST02', 'work_approved_drift',
   '{"ro_id": 990002, "ro_number": 990002}'::jsonb,
   '[]'::jsonb, 'test drift 2');
SELECT is(
  public.auto_resolve_reviews_for_ro(990002, 'moot_ro_closed:test', 'cron'),
  2, 'auto_resolve_reviews_for_ro: closes BOTH open reviews for the RO (returns 2)');
SELECT is(
  (SELECT count(*)::int FROM keytag_manual_reviews
     WHERE context->>'ro_id'='990002' AND resolved_at IS NULL),
  0, 'auto_resolve_reviews_for_ro: no open reviews left for the RO');

SELECT * FROM finish();
ROLLBACK;

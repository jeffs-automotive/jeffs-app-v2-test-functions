-- Composite functional index supporting the (category, context->>'ro_id')
-- dedup query in _shared/manual-review.ts `issueManualReview`.
--
-- Without this index, every dedup call sequentially scans
-- keytag_manual_reviews. Today's table is small (~200 rows) so the impact
-- is invisible, but the table grows by anomalies-per-day (until the
-- dedup fix shipped 2026-05-13 deploys, ~96 ARN rows per day). With this
-- index the dedup is a single index lookup per call.
--
-- The third column (issued_at DESC) supports the ORDER BY + LIMIT 1 in
-- the dedup query — Postgres can satisfy the entire query from the index
-- without touching the heap (index-only scan when only id/code/category
-- columns are projected, which is what the dedup needs from the table
-- expression itself; the helper then projects more columns when it
-- short-circuits, which reads the heap once per dedup hit).
--
-- Functional index on `context->>'ro_id'` works because Postgres stores
-- the extracted text value and can use it for equality lookups directly.
-- We don't index on the JSONB column itself (would require a GIN index
-- with operator-class jsonb_path_ops, larger and not as targeted).

CREATE INDEX IF NOT EXISTS keytag_manual_reviews_category_ro_id_idx
  ON public.keytag_manual_reviews
     (category, (context->>'ro_id'), issued_at DESC);

COMMENT ON INDEX public.keytag_manual_reviews_category_ro_id_idx IS
  'Supports the category-aware dedup query in issueManualReview() — equality lookup on (category, context->>ro_id) plus most-recent ordering.';

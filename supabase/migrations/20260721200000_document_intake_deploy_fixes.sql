-- =====================================================================
-- document-intake — deploy-revealed fixes (§1e bootstrap, 2026-07-21)
-- =====================================================================
-- Two failures the first LIVE bootstrap surfaced (local mocks couldn't):
--
-- F1  `ON CONFLICT (mailbox)` cannot match the functional unique index on
--     lower(mailbox) — PostgREST upserts need a plain UNIQUE constraint.
--     Every writer lowercases before storing; the lower() index stays as a
--     belt against any future mixed-case manual insert.
--
-- F2  PostgREST does not expose the `storage` schema on this project
--     (api schemas = public, graphql_public), so the reconcile step cannot
--     read storage.objects through the Data API. Replaced with a SECURITY
--     DEFINER RPC that performs the orphan diff entirely in SQL — also
--     kills the two paginated round-trip sets. Rows are capped by the
--     caller's PostgREST max_rows (1000/run); orphans are normally ~0 and
--     the watchdog reports the count, so a >1000 backlog drains across
--     days rather than silently truncating one run's VIEW of reality.
--
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── F1: plain unique constraint for the upsert target ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'graph_mail_subscriptions_mailbox_key'
      AND conrelid = 'public.graph_mail_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.graph_mail_subscriptions
      ADD CONSTRAINT graph_mail_subscriptions_mailbox_key UNIQUE (mailbox);
  END IF;
END
$$;

-- ─── F2: server-side orphan diff ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.document_intake_orphan_objects(p_bucket text)
RETURNS TABLE (name text, mimetype text, size_bytes bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.name,
         o.metadata->>'mimetype',
         (o.metadata->>'size')::bigint
  FROM storage.objects o
  LEFT JOIN public.document_intake_files f ON f.object_path = o.name
  WHERE o.bucket_id = p_bucket
    AND f.id IS NULL
  ORDER BY o.name;
$$;

REVOKE EXECUTE ON FUNCTION public.document_intake_orphan_objects(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.document_intake_orphan_objects(text) TO service_role;

COMMENT ON FUNCTION public.document_intake_orphan_objects(text) IS
  'Storage objects in the bucket with no document_intake_files row (plan D3 '
  'reconciliation, deploy-fix F2). SECURITY DEFINER because the storage '
  'schema is not exposed through the Data API on this project.';

COMMIT;

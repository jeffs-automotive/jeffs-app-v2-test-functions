-- =====================================================================
-- document-intake — verify-round-1 fixes (blockers + schema support)
-- =====================================================================
-- 2026-07-21. Review findings (pattern-review + security-review +
-- supabase-compliance, independently corroborated):
--
-- B1  Session advisory locks CANNOT serialize edge-fn cron runs: each
--     PostgREST rpc() lands on a pooled backend, so acquire/release hit
--     different sessions — the lock leaks on a long-lived pooled backend
--     and every later run gets false (wedged after the first live run).
--     REPLACED with a lease-row claim: single atomic UPDATE with TTL,
--     crash-safe by expiry, pooling-immune.
--     (Refs: supabase.com/docs/guides/database/connecting-to-postgres —
--     session state does not span pooled connections.)
--
-- S1  graph_mail_subscriptions.shop_id — tenant attribution for unrouted
--     mail must come from stored config, never an env fallback or an
--     arbitrary profile row (shop-agnostic.md).
--
-- S2  document_intake_agent_state.shop_id now NULLABLE — the agent host
--     is infrastructure; when the active profiles span multiple shops the
--     row stores NULL rather than misattributing a tenant.
--
-- T1  Registrar trigger v2: storage populates objects.metadata AFTER the
--     initial insert (supabase discussions #6540/#33671), so the belt row
--     from AFTER INSERT sees NULL mime/size. The registrar now also fires
--     AFTER UPDATE OF metadata and backfills ONLY missing fields via
--     ON CONFLICT DO UPDATE + COALESCE (explicit rich rows always win).
--
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── B1: session locks OUT ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.document_intake_try_cron_lock();
DROP FUNCTION IF EXISTS public.document_intake_release_cron_lock();

CREATE TABLE IF NOT EXISTS public.document_intake_cron_lease (
  id           boolean     PRIMARY KEY DEFAULT true,
  locked_until timestamptz NOT NULL DEFAULT '-infinity',
  locked_by    text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_intake_cron_lease_singleton CHECK (id = true)
);
INSERT INTO public.document_intake_cron_lease (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.document_intake_cron_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_intake_cron_lease FROM anon, authenticated;

COMMENT ON TABLE public.document_intake_cron_lease IS
  'Singleton lease serializing the document-intake cron (plan D8, fix B1). '
  'Claimed by one atomic UPDATE with a TTL — pooling-immune and crash-safe '
  '(an expired lease is claimable regardless of what died holding it).';

CREATE OR REPLACE FUNCTION public.document_intake_claim_cron_lease(
  p_run_id text,
  p_ttl_minutes integer DEFAULT 45
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.document_intake_cron_lease
  SET locked_until = now() + make_interval(mins => p_ttl_minutes),
      locked_by    = p_run_id,
      updated_at   = now()
  WHERE id = true
    AND locked_until < now()
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.document_intake_release_cron_lease(
  p_run_id text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.document_intake_cron_lease
  SET locked_until = '-infinity',
      locked_by    = NULL,
      updated_at   = now()
  WHERE id = true
    AND locked_by = p_run_id
  RETURNING true;
$$;

REVOKE EXECUTE ON FUNCTION public.document_intake_claim_cron_lease(text, integer)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.document_intake_release_cron_lease(text)         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.document_intake_claim_cron_lease(text, integer)  TO service_role;
GRANT  EXECUTE ON FUNCTION public.document_intake_release_cron_lease(text)         TO service_role;

COMMENT ON FUNCTION public.document_intake_claim_cron_lease(text, integer) IS
  'Atomic cron-lease claim (fix B1). Returns true when this run_id took the '
  'lease; NULL/no-row when another unexpired run holds it. TTL must exceed '
  'the longest plausible cron cycle; release is by matching run_id only.';

-- ─── S1/S2: tenant attribution comes from stored config ─────────────────────
ALTER TABLE public.graph_mail_subscriptions
  ADD COLUMN IF NOT EXISTS shop_id integer;
COMMENT ON COLUMN public.graph_mail_subscriptions.shop_id IS
  'Tenant of the subscribed mailbox, captured at subscription time from the '
  'mailbox''s profile (fix S1). Unrouted mail inherits THIS — never an env '
  'var, never an arbitrary profile row (shop-agnostic.md).';

ALTER TABLE public.document_intake_agent_state
  ALTER COLUMN shop_id DROP NOT NULL;
COMMENT ON COLUMN public.document_intake_agent_state.shop_id IS
  'NULL when the gateway''s active profiles span multiple shops (fix S2) — '
  'the host is infrastructure; tenant misattribution is worse than NULL.';

-- ─── T1: registrar v2 — metadata-timing aware, backfills bare rows ──────────
CREATE OR REPLACE FUNCTION public.document_intake_register_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens   text[];
  v_shop_id  integer;
  v_profile  text;
  v_source   text;
  v_mime     text;
  v_size     bigint;
BEGIN
  v_tokens := string_to_array(NEW.name, '/');
  v_shop_id := v_tokens[1]::integer;

  SELECT p.key INTO v_profile
  FROM public.document_intake_profiles p
  WHERE p.key = v_tokens[2];

  v_source := CASE
    WHEN v_tokens[3] IN ('scan','email') THEN v_tokens[3]
    ELSE 'other'
  END;

  v_mime := NEW.metadata->>'mimetype';
  v_size := (NEW.metadata->>'size')::bigint;

  -- Explicit rich rows always win; bare belt rows get missing fields
  -- backfilled when storage writes metadata after the initial insert (T1).
  INSERT INTO public.document_intake_files AS f
    (shop_id, profile_key, source, bucket, object_path, mime_type, size_bytes, status)
  VALUES
    (v_shop_id, v_profile, v_source, NEW.bucket_id, NEW.name, v_mime, v_size, 'pending')
  ON CONFLICT (object_path) DO UPDATE
    SET mime_type  = COALESCE(f.mime_type,  EXCLUDED.mime_type),
        size_bytes = COALESCE(f.size_bytes, EXCLUDED.size_bytes),
        updated_at = now()
    WHERE f.mime_type IS NULL OR f.size_bytes IS NULL;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.document_intake_error_log (origin, origin_id, error_code, message, detail)
      VALUES ('storage_trigger', NEW.name, SQLSTATE, SQLERRM,
              jsonb_build_object('bucket', NEW.bucket_id));
    EXCEPTION WHEN OTHERS THEN
      NULL; -- last resort: never block an upload for a log line
    END;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_intake_on_object_metadata ON storage.objects;
CREATE TRIGGER document_intake_on_object_metadata
  AFTER UPDATE OF metadata ON storage.objects
  FOR EACH ROW
  WHEN (NEW.bucket_id = 'vehicle-docs')
  EXECUTE FUNCTION public.document_intake_register_object();

-- Registration sanity: both triggers present.
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE t.tgname IN ('document_intake_on_object_created','document_intake_on_object_metadata')
    AND n.nspname = 'storage' AND c.relname = 'objects';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'document-intake registrar triggers incomplete (rows=%)', v_count;
  END IF;
END
$$;

COMMIT;

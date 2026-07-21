-- =====================================================================
-- document-intake — storage.objects catch-all registrar trigger (P1, D3)
-- =====================================================================
-- 2026-07-21. Plan: docs/document-intake/document-intake-plan.md (v2).
--
-- PRIMARY row creation is explicit (the document-intake-agent gateway and
-- document-intake-email fn insert document_intake_files rows themselves,
-- with rich metadata). This trigger is the BELT: any object that lands in
-- the vehicle-docs bucket by any other path still gets a bare 'pending'
-- row (ON CONFLICT DO NOTHING makes the two paths converge). The daily
-- cron additionally reconciles storage.objects <-> intake rows.
--
-- SECURITY DEFINER is REQUIRED (cross-verify, both reviewers): the trigger
-- fires under the storage-API role (e.g. supabase_storage_admin), which has
-- NO privileges on the deny-all-RLS intake tables. DEFINER runs the body as
-- the function owner (postgres, BYPASSRLS). search_path pinned per
-- cross-module-anchors.md; EXECUTE revoked from client roles.
--
-- The body NEVER raises: any failure lands in document_intake_error_log
-- (nested guard — if even that insert fails we swallow, because breaking
-- customer uploads to preserve a log line is the wrong trade). The daily
-- reconciliation catches anything the swallow hid. pgTAP exercises the
-- trigger UNDER the real storage role (document_intake.test.sql).
--
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

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

  -- {shop_id}/{profile_key|unrouted}/{channel}/... (plan D2). Anything that
  -- doesn't parse is still an error-log entry, never a blocked upload.
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

  INSERT INTO public.document_intake_files
    (shop_id, profile_key, source, bucket, object_path, mime_type, size_bytes, status)
  VALUES
    (v_shop_id, v_profile, v_source, NEW.bucket_id, NEW.name, v_mime, v_size, 'pending')
  ON CONFLICT (object_path) DO NOTHING;

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

-- Client roles never call this directly; the trigger machinery does.
REVOKE EXECUTE ON FUNCTION public.document_intake_register_object() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.document_intake_register_object() FROM anon;
REVOKE EXECUTE ON FUNCTION public.document_intake_register_object() FROM authenticated;

DROP TRIGGER IF EXISTS document_intake_on_object_created ON storage.objects;
CREATE TRIGGER document_intake_on_object_created
  AFTER INSERT ON storage.objects
  FOR EACH ROW
  WHEN (NEW.bucket_id = 'vehicle-docs')
  EXECUTE FUNCTION public.document_intake_register_object();

-- Registration sanity check.
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE t.tgname = 'document_intake_on_object_created'
    AND n.nspname = 'storage' AND c.relname = 'objects';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'document_intake_on_object_created trigger failed to register (rows=%)', v_count;
  END IF;
END
$$;

COMMIT;

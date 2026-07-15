-- Atomic per-RO mirror write (2026-07-15, finish-round — clears the
-- non-atomic-multi-write finding on the Tekmetric mirror).
--
-- BEFORE: upsertPage (mirror-ingest.ts) replaced each RO's mirror rows with ~17
-- separate Supabase calls — a parent upsert, then a delete + insert per child
-- table. A failure mid-sequence (e.g. a child insert) left the RO's normalized
-- mirror PARTIALLY replaced (parent + some children), which a payroll compute or
-- completion could then read as wrong billed hours / sales until the next sync.
--
-- AFTER: the JS mappers are UNCHANGED (single-sourced) — they still build the same
-- per-column snake_case rows. This function just WRITES one RO's already-mapped rows
-- inside ONE transaction: a plpgsql function body is atomic, so a RAISE anywhere
-- (a bad row, an FK violation) rolls back the ENTIRE replacement — no partial RO.
-- Deleting the parent CASCADEs every child (the 5 direct child tables + their
-- grandchildren via the FK ON DELETE CASCADE chain), so a re-apply is a clean
-- full-replace that also drops line items Tekmetric removed. `synced_at` rides IN
-- the payload (the mapper sets it), so the re-inserted parent is byte-identical to
-- the prior PostgREST upsert. Extra payload keys are ignored by jsonb_populate_*,
-- and a missing NOT-NULL column RAISEs exactly as the old upsert did.
--
-- Granularity is PER RO (not per page): small payloads (no request-body-size risk on
-- a 100-RO nightly page) and a bad RO is isolated to itself — upsertPage records the
-- RPC error to the same ingest-alert surface and continues with the next RO.

CREATE OR REPLACE FUNCTION public.qteklink_mirror_apply_ro(
  p_ro             jsonb,
  p_jobs           jsonb,
  p_labor          jsonb,
  p_parts          jsonb,
  p_job_fees       jsonb,
  p_job_discounts  jsonb,
  p_fees           jsonb,
  p_discounts      jsonb,
  p_concerns       jsonb,
  p_sublets        jsonb,
  p_sublet_items   jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ro_id bigint := (p_ro->>'id')::bigint;
BEGIN
  IF v_ro_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_mirror_apply_ro: p_ro.id is required';
  END IF;

  -- Full-replace: dropping the parent cascade-deletes ALL children (direct + grand).
  DELETE FROM public.tekmetric_ros WHERE id = v_ro_id;

  INSERT INTO public.tekmetric_ros
  SELECT * FROM jsonb_populate_record(NULL::public.tekmetric_ros, p_ro);

  -- Children: jobs before their labor/parts/fees/discounts; sublets before items.
  INSERT INTO public.tekmetric_ro_jobs
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_jobs, coalesce(p_jobs, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_job_labor
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_job_labor, coalesce(p_labor, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_job_parts
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_job_parts, coalesce(p_parts, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_job_fees
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_job_fees, coalesce(p_job_fees, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_job_discounts
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_job_discounts, coalesce(p_job_discounts, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_fees
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_fees, coalesce(p_fees, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_discounts
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_discounts, coalesce(p_discounts, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_customer_concerns
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_customer_concerns, coalesce(p_concerns, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_sublets
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_sublets, coalesce(p_sublets, '[]'::jsonb));
  INSERT INTO public.tekmetric_ro_sublet_items
    SELECT * FROM jsonb_populate_recordset(NULL::public.tekmetric_ro_sublet_items, coalesce(p_sublet_items, '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_mirror_apply_ro(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_mirror_apply_ro(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
  TO service_role;

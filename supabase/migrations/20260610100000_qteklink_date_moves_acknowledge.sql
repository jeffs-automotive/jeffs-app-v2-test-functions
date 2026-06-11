-- =====================================================================
-- QTekLink — RO date-move queue + acknowledged days + notification settings
-- =====================================================================
-- 2026-06-10. Chris's spec (corrections + notifications):
--   * An RO unposted in Tekmetric and RE-POSTED TO A DIFFERENT DAY goes to the
--     POSTING QUEUE (`qteklink_ro_date_moves`): the office manager either APPROVES
--     the date change (both days' JEs then correct) or waits/refreshes until the
--     RO is re-posted to the correct day (auto-RESOLVED). Approvals can be
--     UNAPPROVED (accidental approval — flips the corrections back).
--     While a move is PENDING, both days are HELD: the original day keeps the RO
--     (pinned to its original-day snapshot), the new day excludes it.
--   * Past days are marked `acknowledged` — approved WITHOUT posting (Accounting
--     Link already posted them). Acknowledged is TERMINAL: the diff never
--     re-enqueues an acknowledged day, the sweep never emails about it.
--   * Notification recipients live in qteklink_settings (office manager + service
--     advisors) — edited on /settings.
--
-- Multi-tenant: shop_id + realm_id everywhere + the composite FK. service_role-only
-- (deny-all RLS); writes via SECURITY DEFINER RPCs. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── 1. The date-move queue ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_ro_date_moves (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                integer     NOT NULL,
  realm_id               text        NOT NULL,
  tekmetric_ro_id        bigint      NOT NULL,
  ro_number              text,
  -- the business day whose POSTED daily JE contains the RO today.
  original_business_date date        NOT NULL,
  -- the day the RO's latest Tekmetric posting now claims.
  new_business_date      date        NOT NULL,
  original_total_cents   bigint,
  new_total_cents        bigint,
  -- pending  → awaiting the office manager (both days HELD)
  -- approved → date change accepted (corrections applied; unapprove flips back)
  -- resolved → the RO was re-posted back to its original day (no date change)
  status                 text        NOT NULL DEFAULT 'pending',
  detected_at            timestamptz NOT NULL DEFAULT now(),
  approved_by            text,
  approved_at            timestamptz,
  resolved_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_date_moves_shop_positive  CHECK (shop_id > 0),
  CONSTRAINT qteklink_date_moves_realm_nonblank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_date_moves_ro_positive    CHECK (tekmetric_ro_id > 0),
  CONSTRAINT qteklink_date_moves_status_valid   CHECK (status IN ('pending','approved','resolved')),
  CONSTRAINT qteklink_date_moves_dates_differ   CHECK (new_business_date <> original_business_date),
  CONSTRAINT qteklink_date_moves_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT
);

-- One OPEN (pending/approved) move per RO + origin day; resolved rows keep history.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_date_moves_open_identity
  ON public.qteklink_ro_date_moves (shop_id, realm_id, tekmetric_ro_id, original_business_date)
  WHERE status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS qteklink_date_moves_status
  ON public.qteklink_ro_date_moves (shop_id, realm_id, status, detected_at);

COMMENT ON TABLE public.qteklink_ro_date_moves IS
  'QTekLink posting queue: ROs unposted in Tekmetric and re-posted to a DIFFERENT business day while their original day''s daily JE is posted in QBO. pending = both days held; approved = date change accepted (corrections applied); resolved = re-posted back to the original day.';

ALTER TABLE public.qteklink_ro_date_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_ro_date_moves FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_ro_date_moves TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_ro_date_moves FROM service_role;

-- Upsert a detected move. INSERTs a new pending row, or refreshes a PENDING row's
-- new date/totals (an RO can be re-posted again before review). Approved/resolved
-- rows are never touched here. Returns (id, changed) — `changed` tells the caller
-- whether to send the notification (no re-emails on unchanged nightly re-detects).
CREATE OR REPLACE FUNCTION public.qteklink_upsert_date_move(
  p_shop_id integer, p_realm_id text, p_tekmetric_ro_id bigint, p_ro_number text,
  p_original_business_date date, p_new_business_date date,
  p_original_total_cents bigint, p_new_total_cents bigint
)
RETURNS TABLE (id uuid, changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing public.qteklink_ro_date_moves;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0
     OR p_tekmetric_ro_id IS NULL OR p_tekmetric_ro_id <= 0
     OR p_original_business_date IS NULL OR p_new_business_date IS NULL
     OR p_new_business_date = p_original_business_date THEN
    RAISE EXCEPTION 'qteklink_upsert_date_move: shop/realm/ro and two DIFFERENT dates are required';
  END IF;

  SELECT * INTO v_existing FROM public.qteklink_ro_date_moves m
   WHERE m.shop_id = p_shop_id AND m.realm_id = p_realm_id
     AND m.tekmetric_ro_id = p_tekmetric_ro_id
     AND m.original_business_date = p_original_business_date
     AND m.status IN ('pending','approved')
   LIMIT 1;

  IF v_existing.id IS NULL THEN
    RETURN QUERY
      INSERT INTO public.qteklink_ro_date_moves
        (shop_id, realm_id, tekmetric_ro_id, ro_number, original_business_date,
         new_business_date, original_total_cents, new_total_cents)
      VALUES (p_shop_id, p_realm_id, p_tekmetric_ro_id, p_ro_number, p_original_business_date,
              p_new_business_date, p_original_total_cents, p_new_total_cents)
      RETURNING qteklink_ro_date_moves.id, true;
  ELSIF v_existing.status = 'pending'
        AND (v_existing.new_business_date IS DISTINCT FROM p_new_business_date
             OR v_existing.new_total_cents IS DISTINCT FROM p_new_total_cents) THEN
    UPDATE public.qteklink_ro_date_moves m
       SET new_business_date = p_new_business_date,
           new_total_cents = p_new_total_cents,
           ro_number = coalesce(p_ro_number, m.ro_number),
           updated_at = now()
     WHERE m.id = v_existing.id;
    RETURN QUERY SELECT v_existing.id, true;
  ELSE
    RETURN QUERY SELECT v_existing.id, false;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_date_move(integer, text, bigint, text, date, date, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_date_move(integer, text, bigint, text, date, date, bigint, bigint) TO service_role;

-- Approve the date change (pending → approved). The DAL then re-runs both days.
CREATE OR REPLACE FUNCTION public.qteklink_approve_date_move(
  p_shop_id integer, p_realm_id text, p_id uuid, p_approved_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_approved_by IS NULL OR length(btrim(p_approved_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_approve_date_move: p_id + non-blank p_approved_by are required';
  END IF;
  UPDATE public.qteklink_ro_date_moves
     SET status = 'approved', approved_by = p_approved_by, approved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_approve_date_move(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_approve_date_move(integer, text, uuid, text) TO service_role;

-- Unapprove an ACCIDENTAL approval (approved → pending). The DAL flips the days back.
CREATE OR REPLACE FUNCTION public.qteklink_unapprove_date_move(
  p_shop_id integer, p_realm_id text, p_id uuid, p_unapproved_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_unapproved_by IS NULL OR length(btrim(p_unapproved_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_unapprove_date_move: p_id + non-blank p_unapproved_by are required';
  END IF;
  UPDATE public.qteklink_ro_date_moves
     SET status = 'pending', approved_by = NULL, approved_at = NULL, updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'approved';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_unapprove_date_move(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_unapprove_date_move(integer, text, uuid, text) TO service_role;

-- Resolve: the RO is back on its original day (pending/approved → resolved).
CREATE OR REPLACE FUNCTION public.qteklink_resolve_date_move(
  p_shop_id integer, p_realm_id text, p_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_resolve_date_move: p_id is required';
  END IF;
  UPDATE public.qteklink_ro_date_moves
     SET status = 'resolved', resolved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status IN ('pending','approved');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_resolve_date_move(integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_resolve_date_move(integer, text, uuid) TO service_role;

-- ─── 2. Notification recipients on qteklink_settings ─────────────────────────
ALTER TABLE public.qteklink_settings
  ADD COLUMN IF NOT EXISTS office_manager_email text,
  ADD COLUMN IF NOT EXISTS advisor_emails       text;  -- comma-separated list

-- Extend the upsert RPC IN PLACE: drop the old 7-param signature and recreate with
-- the two new params DEFAULTed — the deployed app's 7-named-param calls keep matching
-- through the deploy window (PostgREST fills defaulted params).
DROP FUNCTION IF EXISTS public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer);
CREATE OR REPLACE FUNCTION public.qteklink_upsert_settings(
  p_shop_id integer,
  p_realm_id text,
  p_auto_post boolean,
  p_settle_window_minutes integer,
  p_shop_timezone text,
  p_sales_tax_rate_bps integer,
  p_tire_fee_cents integer,
  p_office_manager_email text DEFAULT NULL,
  p_advisor_emails text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_settle_window_minutes IS NOT NULL AND p_settle_window_minutes < 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: settle_window_minutes must be >= 0';
  END IF;
  IF (p_sales_tax_rate_bps IS NOT NULL AND p_sales_tax_rate_bps < 0)
     OR (p_tire_fee_cents IS NOT NULL AND p_tire_fee_cents < 0) THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: tax rate + tire fee must be >= 0';
  END IF;

  INSERT INTO public.qteklink_settings (
    shop_id, realm_id, auto_post, settle_window_minutes, shop_timezone, sales_tax_rate_bps,
    tire_fee_cents, office_manager_email, advisor_emails, updated_at
  )
  VALUES (
    p_shop_id, p_realm_id, coalesce(p_auto_post, false), coalesce(p_settle_window_minutes, 0),
    coalesce(nullif(btrim(p_shop_timezone), ''), 'America/New_York'),
    coalesce(p_sales_tax_rate_bps, 600), coalesce(p_tire_fee_cents, 100),
    nullif(btrim(coalesce(p_office_manager_email, '')), ''),
    nullif(btrim(coalesce(p_advisor_emails, '')), ''),
    now()
  )
  ON CONFLICT (shop_id, realm_id) DO UPDATE SET
    auto_post             = coalesce(p_auto_post, public.qteklink_settings.auto_post),
    settle_window_minutes = coalesce(p_settle_window_minutes, public.qteklink_settings.settle_window_minutes),
    shop_timezone         = coalesce(nullif(btrim(p_shop_timezone), ''), public.qteklink_settings.shop_timezone),
    sales_tax_rate_bps    = coalesce(p_sales_tax_rate_bps, public.qteklink_settings.sales_tax_rate_bps),
    tire_fee_cents        = coalesce(p_tire_fee_cents, public.qteklink_settings.tire_fee_cents),
    -- NULL = leave unchanged; an explicit empty string clears the recipient.
    office_manager_email  = CASE WHEN p_office_manager_email IS NULL THEN public.qteklink_settings.office_manager_email
                                 ELSE nullif(btrim(p_office_manager_email), '') END,
    advisor_emails        = CASE WHEN p_advisor_emails IS NULL THEN public.qteklink_settings.advisor_emails
                                 ELSE nullif(btrim(p_advisor_emails), '') END,
    updated_at            = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer, text, text) TO service_role;

-- ─── 3. Acknowledged days (approved WITHOUT posting — Accounting Link's days) ──
ALTER TABLE public.qteklink_daily_postings
  DROP CONSTRAINT IF EXISTS qteklink_daily_postings_status_valid;
ALTER TABLE public.qteklink_daily_postings
  ADD CONSTRAINT qteklink_daily_postings_status_valid
  CHECK (status IN ('pending','approved','posting','posted','needs_resolution','rejected','failed','acknowledged'));

-- pending → acknowledged. TERMINAL: the diff never re-enqueues an acknowledged
-- category and the sweep/notifications skip it (Accounting Link owns those days).
CREATE OR REPLACE FUNCTION public.qteklink_acknowledge_daily_posting(
  p_shop_id integer, p_realm_id text, p_id uuid, p_acknowledged_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_acknowledged_by IS NULL OR length(btrim(p_acknowledged_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_acknowledge_daily_posting: p_id + non-blank p_acknowledged_by are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'acknowledged', approved_by = p_acknowledged_by, approved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_acknowledge_daily_posting(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_acknowledge_daily_posting(integer, text, uuid, text) TO service_role;

COMMIT;

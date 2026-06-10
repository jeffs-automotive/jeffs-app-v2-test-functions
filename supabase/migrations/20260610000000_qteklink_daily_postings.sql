-- =====================================================================
-- QTekLink daily-JE rework step 2 — qteklink_daily_postings (the day-category ledger)
-- =====================================================================
-- 2026-06-10. Plan: docs/qteklink/daily-je-rework-plan.md §3/§4. Replaces the per-RO/
-- payment posting grain with AL's daily-category grain: ONE row per
-- (shop, realm, business_date, category['sales'|'payments'|'fees'], posting_version).
-- PURELY ADDITIVE — qteklink_postings and its RPCs stay untouched until the cleanup
-- step (no deploy-ordering skew; verified 2026-06-10 that NOTHING is posted yet:
-- zero posted rows / zero qbo_je_ids / qteklink_ro_state empty).
--
-- vs the old table, three deliberate upgrades:
--   * `action` ('create'|'update'|'delete') — at day grain corrections are MANDATORY
--     (any post-posting source change lands on an already-posted day): version N+1
--     re-posts as a FULL-REPLACEMENT update of the existing QBO JE, or a DELETE when
--     the category emptied (a QBO JE cannot be updated to zero lines). action is NOT
--     derivable from the version (v2 after a permanently-failed v1 is a 'create').
--   * `qbo_sync_token` — first-class (the update/delete flow needs the current token;
--     the old table buried it in qbo_response; qteklink_ro_state is retired).
--   * `rejected_by`/`rejected_at` — rejection no longer overloads the approved_* columns.
--   * the enqueue RPC REFRESHES a still-PENDING row in place when the source hash moved
--     (at day grain "the day changed since enqueue" is the COMMON case — every new
--     payment moves the bundle; a stale pending row would mislead the approval UI).
--     An APPROVED row is FROZEN (what the human confirmed); divergence after approval
--     is handled by the poster's claim-time rebuild+recheck, which releases the row
--     back to pending via qteklink_refresh_daily_posting (re-approval required —
--     the money changed).
--
-- State machine (same as §3 plus the refresh release):
--   pending --approve--> approved --claim--> posting --mark_posted--> posted
--   pending/approved --reject--> rejected
--   posting --mark_failed(retryable)--> approved ; --mark_failed(permanent)--> failed
--   posting --refresh(stale at claim)--> pending   (content refreshed, lease released)
--   posting (lease expired) --requeue--> approved  (crash recovery)
--
-- IDEMPOTENCY: the identity unique (shop,realm,date,category,version) + the stable
-- `requestid` unique (shop,realm,requestid) — same two layers as the old table; the
-- QBO API dedups creates on requestid. constituents (sorted ro/payment ids) is part of
-- the hashed source state upstream, so membership changes always trip the hash.
--
-- Multi-tenant: shop_id + realm_id on the row, in EVERY uniqueness key, + the composite
-- FK -> qbo_connections. service_role-only (deny-all RLS); writes via the definer RPCs
-- (SELECT granted; default-privs writes REVOKEd). Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_daily_postings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         integer     NOT NULL,
  realm_id        text        NOT NULL,
  -- the shop-local business day this category JE covers (also the JE TxnDate).
  business_date   date        NOT NULL,
  category        text        NOT NULL,
  posting_version integer     NOT NULL DEFAULT 1,
  -- what the poster does with this version: create a new QBO JE, full-replacement
  -- update of the day-category's existing JE, or delete it (category emptied).
  action          text        NOT NULL DEFAULT 'create',
  -- the built daily JE: {je:{lines,docNumber,txnDate}, marker, source_state_hash}.
  -- A 'delete' version carries je.lines = [] (the desired state: nothing).
  proposed_je     jsonb       NOT NULL,
  -- sorted source membership: {"ro_ids":[...]} (sales) / {"payment_ids":[...]}
  -- (payments/fees) — review-item correlation + the breakdown views.
  constituents    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- sha256 of the day-category desired state (constituent ids + per-constituent lines)
  -- — rebuilt + re-checked at claim time; a mismatch NEVER posts (plan §4.1).
  source_state_hash text      NOT NULL,
  status          text        NOT NULL DEFAULT 'pending',
  approved_by     text,
  approved_at     timestamptz,
  rejected_by     text,
  rejected_at     timestamptz,
  -- generated once per logical (date,category,version), reused on retry (QBO dedup).
  requestid       text        NOT NULL,
  lease_until     timestamptz,
  -- the QBO JournalEntry this version created/updated/deleted + its LATEST SyncToken
  -- (the next update/delete must send the current token).
  qbo_je_id       text,
  qbo_sync_token  text,
  qbo_response    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_daily_postings_shop_positive  CHECK (shop_id > 0),
  CONSTRAINT qteklink_daily_postings_realm_nonblank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_daily_postings_category_valid CHECK (category IN ('sales','payments','fees')),
  CONSTRAINT qteklink_daily_postings_version_pos    CHECK (posting_version > 0),
  CONSTRAINT qteklink_daily_postings_action_valid   CHECK (action IN ('create','update','delete')),
  CONSTRAINT qteklink_daily_postings_status_valid   CHECK (status IN ('pending','approved','posting','posted','needs_resolution','rejected','failed')),
  CONSTRAINT qteklink_daily_postings_reqid_nonblank CHECK (length(btrim(requestid)) > 0),
  CONSTRAINT qteklink_daily_postings_hash_nonblank  CHECK (length(btrim(source_state_hash)) > 0),
  -- a posted row must reference the QBO JE it created/updated/deleted.
  CONSTRAINT qteklink_daily_postings_posted_shape   CHECK (status <> 'posted' OR qbo_je_id IS NOT NULL),
  -- an update/delete is always a correction of a prior version.
  CONSTRAINT qteklink_daily_postings_correction_ver CHECK (action = 'create' OR posting_version > 1),
  CONSTRAINT qteklink_daily_postings_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT
);

-- Logical identity: ONE row per (shop, realm, day, category, version).
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_daily_postings_identity
  ON public.qteklink_daily_postings (shop_id, realm_id, business_date, category, posting_version);

-- requestid idempotency: one logical create/update/delete per requestid per realm.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_daily_postings_requestid
  ON public.qteklink_daily_postings (shop_id, realm_id, requestid);

-- The approval/claim queue + the lease-recovery scan.
CREATE INDEX IF NOT EXISTS qteklink_daily_postings_claimable
  ON public.qteklink_daily_postings (shop_id, realm_id, status, created_at);
CREATE INDEX IF NOT EXISTS qteklink_daily_postings_lease
  ON public.qteklink_daily_postings (lease_until) WHERE status = 'posting';

COMMENT ON TABLE public.qteklink_daily_postings IS
  'QTekLink day-category posting ledger (daily-je-rework-plan §3): one row per (shop, realm, business_date, category, version); create/update/delete corrections; lease + requestid idempotency; service_role only, writes via the SECURITY DEFINER RPCs.';

ALTER TABLE public.qteklink_daily_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_daily_postings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_daily_postings TO service_role;
-- Supabase pre-grants ALL to service_role via DEFAULT PRIVILEGES (the C4/C6/C7 gotcha);
-- REVOKE the writes so they go ONLY through the SECURITY DEFINER RPCs below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_daily_postings FROM service_role;

-- ─── Enqueue (idempotent on identity; refreshes a still-PENDING row in place) ──
CREATE OR REPLACE FUNCTION public.qteklink_enqueue_daily_posting(
  p_shop_id           integer,
  p_realm_id          text,
  p_business_date     date,
  p_category          text,
  p_posting_version   integer,
  p_action            text,
  p_proposed_je       jsonb,
  p_constituents      jsonb,
  p_source_state_hash text,
  p_requestid         text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_hash text;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_enqueue_daily_posting: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_business_date IS NULL
     OR p_category NOT IN ('sales','payments','fees')
     OR coalesce(p_action, 'create') NOT IN ('create','update','delete')
     OR p_requestid IS NULL OR length(btrim(p_requestid)) = 0
     OR p_source_state_hash IS NULL OR length(btrim(p_source_state_hash)) = 0
     OR p_proposed_je IS NULL THEN
    RAISE EXCEPTION 'qteklink_enqueue_daily_posting: business_date, category, action, requestid, source_state_hash and proposed_je are required';
  END IF;

  INSERT INTO public.qteklink_daily_postings (
    shop_id, realm_id, business_date, category, posting_version, action,
    proposed_je, constituents, source_state_hash, requestid, updated_at
  )
  VALUES (
    p_shop_id, p_realm_id, p_business_date, p_category, coalesce(p_posting_version, 1),
    coalesce(p_action, 'create'), p_proposed_je, coalesce(p_constituents, '{}'::jsonb),
    btrim(p_source_state_hash), btrim(p_requestid), now()
  )
  ON CONFLICT (shop_id, realm_id, business_date, category, posting_version)
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- The version already exists. A still-PENDING row whose source moved is REFRESHED
    -- in place (the approval UI must show the real day); an approved/claimed/terminal
    -- row is never touched here (frozen — the poster's claim-time recheck owns it).
    SELECT id, status, source_state_hash INTO v_id, v_status, v_hash
      FROM public.qteklink_daily_postings
     WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND business_date = p_business_date
       AND category = p_category AND posting_version = coalesce(p_posting_version, 1);
    IF v_status = 'pending' AND v_hash IS DISTINCT FROM btrim(p_source_state_hash) THEN
      UPDATE public.qteklink_daily_postings
         SET proposed_je = p_proposed_je,
             constituents = coalesce(p_constituents, '{}'::jsonb),
             action = coalesce(p_action, 'create'),
             source_state_hash = btrim(p_source_state_hash),
             updated_at = now()
       WHERE id = v_id AND status = 'pending';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_enqueue_daily_posting(integer, text, date, text, integer, text, jsonb, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_enqueue_daily_posting(integer, text, date, text, integer, text, jsonb, jsonb, text, text) TO service_role;

-- ─── Approve a pending daily posting (the human gate) ────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_approve_daily_posting(
  p_shop_id integer, p_realm_id text, p_id uuid, p_approved_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_approved_by IS NULL OR length(btrim(p_approved_by)) = 0
     OR p_shop_id IS NULL OR p_realm_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_approve_daily_posting: p_id + non-blank p_approved_by + shop/realm are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'approved', approved_by = p_approved_by, approved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_approve_daily_posting(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_approve_daily_posting(integer, text, uuid, text) TO service_role;

-- ─── Reject a pending/approved daily posting (its OWN columns, not approved_*) ─
CREATE OR REPLACE FUNCTION public.qteklink_reject_daily_posting(
  p_shop_id integer, p_realm_id text, p_id uuid, p_rejected_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_rejected_by IS NULL OR length(btrim(p_rejected_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_reject_daily_posting: p_id + non-blank p_rejected_by are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'rejected', rejected_by = p_rejected_by, rejected_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status IN ('pending','approved');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_reject_daily_posting(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_reject_daily_posting(integer, text, uuid, text) TO service_role;

-- ─── Claim ONE SPECIFIC approved daily posting (lease + SKIP LOCKED) ──────────
CREATE OR REPLACE FUNCTION public.qteklink_claim_daily_posting_by_id(
  p_shop_id integer, p_realm_id text, p_id uuid, p_lease_seconds integer
)
RETURNS public.qteklink_daily_postings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row   public.qteklink_daily_postings;
  v_lease integer := coalesce(p_lease_seconds, 120);
BEGIN
  IF p_shop_id IS NULL OR p_realm_id IS NULL OR p_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_claim_daily_posting_by_id: shop/realm/id are required';
  END IF;
  WITH c AS (
    SELECT id FROM public.qteklink_daily_postings
     WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'approved'
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.qteklink_daily_postings p
     SET status = 'posting', lease_until = now() + make_interval(secs => v_lease), updated_at = now()
    FROM c
   WHERE p.id = c.id
  RETURNING p.* INTO v_row;
  RETURN v_row; -- all-NULL row when not claimable (not approved / wrong tenant / locked)
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_claim_daily_posting_by_id(integer, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_claim_daily_posting_by_id(integer, text, uuid, integer) TO service_role;

-- ─── Mark a claimed daily posting POSTED (records QBO id + SyncToken) ─────────
CREATE OR REPLACE FUNCTION public.qteklink_mark_daily_posted(
  p_shop_id integer, p_realm_id text, p_id uuid, p_qbo_je_id text, p_qbo_sync_token text, p_qbo_response jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_qbo_je_id IS NULL OR length(btrim(p_qbo_je_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_mark_daily_posted: p_id + non-blank p_qbo_je_id are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'posted', qbo_je_id = btrim(p_qbo_je_id),
         qbo_sync_token = nullif(btrim(coalesce(p_qbo_sync_token, '')), ''),
         qbo_response = p_qbo_response, lease_until = NULL, updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'posting';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_mark_daily_posted(integer, text, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_mark_daily_posted(integer, text, uuid, text, text, jsonb) TO service_role;

-- ─── Mark a claimed daily posting FAILED — retryable back to approved ─────────
CREATE OR REPLACE FUNCTION public.qteklink_mark_daily_failed(
  p_shop_id integer, p_realm_id text, p_id uuid, p_retryable boolean, p_qbo_response jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_mark_daily_failed: p_id is required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = CASE WHEN coalesce(p_retryable, false) THEN 'approved' ELSE 'failed' END,
         qbo_response = p_qbo_response, lease_until = NULL, updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'posting';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_mark_daily_failed(integer, text, uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_mark_daily_failed(integer, text, uuid, boolean, jsonb) TO service_role;

-- ─── Stale release: a claimed row whose rebuilt source no longer matches goes ──
-- back to PENDING with refreshed content (re-approval required — the money changed).
CREATE OR REPLACE FUNCTION public.qteklink_refresh_daily_posting(
  p_shop_id integer, p_realm_id text, p_id uuid,
  p_action text, p_proposed_je jsonb, p_constituents jsonb, p_source_state_hash text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_proposed_je IS NULL
     OR p_source_state_hash IS NULL OR length(btrim(p_source_state_hash)) = 0
     OR coalesce(p_action, 'create') NOT IN ('create','update','delete') THEN
    RAISE EXCEPTION 'qteklink_refresh_daily_posting: p_id, action, proposed_je and source_state_hash are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'pending', action = coalesce(p_action, 'create'),
         proposed_je = p_proposed_je, constituents = coalesce(p_constituents, '{}'::jsonb),
         source_state_hash = btrim(p_source_state_hash),
         approved_by = NULL, approved_at = NULL, lease_until = NULL, updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'posting';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_refresh_daily_posting(integer, text, uuid, text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_refresh_daily_posting(integer, text, uuid, text, jsonb, jsonb, text) TO service_role;

-- ─── Crash recovery: re-queue daily postings whose lease expired ──────────────
CREATE OR REPLACE FUNCTION public.qteklink_requeue_expired_daily_leases(
  p_shop_id integer, p_realm_id text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_shop_id IS NULL OR p_realm_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_requeue_expired_daily_leases: shop/realm are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'approved', lease_until = NULL, updated_at = now()
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'posting'
     AND lease_until IS NOT NULL AND lease_until < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_requeue_expired_daily_leases(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_requeue_expired_daily_leases(integer, text) TO service_role;

COMMIT;

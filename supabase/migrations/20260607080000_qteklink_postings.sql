-- =====================================================================
-- QTekLink C8 — qteklink_postings (the posting lifecycle ledger, §3)
-- =====================================================================
-- 2026-06-08. Plan §3. The append-only "what we posted / are posting" ledger that
-- drives the QBO JournalEntry create + the human approval gate. One row per logical
-- posting: a per-RO SALE, a per-PAYMENT, a fee, or a reversing correction.
--
-- State machine (§3):
--   pending --approve--> approved --claim--> posting --mark_posted--> posted
--   pending/approved --reject--> rejected
--   posting (lease expired) --requeue--> approved   (crash recovery)
--   posting --mark_failed(retryable)--> approved ; --mark_failed(permanent)--> failed
-- The poster (C8c) NEVER writes here directly — it goes through the SECURITY DEFINER
-- RPCs so the lease + the state transitions are atomic.
--
-- IDEMPOTENCY (two layers, §3/§10):
--   * the logical-identity unique (shop,realm,ro,kind,payment_id,version) — enqueue is
--     a no-op if the posting already exists (re-running the sync never duplicates);
--   * `requestid` unique (shop,realm,requestid) — generated once per logical create +
--     reused on retry, so a crash-after-QBO-create can't double-post (the QBO API
--     dedups on requestid; the durable row + the private-note marker in proposed_je
--     let a crash be detected by query, DocNumber alone isn't authoritative).
--
-- Multi-tenant: shop_id + realm_id on the row, in EVERY uniqueness key, + the composite
-- FK -> qbo_connections. Money/accounts live in proposed_je (snapshotted at build —
-- later mapping edits never retro-generate corrections). service_role-only (deny-all
-- RLS); writes via the definer RPCs (the DAL reads via SELECT; the default-privs write
-- REVOKE is folded in below). Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_postings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         integer     NOT NULL,
  realm_id        text        NOT NULL,
  -- the business day this posting belongs to (shop-local), for the daily roll-up.
  batch_date      date        NOT NULL,
  tekmetric_ro_id bigint      NOT NULL,
  -- null for a SALE posting; the Tekmetric payment id for a PAYMENT posting.
  payment_id      bigint,
  kind            text        NOT NULL,
  -- the QBO JournalEntry TxnDate (shop-local calendar date).
  txn_date        date        NOT NULL,
  -- bumped when a correction supersedes an earlier posting for the same subject.
  posting_version integer     NOT NULL DEFAULT 1,
  -- the built JE: lines + persisted discount allocation + SNAPSHOTTED account ids + the
  -- deterministic private-note idempotency marker (§3). The source of truth for the post.
  proposed_je     jsonb       NOT NULL,
  -- hash of the source state (payment_state + RO snapshot + mappings) the draft was built
  -- from — re-checked at post time; a mismatch means STALE -> rebuild, never post.
  source_state_hash text      NOT NULL,
  recon_status    text        NOT NULL DEFAULT 'pending',
  status          text        NOT NULL DEFAULT 'pending',
  approved_by     text,
  approved_at     timestamptz,
  -- generated once per logical create, reused on retry (the QBO requestid).
  requestid       text        NOT NULL,
  -- set while status='posting'; an expired lease is re-queued (crash recovery).
  lease_until     timestamptz,
  qbo_je_id       text,
  qbo_response    jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_postings_shop_positive  CHECK (shop_id > 0),
  CONSTRAINT qteklink_postings_realm_nonblank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_postings_ro_positive    CHECK (tekmetric_ro_id > 0),
  CONSTRAINT qteklink_postings_version_pos    CHECK (posting_version > 0),
  CONSTRAINT qteklink_postings_kind_valid     CHECK (kind IN ('sale','payment','fee','correction')),
  CONSTRAINT qteklink_postings_status_valid   CHECK (status IN ('pending','approved','posting','posted','needs_resolution','rejected','failed')),
  CONSTRAINT qteklink_postings_reqid_nonblank CHECK (length(btrim(requestid)) > 0),
  CONSTRAINT qteklink_postings_hash_nonblank  CHECK (length(btrim(source_state_hash)) > 0),
  -- a SALE has no payment_id; a PAYMENT must carry one.
  CONSTRAINT qteklink_postings_payment_shape  CHECK (
    (kind = 'sale' AND payment_id IS NULL) OR
    (kind <> 'sale' AND payment_id IS NOT NULL)
  ),
  -- a posted row must carry its QBO id; an approved row must carry who approved it.
  CONSTRAINT qteklink_postings_posted_shape   CHECK (status <> 'posted' OR qbo_je_id IS NOT NULL),
  CONSTRAINT qteklink_postings_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT
);

-- Logical identity: ONE posting per (shop, realm, RO, kind, payment, version). payment_id
-- is null for sales -> coalesce to 0 (Tekmetric ids are positive) so sales dedup too.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_postings_identity
  ON public.qteklink_postings (shop_id, realm_id, tekmetric_ro_id, kind, coalesce(payment_id, 0), posting_version);

-- requestid idempotency: one logical create per requestid per realm.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_postings_requestid
  ON public.qteklink_postings (shop_id, realm_id, requestid);

-- The poster's claim queue (approved, oldest first) + the lease-recovery scan.
CREATE INDEX IF NOT EXISTS qteklink_postings_claimable
  ON public.qteklink_postings (shop_id, realm_id, status, created_at);
CREATE INDEX IF NOT EXISTS qteklink_postings_lease
  ON public.qteklink_postings (lease_until) WHERE status = 'posting';

COMMENT ON TABLE public.qteklink_postings IS
  'QTekLink posting lifecycle ledger (plan §3): pending->approved->posting->posted; lease + requestid idempotency; service_role only, writes via the SECURITY DEFINER RPCs.';

ALTER TABLE public.qteklink_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_postings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_postings TO service_role;
-- Supabase pre-grants ALL to service_role via DEFAULT PRIVILEGES (the C4/C6/C7 gotcha);
-- REVOKE the writes so they go ONLY through the SECURITY DEFINER RPCs below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_postings FROM service_role;

-- ─── Enqueue a pending posting (idempotent on the logical identity) ───────────
CREATE OR REPLACE FUNCTION public.qteklink_enqueue_posting(
  p_shop_id         integer,
  p_realm_id        text,
  p_batch_date      date,
  p_tekmetric_ro_id bigint,
  p_payment_id      bigint,
  p_kind            text,
  p_txn_date        date,
  p_posting_version integer,
  p_proposed_je     jsonb,
  p_source_state_hash text,
  p_requestid       text,
  p_recon_status    text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_enqueue_posting: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_kind NOT IN ('sale','payment','fee','correction')
     OR p_tekmetric_ro_id IS NULL OR p_tekmetric_ro_id <= 0
     OR p_requestid IS NULL OR length(btrim(p_requestid)) = 0
     OR p_source_state_hash IS NULL OR length(btrim(p_source_state_hash)) = 0
     OR p_proposed_je IS NULL THEN
    RAISE EXCEPTION 'qteklink_enqueue_posting: kind, ro id, requestid, source_state_hash and proposed_je are required';
  END IF;

  INSERT INTO public.qteklink_postings (
    shop_id, realm_id, batch_date, tekmetric_ro_id, payment_id, kind, txn_date,
    posting_version, proposed_je, source_state_hash, requestid, recon_status, updated_at
  )
  VALUES (
    p_shop_id, p_realm_id, p_batch_date, p_tekmetric_ro_id, p_payment_id, p_kind, p_txn_date,
    coalesce(p_posting_version, 1), p_proposed_je, btrim(p_source_state_hash), btrim(p_requestid),
    coalesce(p_recon_status, 'pending'), now()
  )
  ON CONFLICT (shop_id, realm_id, tekmetric_ro_id, kind, coalesce(payment_id, 0), posting_version)
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- already enqueued (idempotent) — return the existing row's id.
    SELECT id INTO v_id FROM public.qteklink_postings
     WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND tekmetric_ro_id = p_tekmetric_ro_id
       AND kind = p_kind AND coalesce(payment_id, 0) = coalesce(p_payment_id, 0)
       AND posting_version = coalesce(p_posting_version, 1);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_enqueue_posting(integer, text, date, bigint, bigint, text, date, integer, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_enqueue_posting(integer, text, date, bigint, bigint, text, date, integer, jsonb, text, text, text) TO service_role;

-- ─── Approve a pending posting (the human gate) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_approve_posting(
  p_shop_id integer, p_realm_id text, p_id uuid, p_approved_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_approved_by IS NULL OR length(btrim(p_approved_by)) = 0
     OR p_shop_id IS NULL OR p_realm_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_approve_posting: p_id + non-blank p_approved_by + shop/realm are required';
  END IF;
  UPDATE public.qteklink_postings
     SET status = 'approved', approved_by = p_approved_by, approved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_approve_posting(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_approve_posting(integer, text, uuid, text) TO service_role;

-- ─── Reject a pending/approved posting ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_reject_posting(
  p_shop_id integer, p_realm_id text, p_id uuid, p_rejected_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_rejected_by IS NULL OR length(btrim(p_rejected_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_reject_posting: p_id + non-blank p_rejected_by are required';
  END IF;
  UPDATE public.qteklink_postings
     SET status = 'rejected', approved_by = p_rejected_by, approved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status IN ('pending','approved');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_reject_posting(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_reject_posting(integer, text, uuid, text) TO service_role;

-- ─── Claim the oldest APPROVED posting for the poster (lease + SKIP LOCKED) ───
CREATE OR REPLACE FUNCTION public.qteklink_claim_posting(
  p_shop_id integer, p_realm_id text, p_lease_seconds integer
)
RETURNS public.qteklink_postings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.qteklink_postings;
  v_lease integer := coalesce(p_lease_seconds, 120);
BEGIN
  IF p_shop_id IS NULL OR p_realm_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_claim_posting: shop/realm are required';
  END IF;
  WITH c AS (
    SELECT id FROM public.qteklink_postings
     WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'approved'
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.qteklink_postings p
     SET status = 'posting', lease_until = now() + make_interval(secs => v_lease), updated_at = now()
    FROM c
   WHERE p.id = c.id
  RETURNING p.* INTO v_row;
  RETURN v_row; -- all-NULL row when nothing was claimable
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_claim_posting(integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_claim_posting(integer, text, integer) TO service_role;

-- ─── Mark a claimed posting POSTED (records the QBO id + response) ────────────
CREATE OR REPLACE FUNCTION public.qteklink_mark_posted(
  p_shop_id integer, p_realm_id text, p_id uuid, p_qbo_je_id text, p_qbo_response jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_qbo_je_id IS NULL OR length(btrim(p_qbo_je_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_mark_posted: p_id + non-blank p_qbo_je_id are required';
  END IF;
  UPDATE public.qteklink_postings
     SET status = 'posted', qbo_je_id = btrim(p_qbo_je_id), qbo_response = p_qbo_response,
         lease_until = NULL, updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'posting';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_mark_posted(integer, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_mark_posted(integer, text, uuid, text, jsonb) TO service_role;

-- ─── Mark a claimed posting FAILED — retryable back to approved, else failed ──
CREATE OR REPLACE FUNCTION public.qteklink_mark_failed(
  p_shop_id integer, p_realm_id text, p_id uuid, p_retryable boolean, p_qbo_response jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_mark_failed: p_id is required';
  END IF;
  UPDATE public.qteklink_postings
     SET status = CASE WHEN coalesce(p_retryable, false) THEN 'approved' ELSE 'failed' END,
         qbo_response = p_qbo_response, lease_until = NULL, updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'posting';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_mark_failed(integer, text, uuid, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_mark_failed(integer, text, uuid, boolean, jsonb) TO service_role;

-- ─── Crash recovery: re-queue postings whose lease expired (posting -> approved) ──
CREATE OR REPLACE FUNCTION public.qteklink_requeue_expired_leases(
  p_shop_id integer, p_realm_id text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_shop_id IS NULL OR p_realm_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_requeue_expired_leases: shop/realm are required';
  END IF;
  UPDATE public.qteklink_postings
     SET status = 'approved', lease_until = NULL, updated_at = now()
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'posting'
     AND lease_until IS NOT NULL AND lease_until < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_requeue_expired_leases(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_requeue_expired_leases(integer, text) TO service_role;

COMMIT;

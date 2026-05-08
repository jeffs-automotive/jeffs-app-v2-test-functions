-- Keytag system — Tekmetric-driven key-tag assignment
--
-- Tekmetric webhooks fire `status_updated` whenever an RO field changes (including the
-- keyTag field PATCHed by our own edge function). Without guards, that creates an
-- infinite loop. The previous v3 implementation had this outage; v5 added two guards
-- (idempotent PATCH + self-authored gate) at the edge function. See keytag-tekmetric-webhook.
--
-- This migration sets up:
--   - keytags                    pool of 100 tags with current-assignment fields
--   - keytag_webhook_events      append-only audit log of every webhook call
--   - assign_next_keytag()       picks lowest available tag, idempotent for same RO
--   - release_keytag_for_ro()    frees a tag back to available
--   - mark_keytag_posted()       marks tag as posted_ar (still held — RO on A/R balance)
--   - record_keytag_patched()    logs Tekmetric PATCH success/failure
--
-- Schema notes:
--   * Single-row-per-tag (100 rows total). History lives in keytag_webhook_events.
--   * Single-shop test setup. Schema does not include shop_id since the test project is
--     scoped to one shop. When porting to prod (multi-shop), add `shop_id uuid NOT NULL`
--     to keytags + keytag_webhook_events, partial-unique-index on (shop_id, ro_id), and
--     scope the RPCs to a shop_id parameter.
--   * service_role only. No RLS policies for anon/authenticated — they get nothing
--     because RLS is enabled and no policy applies to them.

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: keytags  (one row per tag, 100 rows total seeded below)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.keytags (
  tag_number          int           PRIMARY KEY CHECK (tag_number BETWEEN 1 AND 100),
  status              text          NOT NULL DEFAULT 'available'
                                    CHECK (status IN ('available', 'assigned', 'posted_ar')),

  -- Current assignment (NULL when status='available')
  ro_id               bigint,
  ro_number           bigint,
  customer_id         bigint,
  vehicle_id          bigint,
  advisor_id          bigint,
  technician_id       bigint,

  -- Lifecycle timestamps
  assigned_at         timestamptz,
  posted_at           timestamptz,    -- set when status moves to posted_ar (A/R balance)
  released_at         timestamptz,

  -- Last Tekmetric PATCH attempt observability
  last_patch_at       timestamptz,
  last_patch_success  boolean,
  last_patch_error    text,

  updated_at          timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.keytags IS
  'Pool of 100 physical key tags. One row per tag. Status moves available -> assigned -> (posted_ar | available).';

-- An RO can hold at most one tag at a time
CREATE UNIQUE INDEX keytags_ro_id_unique
  ON public.keytags (ro_id)
  WHERE ro_id IS NOT NULL;

CREATE INDEX keytags_status_idx ON public.keytags (status);

-- Seed 1..100
INSERT INTO public.keytags (tag_number)
SELECT generate_series(1, 100);

ALTER TABLE public.keytags ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: keytag_webhook_events  (audit log of every Tekmetric webhook hit)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.keytag_webhook_events (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at         timestamptz   NOT NULL DEFAULT now(),

  -- Parsed from webhook body
  event_text          text,
  event_kind          text          NOT NULL,  -- ro_status_updated | ro_posted | payment_made | unknown
  tekmetric_ro_id     bigint,
  status_id           int,
  payment_id          bigint,

  -- Raw payload for replay / debugging
  raw_body            jsonb,
  raw_headers         jsonb,

  -- Processing outcome
  processed_at        timestamptz,
  processing_result   text,         -- assigned | assigned_no_patch_needed | assigned_patch_failed |
                                    -- released | posted_marked | skipped_self_authored | noop | error
  processing_detail   jsonb,
  error_message       text
);

CREATE INDEX keytag_webhook_events_ro_idx       ON public.keytag_webhook_events (tekmetric_ro_id);
CREATE INDEX keytag_webhook_events_received_idx ON public.keytag_webhook_events (received_at DESC);
CREATE INDEX keytag_webhook_events_kind_idx     ON public.keytag_webhook_events (event_kind);

ALTER TABLE public.keytag_webhook_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: assign_next_keytag — picks lowest available tag, idempotent for the same RO
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_next_keytag(
  p_ro_id          bigint,
  p_ro_number      bigint,
  p_customer_id    bigint DEFAULT NULL,
  p_vehicle_id     bigint DEFAULT NULL,
  p_advisor_id     bigint DEFAULT NULL,
  p_technician_id  bigint DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag int;
BEGIN
  -- Idempotency: if the RO already holds a tag, return it without re-assigning.
  -- This is what makes the edge function's "guard #1" safe — it can call this RPC
  -- without worrying about double-assigning.
  SELECT tag_number INTO v_tag
  FROM keytags
  WHERE ro_id = p_ro_id
  LIMIT 1;

  IF v_tag IS NOT NULL THEN
    RETURN v_tag;
  END IF;

  -- Find the lowest available tag and lock it for update. SKIP LOCKED handles the
  -- (rare) race where two workers try to pick the same tag concurrently — the second
  -- worker just picks the next one.
  WITH cte AS (
    SELECT tag_number
    FROM keytags
    WHERE status = 'available'
    ORDER BY tag_number ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE keytags k
  SET status         = 'assigned',
      ro_id          = p_ro_id,
      ro_number      = p_ro_number,
      customer_id    = p_customer_id,
      vehicle_id     = p_vehicle_id,
      advisor_id     = p_advisor_id,
      technician_id  = p_technician_id,
      assigned_at    = now(),
      posted_at      = NULL,
      released_at    = NULL,
      updated_at     = now()
  FROM cte
  WHERE k.tag_number = cte.tag_number
  RETURNING k.tag_number INTO v_tag;

  -- v_tag is NULL if the pool was exhausted (all 100 in use). Caller checks for NULL
  -- and surfaces "pool exhausted" — see edge function.
  RETURN v_tag;
END;
$$;

COMMENT ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint) IS
  'Idempotently assigns the lowest available keytag to an RO. Returns existing tag if RO already holds one. Returns NULL if pool exhausted.';

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: release_keytag_for_ro — frees the tag held by this RO
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_keytag_for_ro(
  p_ro_id  bigint,
  p_reason text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag int;
BEGIN
  UPDATE keytags
  SET status         = 'available',
      ro_id          = NULL,
      ro_number      = NULL,
      customer_id    = NULL,
      vehicle_id     = NULL,
      advisor_id     = NULL,
      technician_id  = NULL,
      assigned_at    = NULL,
      posted_at      = NULL,
      released_at    = now(),
      updated_at     = now()
  WHERE ro_id = p_ro_id
  RETURNING tag_number INTO v_tag;

  -- v_tag is NULL if no tag was held. Caller treats that as a noop.
  -- (p_reason is accepted for caller observability but not stored here — the
  --  edge function logs it to keytag_webhook_events.processing_detail.)
  RETURN v_tag;
END;
$$;

COMMENT ON FUNCTION public.release_keytag_for_ro(bigint, text) IS
  'Releases the keytag currently held by the given RO. Returns the freed tag number, or NULL if no tag was held.';

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: mark_keytag_posted — RO went to A/R; keep tag held but mark posted
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_keytag_posted(
  p_ro_id bigint
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag int;
BEGIN
  UPDATE keytags
  SET status     = 'posted_ar',
      posted_at  = now(),
      updated_at = now()
  WHERE ro_id = p_ro_id
  RETURNING tag_number INTO v_tag;

  RETURN v_tag;
END;
$$;

COMMENT ON FUNCTION public.mark_keytag_posted(bigint) IS
  'Marks the keytag held by this RO as posted_ar (RO went to A/R balance). Tag stays held until payment_made fires.';

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: record_keytag_patched — log Tekmetric PATCH success/failure on the row
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_keytag_patched(
  p_ro_id   bigint,
  p_success boolean,
  p_error   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE keytags
  SET last_patch_at      = now(),
      last_patch_success = p_success,
      last_patch_error   = p_error,
      updated_at         = now()
  WHERE ro_id = p_ro_id;
END;
$$;

COMMENT ON FUNCTION public.record_keytag_patched(bigint, boolean, text) IS
  'Records the result of a Tekmetric PATCH attempt on the keytag row. For observability — does not affect tag state.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions: service_role only
-- Edge functions use SUPABASE_SERVICE_ROLE_KEY. anon and authenticated get nothing.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_keytag_for_ro(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_keytag_for_ro(bigint, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_keytag_for_ro(bigint, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.mark_keytag_posted(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_keytag_posted(bigint) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_keytag_posted(bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_keytag_patched(bigint, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_keytag_patched(bigint, boolean, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_keytag_patched(bigint, boolean, text) TO service_role;

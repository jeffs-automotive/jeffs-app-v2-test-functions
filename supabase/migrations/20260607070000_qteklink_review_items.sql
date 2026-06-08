-- =====================================================================
-- QTekLink C7 — qteklink_review_items (the resolution queue, §9)
-- =====================================================================
-- 2026-06-07. Plan §8/§9. The deterministic reconciliation gate (§8) + the daily
-- approvals emit a TYPED review item whenever a draft can't post cleanly (an
-- unmapped key, a tax/fee/amount mismatch, an orphan payment, a method-unknown
-- pick, a QBO error). A human resolves it in the daily-approvals UI (picks an
-- account / classifies / fixes) → the draft is rebuilt + posting resumes. Never
-- auto-buckets; never strands the RO.
--
-- ONE OPEN item per (shop, realm, kind, subject) — re-detecting the same issue
-- REFRESHES the open row (its detail), it does NOT pile up duplicates (partial
-- unique WHERE status='open'). A resolved item is kept for audit.
--
-- Multi-tenant: shop_id + realm_id + the composite FK -> qbo_connections. Money/
-- ids live in `detail`/`resolution` jsonb (no PII — RO/payment ids + amounts).
-- service_role-only (deny-all RLS); writes via the SECURITY DEFINER RPCs (the DAL
-- reads via SELECT; the default-privs write REVOKE is folded in below — line ~74).
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_review_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      integer     NOT NULL,
  realm_id     text        NOT NULL,
  -- the deterministic reason this needs a human (plan §8/§9).
  kind         text        NOT NULL,
  -- what the item is about: 'ro' | 'payment' | 'mapping_key' | 'day'.
  subject_kind text        NOT NULL,
  -- the RO id / payment id / mapping source_key / business-date the item concerns.
  subject_ref  text        NOT NULL,
  -- machine context for the UI (amounts, the expected-vs-actual, the unmapped key…).
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'open',
  -- the human's resolution (chosen account / classification / note) — null until resolved.
  resolution   jsonb,
  resolved_by  text,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_review_items_shop_positive   CHECK (shop_id > 0),
  CONSTRAINT qteklink_review_items_realm_nonblank  CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_review_items_kind_nonblank   CHECK (length(btrim(kind)) > 0),
  CONSTRAINT qteklink_review_items_subjkind_valid  CHECK (subject_kind IN ('ro','payment','mapping_key','day')),
  CONSTRAINT qteklink_review_items_subjref_nonblank CHECK (length(btrim(subject_ref)) > 0),
  CONSTRAINT qteklink_review_items_status_valid     CHECK (status IN ('open','resolved')),
  CONSTRAINT qteklink_review_items_resolved_shape   CHECK (
    (status = 'open'     AND resolved_at IS NULL) OR
    (status = 'resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  ),
  CONSTRAINT qteklink_review_items_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT
);

-- ONE OPEN per (shop, realm, kind, subject) — re-detection refreshes, never forks.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_review_items_one_open
  ON public.qteklink_review_items (shop_id, realm_id, kind, subject_kind, subject_ref)
  WHERE status = 'open';

-- Open-queue read for the daily-approvals UI.
CREATE INDEX IF NOT EXISTS qteklink_review_items_open
  ON public.qteklink_review_items (shop_id, realm_id, status) WHERE status = 'open';

COMMENT ON TABLE public.qteklink_review_items IS
  'QTekLink resolution queue (plan §8/§9): typed reconciliation review items emitted by the gate + daily approvals; one OPEN per (shop,realm,kind,subject); a human resolves in-app -> rebuild + resume posting. service_role only.';

ALTER TABLE public.qteklink_review_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_review_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_review_items TO service_role;
-- Supabase pre-grants ALL to service_role via DEFAULT PRIVILEGES (the C4/C6 gotcha);
-- REVOKE the writes so they go ONLY through the SECURITY DEFINER RPCs below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_review_items FROM service_role;

-- ─── Upsert an OPEN review item (re-detection refreshes detail, never forks) ──
CREATE OR REPLACE FUNCTION public.qteklink_upsert_review_item(
  p_shop_id      integer,
  p_realm_id     text,
  p_kind         text,
  p_subject_kind text,
  p_subject_ref  text,
  p_detail       jsonb
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
    RAISE EXCEPTION 'qteklink_upsert_review_item: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_kind IS NULL OR length(btrim(p_kind)) = 0
     OR p_subject_kind NOT IN ('ro','payment','mapping_key','day')
     OR p_subject_ref IS NULL OR length(btrim(p_subject_ref)) = 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_review_item: kind, a valid subject_kind and a non-blank subject_ref are required';
  END IF;

  INSERT INTO public.qteklink_review_items (shop_id, realm_id, kind, subject_kind, subject_ref, detail, updated_at)
  VALUES (p_shop_id, p_realm_id, btrim(p_kind), p_subject_kind, btrim(p_subject_ref), coalesce(p_detail, '{}'::jsonb), now())
  ON CONFLICT (shop_id, realm_id, kind, subject_kind, subject_ref) WHERE status = 'open'
  DO UPDATE SET detail = coalesce(EXCLUDED.detail, '{}'::jsonb), updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_review_item(integer, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_review_item(integer, text, text, text, text, jsonb) TO service_role;

-- ─── Resolve one OPEN review item (human action), tenant-scoped ──────────────
CREATE OR REPLACE FUNCTION public.qteklink_resolve_review_item(
  p_shop_id     integer,
  p_realm_id    text,
  p_id          uuid,
  p_resolution  jsonb,
  p_resolved_by text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0
     OR p_id IS NULL OR p_resolved_by IS NULL OR length(btrim(p_resolved_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_resolve_review_item: positive p_shop_id + non-blank p_realm_id + p_id + p_resolved_by are required';
  END IF;
  UPDATE public.qteklink_review_items
     SET status = 'resolved', resolution = p_resolution, resolved_by = p_resolved_by,
         resolved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'open';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_resolve_review_item(integer, text, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_resolve_review_item(integer, text, uuid, jsonb, text) TO service_role;

COMMIT;

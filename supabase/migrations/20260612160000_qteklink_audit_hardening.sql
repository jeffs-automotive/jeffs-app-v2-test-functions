-- =====================================================================
-- QTekLink audit hardening (2026-06-12 8-agent audit findings)
-- =====================================================================
-- 1. ALLOWLIST BIND SHOP-GUARD (security-review): the bind-on-first-login step
--    matched pending rows by email with NO shop scoping — in a multi-shop
--    deployment the same email pending on two shops would bind to whichever row
--    is older, handing the session the wrong shop. Now: if the identity email
--    matches ACTIVE PENDING rows on MORE THAN ONE shop, the bind FAILS CLOSED
--    (no row → the app rejects with not_allowed) until an admin removes the
--    ambiguity. Single-shop behavior is unchanged.
-- 2. REQUESTID CONTENT-KEYING (quickbooks-compliance): the QBO idempotency
--    requestid was keyed per (shop, realm, day, category, version) but the two
--    content-REFRESH paths replaced proposed_je/hash in place WITHOUT rotating
--    it. In the lost-response crash window QBO would dedupe a re-send of
--    CHANGED content and return the ORIGINAL response — the ledger would mark
--    the new numbers posted while QBO holds the old ones. The app now derives
--    the requestid from the SOURCE-STATE HASH as well, and both refresh paths
--    store the caller's fresh requestid:
--      a. qteklink_enqueue_daily_posting's pending-refresh branch updates
--         requestid alongside the content.
--      b. qteklink_refresh_daily_posting gains p_requestid (DEFAULT NULL =
--         keep the existing value, so the previously-deployed app keeps
--         matching through the deploy window).
-- =====================================================================

BEGIN;

-- ─── 1. Bind-on-first-login: fail closed on cross-shop email ambiguity ───
CREATE OR REPLACE FUNCTION public.qteklink_resolve_allowed_user(p_user_id uuid)
RETURNS TABLE (
  id               uuid,
  shop_id          integer,
  entra_object_id  text,
  email            text,
  full_name        text,
  role             text,
  active           boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oid        text;
  v_email      text;
  v_name       text;
  v_tenant     text;
  v_bound_id   uuid;
  v_shop_count integer;
BEGIN
  -- The provider-managed identity (NOT user-writable) — the trust anchor.
  SELECT i.identity_data -> 'custom_claims' ->> 'oid',
         lower(btrim(coalesce(i.identity_data ->> 'email', ''))),
         i.identity_data ->> 'name',
         i.identity_data -> 'custom_claims' ->> 'tid'
    INTO v_oid, v_email, v_name, v_tenant
  FROM auth.identities i
  WHERE i.user_id = p_user_id
    AND i.provider = 'azure'
  LIMIT 1;

  IF v_oid IS NULL OR length(btrim(v_oid)) = 0 THEN
    RETURN;  -- no Azure identity → not allowed (fail closed)
  END IF;

  -- 1) A row already bound to this oid wins (immutable-id anchor; survives
  --    email changes). Returns inactive rows too — the caller enforces active.
  RETURN QUERY
    SELECT a.id, a.shop_id, a.entra_object_id, a.email, a.full_name, a.role, a.active
    FROM public.qteklink_allowed_users a
    WHERE a.entra_object_id = v_oid
    ORDER BY a.active DESC
    LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  -- 2) First sign-in of a manually-added account: claim the ACTIVE pending row
  --    whose email equals the Microsoft-verified identity email, binding the
  --    oid. FAIL CLOSED when the email is pending on MORE THAN ONE shop — the
  --    bind target must be unambiguous across shops, not just within one
  --    (shop-agnostic rule; audit 2026-06-12).
  IF v_email = '' THEN
    RETURN;
  END IF;
  SELECT count(DISTINCT a2.shop_id) INTO v_shop_count
  FROM public.qteklink_allowed_users a2
  WHERE a2.entra_object_id IS NULL
    AND lower(a2.email) = v_email
    AND a2.active;
  IF v_shop_count <> 1 THEN
    RETURN;  -- zero matches → not on the list; >1 shops → ambiguous, fail closed
  END IF;

  UPDATE public.qteklink_allowed_users a
     SET entra_object_id = v_oid,
         entra_tenant_id = coalesce(v_tenant, a.entra_tenant_id),
         full_name       = coalesce(a.full_name, v_name),
         updated_at      = now()
   WHERE a.id = (
           SELECT a2.id
           FROM public.qteklink_allowed_users a2
           WHERE a2.entra_object_id IS NULL
             AND lower(a2.email) = v_email
             AND a2.active
           ORDER BY a2.created_at
           LIMIT 1
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.qteklink_allowed_users b
           WHERE b.entra_object_id = v_oid
         )
   RETURNING a.id INTO v_bound_id;

  IF v_bound_id IS NULL THEN
    RETURN;  -- nothing to claim → not on the list (fail closed)
  END IF;

  RETURN QUERY
    SELECT a.id, a.shop_id, a.entra_object_id, a.email, a.full_name, a.role, a.active
    FROM public.qteklink_allowed_users a
    WHERE a.id = v_bound_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_resolve_allowed_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_resolve_allowed_user(uuid) TO service_role;

-- ─── 2a. Enqueue: the pending-refresh branch rotates the requestid too ────
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
    -- The requestid rotates WITH the content (it is hash-keyed) so QBO never dedupes
    -- a re-send of CHANGED content against an old request (audit 2026-06-12).
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
             requestid = btrim(p_requestid),
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

-- ─── 2b. Stale-release: gains p_requestid (NULL = keep — deploy-window safe) ──
DROP FUNCTION IF EXISTS public.qteklink_refresh_daily_posting(integer, text, uuid, text, jsonb, jsonb, text);
CREATE OR REPLACE FUNCTION public.qteklink_refresh_daily_posting(
  p_shop_id integer, p_realm_id text, p_id uuid,
  p_action text, p_proposed_je jsonb, p_constituents jsonb, p_source_state_hash text,
  p_requestid text DEFAULT NULL
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
         requestid = coalesce(nullif(btrim(coalesce(p_requestid, '')), ''), requestid),
         approved_by = NULL, approved_at = NULL, lease_until = NULL, updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'posting';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_refresh_daily_posting(integer, text, uuid, text, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_refresh_daily_posting(integer, text, uuid, text, jsonb, jsonb, text, text) TO service_role;

COMMIT;

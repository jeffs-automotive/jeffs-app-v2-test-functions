-- =====================================================================
-- QTekLink: manage the sign-in allowlist from /settings (Chris's spec)
-- =====================================================================
-- 2026-06-11. Admins add the Microsoft accounts allowed into QTekLink by EMAIL
-- (they don't know the Entra object id before the person's first sign-in):
--
--   1. `entra_object_id` becomes NULLABLE — a manually-added row is PENDING
--      (oid NULL) until its owner signs in once. The UNIQUE(entra_object_id)
--      constraint is unaffected (Postgres allows many NULLs).
--   2. `qteklink_resolve_allowed_user` (the auth gate) gains a BIND-ON-FIRST-
--      LOGIN step: when no row matches the oid, it claims the active PENDING
--      row whose email equals the PROVIDER-MANAGED identity email
--      (auth.identities.identity_data ->> 'email' — Microsoft-verified, NOT
--      user-writable; same trust class as the oid) and stamps the oid onto it.
--      After that the immutable oid is the identity anchor, as before.
--   3. Management RPCs (service_role-only, called by admin-gated actions):
--      add / set_active / set_role / remove(pending-only). The active/role RPCs
--      carry a LOCKOUT GUARD: the only remaining ACTIVE ADMIN of a shop can be
--      neither deactivated nor demoted.
--   4. One email per shop (case-insensitive) — the bind step must be
--      unambiguous.
--
-- Apply: supabase db push. Live data verified 2026-06-11: a single bound admin
-- row (chris@) — the unique index creates cleanly.
-- =====================================================================

BEGIN;

-- ─── 1. Pending rows: oid arrives at first sign-in ───────────────────────
ALTER TABLE public.qteklink_allowed_users
  ALTER COLUMN entra_object_id DROP NOT NULL;

-- ─── 4. One email per shop (the bind target must be unambiguous) ─────────
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_allowed_users_shop_email_key
  ON public.qteklink_allowed_users (shop_id, lower(email));

-- ─── 2. The auth gate: oid match first, then bind-on-first-login ─────────
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
  v_oid      text;
  v_email    text;
  v_name     text;
  v_tenant   text;
  v_bound_id uuid;
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
  --    oid. Guarded against an oid that is somehow already bound elsewhere.
  IF v_email = '' THEN
    RETURN;
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

COMMENT ON FUNCTION public.qteklink_resolve_allowed_user(uuid) IS
  'QTekLink auth gate: resolve a getUser()-validated user_id to its allowlist row. Oid match first (immutable anchor); else BIND-ON-FIRST-LOGIN — claims the active pending row matching the provider-managed identity email and stamps the oid. service_role only.';

-- ─── 3a. Add an account (pending until first sign-in) ────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_add_allowed_user(
  p_shop_id   integer,
  p_email     text,
  p_role      text,
  p_full_name text,
  p_added_by  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_id    uuid;
BEGIN
  v_email := lower(btrim(coalesce(p_email, '')));
  IF p_shop_id IS NULL OR p_shop_id <= 0
     OR v_email = '' OR position('@' in v_email) = 0 OR length(v_email) > 200 THEN
    RAISE EXCEPTION 'A valid email address is required.';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('viewer', 'approver', 'admin') THEN
    RAISE EXCEPTION 'Role must be viewer, approver or admin.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.qteklink_allowed_users a
    WHERE a.shop_id = p_shop_id AND lower(a.email) = v_email
  ) THEN
    RAISE EXCEPTION 'That email is already on the list.';
  END IF;

  INSERT INTO public.qteklink_allowed_users
    (shop_id, entra_object_id, email, full_name, role, active, created_by)
  VALUES
    (p_shop_id, NULL, v_email, nullif(btrim(coalesce(p_full_name, '')), ''), p_role, true, p_added_by)
  RETURNING qteklink_allowed_users.id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_add_allowed_user(integer, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_add_allowed_user(integer, text, text, text, text) TO service_role;

-- ─── 3b. Activate / deactivate (with the lockout guard) ──────────────────
CREATE OR REPLACE FUNCTION public.qteklink_set_allowed_user_active(
  p_shop_id integer,
  p_id      uuid,
  p_active  boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_active IS NULL THEN
    RAISE EXCEPTION 'p_active is required';
  END IF;

  IF NOT p_active THEN
    -- Serialize concurrent admin changes, then enforce the lockout guard.
    PERFORM 1 FROM public.qteklink_allowed_users a
      WHERE a.shop_id = p_shop_id AND a.role = 'admin' AND a.active
      FOR UPDATE;
    IF EXISTS (
         SELECT 1 FROM public.qteklink_allowed_users t
         WHERE t.id = p_id AND t.shop_id = p_shop_id AND t.role = 'admin' AND t.active
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.qteklink_allowed_users o
         WHERE o.shop_id = p_shop_id AND o.role = 'admin' AND o.active AND o.id <> p_id
       ) THEN
      RAISE EXCEPTION 'You can''t deactivate the only active admin — make someone else an admin first.';
    END IF;
  END IF;

  UPDATE public.qteklink_allowed_users a
     SET active = p_active, updated_at = now()
   WHERE a.id = p_id AND a.shop_id = p_shop_id
     AND a.active IS DISTINCT FROM p_active;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_set_allowed_user_active(integer, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_set_allowed_user_active(integer, uuid, boolean) TO service_role;

-- ─── 3c. Change role (with the same lockout guard on demotion) ───────────
CREATE OR REPLACE FUNCTION public.qteklink_set_allowed_user_role(
  p_shop_id integer,
  p_id      uuid,
  p_role    text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('viewer', 'approver', 'admin') THEN
    RAISE EXCEPTION 'Role must be viewer, approver or admin.';
  END IF;

  IF p_role <> 'admin' THEN
    PERFORM 1 FROM public.qteklink_allowed_users a
      WHERE a.shop_id = p_shop_id AND a.role = 'admin' AND a.active
      FOR UPDATE;
    IF EXISTS (
         SELECT 1 FROM public.qteklink_allowed_users t
         WHERE t.id = p_id AND t.shop_id = p_shop_id AND t.role = 'admin' AND t.active
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.qteklink_allowed_users o
         WHERE o.shop_id = p_shop_id AND o.role = 'admin' AND o.active AND o.id <> p_id
       ) THEN
      RAISE EXCEPTION 'You can''t demote the only active admin — make someone else an admin first.';
    END IF;
  END IF;

  UPDATE public.qteklink_allowed_users a
     SET role = p_role, updated_at = now()
   WHERE a.id = p_id AND a.shop_id = p_shop_id
     AND a.role IS DISTINCT FROM p_role;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_set_allowed_user_role(integer, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_set_allowed_user_role(integer, uuid, text) TO service_role;

-- ─── 3d. Remove a PENDING row only (typo cleanup before first sign-in) ───
-- A row that has signed in (oid bound) is history-bearing: deactivate instead.
CREATE OR REPLACE FUNCTION public.qteklink_remove_allowed_user(
  p_shop_id integer,
  p_id      uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.qteklink_allowed_users a
   WHERE a.id = p_id AND a.shop_id = p_shop_id
     AND a.entra_object_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_remove_allowed_user(integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_remove_allowed_user(integer, uuid) TO service_role;

COMMIT;

-- =====================================================================
-- QTekLink C0 — qteklink_allowed_users (app-access allowlist) + lookup RPC
-- =====================================================================
-- 2026-06-05. QTekLink (qteklink.jeffsautomotive.com) gates access to an
-- in-app allowlist instead of the whole @jeffsautomotive.com domain. Auth
-- binds to the Entra **object id** (Azure AD `oid`) — immutable + tenant-wide,
-- so it survives email changes AND is stable across app registrations (unlike
-- the per-app `sub`). Verified empirically: Supabase's Azure provider stores
-- the oid at identity_data.custom_claims.oid (server-side: user.user_metadata
-- .custom_claims.oid). email is display/secondary (lowercased on write).
--
-- Security model mirrors 20260602140000_qbo_connections.sql: the allowlist is
-- sensitive (it IS the access-control list), so the table is service_role-only
-- (deny-all RLS) and the ONLY read path is qteklink_get_allowed_user, called by
-- requireQtekUser() via the service-role admin client.
--
-- shop_id is INTEGER = the Tekmetric shop id (this repo's convention — see the
-- 20+ scheduler/keytag tables; there is no `shops` table in this sandbox).
-- Apply: supabase db push. IDEMPOTENT (IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================

BEGIN;

-- ─── The allowlist ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_allowed_users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          integer NOT NULL,
  entra_object_id  text    NOT NULL,
  entra_tenant_id  text,
  email            text    NOT NULL,
  full_name        text,
  role             text    NOT NULL DEFAULT 'viewer'
                     CHECK (role IN ('viewer', 'approver', 'admin')),
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  CONSTRAINT qteklink_allowed_users_object_id_key UNIQUE (entra_object_id),
  CONSTRAINT qteklink_allowed_users_oid_not_blank
    CHECK (length(btrim(entra_object_id)) > 0),
  CONSTRAINT qteklink_allowed_users_email_not_blank
    CHECK (length(btrim(email)) > 0)
);

COMMENT ON TABLE public.qteklink_allowed_users IS
  'QTekLink app-access allowlist. Auth binds to entra_object_id (Azure AD oid from custom_claims.oid — immutable, tenant-wide); email is display/secondary (lowercased). role escalates viewer<approver<admin. shop_id = Tekmetric shop id (repo convention; no shops table in this sandbox). Read only via qteklink_get_allowed_user (service_role).';

-- service_role only. RLS enabled with NO policy = deny anon + authenticated
-- (defense in depth). requireQtekUser() reads via the service-role admin
-- client + the RPC below; the allowlist never reaches the browser.
ALTER TABLE public.qteklink_allowed_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_allowed_users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qteklink_allowed_users TO service_role;

-- ─── The auth gate: resolve an Entra object id to its allowlist row ──────
-- Returns the row for an oid whether active or not — the caller checks
-- `active` so it can distinguish a *deactivated* user (audit-worthy) from one
-- who was *never* on the list. Empty result set = not on the list (reject).
CREATE OR REPLACE FUNCTION public.qteklink_get_allowed_user(p_object_id text)
RETURNS TABLE (
  id               uuid,
  shop_id          integer,
  entra_object_id  text,
  email            text,
  full_name        text,
  role             text,
  active           boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, shop_id, entra_object_id, email, full_name, role, active
  FROM public.qteklink_allowed_users
  WHERE entra_object_id = p_object_id
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_get_allowed_user(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_get_allowed_user(text) TO service_role;

COMMENT ON FUNCTION public.qteklink_get_allowed_user(text) IS
  'QTekLink auth gate: resolve an Entra object id (oid) to its allowlist row. service_role only (requireQtekUser uses the admin client). Returns active AND inactive rows; the caller enforces `active`.';

COMMIT;

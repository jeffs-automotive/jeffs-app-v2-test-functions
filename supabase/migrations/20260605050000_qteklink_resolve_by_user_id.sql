-- =====================================================================
-- QTekLink C0 security hardening — resolve the allowlist by VALIDATED user_id
-- =====================================================================
-- 2026-06-05. Fixes a privilege-escalation hole found in C0 review: the auth
-- gate read the Entra oid from user.user_metadata.custom_claims.oid, but
-- user_metadata (auth.users.raw_user_meta_data) is CLIENT-WRITABLE — any
-- authenticated user can overwrite it via supabase.auth.updateUser({ data }).
-- A real-tenant but unlisted/viewer/deactivated user could forge a listed
-- admin's oid and inherit that row's role. (Supabase's own guidance: provider
-- identity / app_metadata is the authorization source, NOT user_metadata.)
--
-- Fix: derive the oid SERVER-SIDE from auth.identities (provider-managed, NOT
-- user-writable) keyed on the getUser()-validated user_id. The oid never comes
-- from the client. requireQtekUser passes user.id; this RPC does the rest.
--
-- Apply: supabase db push. IDEMPOTENT (CREATE OR REPLACE).
-- =====================================================================

BEGIN;

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.shop_id, a.entra_object_id, a.email, a.full_name, a.role, a.active
  FROM auth.identities i
  JOIN public.qteklink_allowed_users a
    ON a.entra_object_id = (i.identity_data -> 'custom_claims' ->> 'oid')
  WHERE i.user_id = p_user_id
    AND i.provider = 'azure'
  ORDER BY a.active DESC
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_resolve_allowed_user(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_resolve_allowed_user(uuid) TO service_role;

COMMENT ON FUNCTION public.qteklink_resolve_allowed_user(uuid) IS
  'QTekLink auth gate (tamper-proof): resolve a getUser()-validated Supabase user_id to its allowlist row by reading the Entra oid from auth.identities (provider-managed, NOT the user-writable user_metadata). service_role only. Replaces the user_metadata path for the trust decision; qteklink_get_allowed_user(text) is retained for admin/seed tooling that looks up by a known oid.';

COMMIT;

/**
 * requireQtekUser — server-side guard for every protected QTekLink entrypoint
 * (page, Server Action, route handler). "All-entrypoint" per the plan §14.
 *
 * Three-layer defense:
 *   1. Microsoft Entra tenant restriction (Supabase Azure provider, single-
 *      tenant config) — only the jeffsautomotive.com tenant can complete OAuth.
 *   2. In-app allowlist (`qteklink_allowed_users`) — unlike admin-app (whole
 *      @jeffsautomotive.com domain), QTekLink admits only explicitly-listed
 *      people, keyed on the immutable Entra object id (`oid`).
 *   3. `active` flag — a listed-but-deactivated user is rejected distinctly.
 *
 * SECURITY — where the oid comes from:
 *   The oid is resolved SERVER-SIDE inside `qteklink_resolve_allowed_user`,
 *   which reads it from `auth.identities` (provider-managed, NOT user-writable)
 *   keyed on the `getUser()`-VALIDATED `user.id`. We do NOT read it from
 *   `user.user_metadata` — that field is client-writable via
 *   `supabase.auth.updateUser({ data })`, so trusting it would let a real-tenant
 *   user forge a listed admin's oid and escalate. (Supabase guidance: provider
 *   identity / app_metadata is the authz source, never user_metadata.)
 *
 * The allowlist + the resolver are service_role-only, so the lookup goes through
 * the admin client, never the browser. Lookup errors throw → FAIL CLOSED.
 *
 * Usage:
 *   - Page: `const { role, shopId } = await requireQtekUser();` at the top of a
 *     server component. On reject: redirects to /login (with an error code).
 *   - Server Action: same call FIRST in the action body (it throws on reject).
 */
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import { createSupabaseAdminClient } from "./supabase/admin";

export type QtekRole = "viewer" | "approver" | "admin";

export interface QtekSession {
  /** Microsoft email — display + audit identity (secondary to objectId). */
  email: string;
  /** Supabase user UUID — the validated session identity. */
  userId: string;
  /** Entra AD object id (oid) — resolved server-side from auth.identities. */
  objectId: string;
  /** Tekmetric shop id this user is scoped to. */
  shopId: number;
  /** Allowlist role: viewer < approver < admin. */
  role: QtekRole;
}

interface AllowedUserRow {
  id: string;
  shop_id: number;
  entra_object_id: string;
  email: string;
  full_name: string | null;
  role: string;
  active: boolean;
}

/**
 * Resolve the allowlist row for a VALIDATED Supabase user id. The Entra oid is
 * read inside the RPC from auth.identities (provider-managed) — never from the
 * client. Throws on RPC error → FAIL CLOSED. Returns null when not on the list.
 */
async function resolveAllowedUser(userId: string): Promise<AllowedUserRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_resolve_allowed_user", {
    p_user_id: userId,
  });
  if (error) {
    throw new Error(`qteklink_resolve_allowed_user failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as AllowedUserRow | undefined) ?? null;
}

export async function requireQtekUser(): Promise<QtekSession> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  const allowed = await resolveAllowedUser(user.id);
  if (!allowed) {
    // Authenticated (real tenant user) but not on the allowlist — or has no
    // Azure identity to resolve an oid from. Sign out so the next /login click
    // starts a clean OAuth round-trip.
    await supabase.auth.signOut();
    redirect("/login?error=not_allowed");
  }
  if (!allowed.active) {
    await supabase.auth.signOut();
    redirect("/login?error=deactivated");
  }

  return {
    email: allowed.email || user.email || "",
    userId: user.id,
    objectId: allowed.entra_object_id,
    shopId: allowed.shop_id,
    role: allowed.role as QtekRole,
  };
}


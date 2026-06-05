/**
 * requireQtekUser — server-side guard for every protected QTekLink entrypoint
 * (page, Server Action, route handler). "All-entrypoint" per the plan §14.
 *
 * Three-layer defense:
 *   1. Microsoft Entra tenant restriction (Supabase Azure provider, single-
 *      tenant config) — only the jeffsautomotive.com tenant can complete OAuth.
 *   2. In-app allowlist (`qteklink_allowed_users`) — unlike admin-app (whole
 *      @jeffsautomotive.com domain), QTekLink admits only explicitly-listed
 *      people. The list is keyed on the **Entra object id (oid)** — immutable
 *      and tenant-wide, so it survives email changes and is stable across app
 *      registrations (the per-app `sub` is not).
 *   3. `active` flag — a listed-but-deactivated user is rejected distinctly
 *      (audit-worthy) from one who was never on the list.
 *
 * The oid is read from `user.user_metadata.custom_claims.oid` — verified
 * empirically against this project's live Azure identities (it is NOT a
 * top-level claim and is NOT `sub`).
 *
 * The allowlist is service_role-only (deny-all RLS), so the lookup goes
 * through the admin client + `qteklink_get_allowed_user`, never the browser.
 *
 * Usage:
 *   - Page: `const { role, shopId } = await requireQtekUser();` at the top of
 *     a server component. On reject: redirects to /login (with an error code).
 *   - Server Action: same call FIRST in the action body. It throws on reject
 *     (Next's redirect throws), surfacing as a re-render → redirect.
 */
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "./supabase/server";
import { createSupabaseAdminClient } from "./supabase/admin";

export type QtekRole = "viewer" | "approver" | "admin";

export interface QtekSession {
  /** Microsoft email — display + audit identity (secondary to objectId). */
  email: string;
  /** Supabase user UUID — useful for cross-table joins. */
  userId: string;
  /** Entra AD object id (oid) — the immutable allowlist key. */
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
 * Pull the stable Entra object id (oid) out of a Supabase user. Returns null
 * when the claim is absent (e.g., a non-Azure identity) — caller rejects.
 */
export function extractEntraObjectId(user: User): string | null {
  const meta = (user.user_metadata ?? {}) as {
    custom_claims?: { oid?: unknown };
  };
  const oid = meta.custom_claims?.oid;
  return typeof oid === "string" && oid.length > 0 ? oid : null;
}

/**
 * Resolve an oid to its allowlist row via the service-role RPC. Throws on a
 * lookup error — we FAIL CLOSED (an errored lookup must never grant access).
 * Returns null when the oid is not on the list.
 */
async function resolveAllowedUser(objectId: string): Promise<AllowedUserRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_get_allowed_user", {
    p_object_id: objectId,
  });
  if (error) {
    throw new Error(`qteklink_get_allowed_user failed: ${error.message}`);
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

  const objectId = extractEntraObjectId(user);
  if (!objectId) {
    // Authenticated but no Entra oid — cannot authorize. Sign out so the next
    // /login click starts a clean OAuth round-trip.
    await supabase.auth.signOut();
    redirect("/login?error=no_object_id");
  }

  const allowed = await resolveAllowedUser(objectId);
  if (!allowed) {
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
    objectId,
    shopId: allowed.shop_id,
    role: allowed.role as QtekRole,
  };
}

/**
 * Soft variant — returns the session if present + allowed + active, else null.
 * Does NOT redirect. Use for conditional rendering (e.g., a "Sign in" link).
 */
export async function getQtekSession(): Promise<QtekSession | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const objectId = extractEntraObjectId(user);
  if (!objectId) return null;

  const allowed = await resolveAllowedUser(objectId);
  if (!allowed || !allowed.active) return null;

  return {
    email: allowed.email || user.email || "",
    userId: user.id,
    objectId,
    shopId: allowed.shop_id,
    role: allowed.role as QtekRole,
  };
}

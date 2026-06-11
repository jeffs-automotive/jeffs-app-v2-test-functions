/**
 * Sign-in allowlist DAL (Chris's spec) — manage which Microsoft accounts can
 * get into QTekLink (`qteklink_allowed_users`, the table requireQtekUser gates
 * on). Admins add people BY EMAIL; the row stays PENDING (no Entra object id)
 * until that person's first Microsoft sign-in binds the oid automatically
 * (`qteklink_resolve_allowed_user`'s bind-on-first-login step).
 *
 * All writes go through SECURITY DEFINER, service_role-only RPCs that carry the
 * LOCKOUT GUARD (the only active admin can be neither deactivated nor demoted)
 * and the pending-only delete rule. P0001 rejections surface as QboClientError
 * so the actions show the DB's plain-language message to the user.
 *
 * Fat-DAL: pure TS, unit-testable. MULTI-TENANT: shopId is server-derived by
 * the caller (requireQtekUser); every call scopes shop_id. No silent failures.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { QboClientError } from "@/lib/qbo/errors";

export type AllowedRole = "viewer" | "approver" | "admin";

export interface AllowedUserView {
  id: string;
  email: string;
  fullName: string | null;
  role: AllowedRole;
  active: boolean;
  /** false = hasn't signed in yet (pending — no Entra object id bound). */
  bound: boolean;
  createdBy: string | null;
  createdAt: string;
}

interface AllowedUserDbRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  active: boolean;
  entra_object_id: string | null;
  created_by: string | null;
  created_at: string;
}

function rethrow(prefix: string, error: { code?: string; message: string }): never {
  if (error.code === "P0001") throw new QboClientError(error.message, { kind: "unknown" });
  throw new Error(`${prefix} failed: ${error.message}`);
}

/** Every account on the shop's allowlist, oldest first. */
export async function listAllowedUsers(shopId: number): Promise<AllowedUserView[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("qteklink_allowed_users")
    .select("id, email, full_name, role, active, entra_object_id, created_by, created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listAllowedUsers failed: ${error.message}`);
  return ((data ?? []) as AllowedUserDbRow[]).map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role as AllowedRole,
    active: r.active,
    bound: r.entra_object_id != null,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

/** Add a Microsoft account by email (pending until their first sign-in). */
export async function addAllowedUser(
  shopId: number,
  input: { email: string; role: AllowedRole; addedBy: string },
): Promise<{ id: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_add_allowed_user", {
    p_shop_id: shopId,
    p_email: input.email,
    p_role: input.role,
    p_full_name: null,
    p_added_by: input.addedBy,
  });
  if (error) rethrow("qteklink_add_allowed_user", error);
  return { id: String(data) };
}

/** Turn an account on/off. The RPC blocks deactivating the only active admin. */
export async function setAllowedUserActive(
  shopId: number,
  id: string,
  active: boolean,
): Promise<{ changed: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_set_allowed_user_active", {
    p_shop_id: shopId,
    p_id: id,
    p_active: active,
  });
  if (error) rethrow("qteklink_set_allowed_user_active", error);
  return { changed: data === true };
}

/** Change an account's role. The RPC blocks demoting the only active admin. */
export async function setAllowedUserRole(
  shopId: number,
  id: string,
  role: AllowedRole,
): Promise<{ changed: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_set_allowed_user_role", {
    p_shop_id: shopId,
    p_id: id,
    p_role: role,
  });
  if (error) rethrow("qteklink_set_allowed_user_role", error);
  return { changed: data === true };
}

/** Delete a PENDING (never signed in) row — typo cleanup. Bound rows: deactivate. */
export async function removeAllowedUser(
  shopId: number,
  id: string,
): Promise<{ removed: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("qteklink_remove_allowed_user", {
    p_shop_id: shopId,
    p_id: id,
  });
  if (error) rethrow("qteklink_remove_allowed_user", error);
  return { removed: data === true };
}

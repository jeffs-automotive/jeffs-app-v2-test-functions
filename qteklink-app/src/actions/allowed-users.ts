"use server";

/**
 * Sign-in allowlist actions (admin-only) — the /settings "Who can sign in"
 * section: add a Microsoft account by email, switch its role, turn it on/off,
 * and remove a pending (never-signed-in) row. The DB RPCs enforce the lockout
 * guard (the only active admin is protected) and the pending-only delete; their
 * plain-language P0001 messages surface straight to the user.
 *
 * Thin (the QTekLink pattern): requireQtekUser() FIRST → admin gate → Zod → DAL.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import {
  addAllowedUser,
  setAllowedUserActive,
  setAllowedUserRole,
  removeAllowedUser,
} from "@/lib/dal/allowed-users";
import { emailRx } from "@/lib/validate";
import { qboFailure, type QboActionResult } from "./qbo/result";

const AddSchema = z.object({
  email: z.string().trim().toLowerCase().max(200).regex(emailRx, "Enter a valid email address."),
  role: z.enum(["viewer", "admin"], { error: "Pick Viewer or Admin." }),
});
const IdSchema = z.object({ id: z.string().uuid("A valid account id is required.") });
const SetActiveSchema = IdSchema.extend({ active: z.enum(["true", "false"]) });
const SetRoleSchema = IdSchema.extend({ role: z.enum(["viewer", "admin"], { error: "Pick Viewer or Admin." }) });

type UserActionState = QboActionResult<{ done: true }>;

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Only an admin can manage who signs in.", timestamp: Date.now() };
}

function validationFail(message: string): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message, timestamp: Date.now() };
}

async function addAllowedUserImpl(_prev: UserActionState | null, formData: FormData): Promise<UserActionState> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const parsed = AddSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
    if (!parsed.success) return validationFail(parsed.error.issues[0]?.message ?? "Invalid input.");
    await addAllowedUser(shopId, { email: parsed.data.email, role: parsed.data.role, addedBy: email });
    return { ok: true, data: { done: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

async function setAllowedUserActiveImpl(_prev: UserActionState | null, formData: FormData): Promise<UserActionState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const parsed = SetActiveSchema.safeParse({ id: formData.get("id"), active: formData.get("active") });
    if (!parsed.success) return validationFail(parsed.error.issues[0]?.message ?? "Invalid input.");
    await setAllowedUserActive(shopId, parsed.data.id, parsed.data.active === "true");
    return { ok: true, data: { done: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

async function setAllowedUserRoleImpl(_prev: UserActionState | null, formData: FormData): Promise<UserActionState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const parsed = SetRoleSchema.safeParse({ id: formData.get("id"), role: formData.get("role") });
    if (!parsed.success) return validationFail(parsed.error.issues[0]?.message ?? "Invalid input.");
    await setAllowedUserRole(shopId, parsed.data.id, parsed.data.role);
    return { ok: true, data: { done: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

async function removeAllowedUserImpl(_prev: UserActionState | null, formData: FormData): Promise<UserActionState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const parsed = IdSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) return validationFail(parsed.error.issues[0]?.message ?? "Invalid input.");
    const { removed } = await removeAllowedUser(shopId, parsed.data.id);
    if (!removed) {
      return validationFail("That account has already signed in — deactivate it instead of removing it.");
    }
    return { ok: true, data: { done: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const addAllowedUserAction = wrapQtekAction("qtekAddAllowedUser", addAllowedUserImpl);
export const setAllowedUserActiveAction = wrapQtekAction("qtekSetAllowedUserActive", setAllowedUserActiveImpl);
export const setAllowedUserRoleAction = wrapQtekAction("qtekSetAllowedUserRole", setAllowedUserRoleImpl);
export const removeAllowedUserAction = wrapQtekAction("qtekRemoveAllowedUser", removeAllowedUserImpl);

"use server";

/**
 * Mapping actions (C2) — admin-only management of qteklink_mappings.
 *
 * Thin (the QTekLink pattern): requireQtekUser() FIRST, gate to the admin role
 * (only admins manage config, plan §14), Zod-validate the form input, delegate
 * to the mappings DAL, return a typed QboActionResult. The DB RPC is the
 * authoritative role<->account-type gate — a rejection there surfaces as the
 * failure envelope. Shaped for React 19 useActionState (prevState, formData).
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { setMapping, deactivateMapping } from "@/lib/dal/mappings";
import { MAPPING_KINDS, POSTING_ROLES } from "@/lib/mappings/catalog";
import { qboFailure, type QboActionResult } from "./qbo/result";

const SetMappingSchema = z.object({
  kind: z.enum(MAPPING_KINDS),
  sourceKey: z.string().trim().min(1, "Source key is required.").max(200),
  sourceId: z.string().trim().max(200).optional().nullable(),
  qboAccountId: z.string().trim().min(1, "An account is required.").max(100),
  postingRole: z.enum(POSTING_ROLES),
});

type SetMappingState = QboActionResult<{ id: string }>;
type DeactivateState = QboActionResult<{ deactivated: boolean }>;

function adminRequired(): {
  ok: false;
  reason: "validation";
  message: string;
  timestamp: number;
} {
  return {
    ok: false,
    reason: "validation",
    message: "Admin role required to manage mappings.",
    timestamp: Date.now(),
  };
}

async function setMappingImpl(
  _prev: SetMappingState | null,
  formData: FormData,
): Promise<SetMappingState> {
  // Full-body guard (observability rule 1/2): auth + validation + DB all inside
  // the try; qboFailure re-throws Next redirect()/notFound() so they navigate.
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = SetMappingSchema.safeParse({
      kind: formData.get("kind"),
      sourceKey: formData.get("source_key"),
      sourceId: formData.get("source_id") || null,
      qboAccountId: formData.get("qbo_account_id"),
      postingRole: formData.get("posting_role"),
    });
    if (!parsed.success) {
      return {
        ok: false,
        reason: "validation",
        message: parsed.error.issues[0]?.message ?? "Invalid mapping input.",
        timestamp: Date.now(),
      };
    }

    const data = await setMapping(shopId, parsed.data);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

async function deactivateMappingImpl(
  _prev: DeactivateState | null,
  formData: FormData,
): Promise<DeactivateState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const id = z.string().uuid().safeParse(formData.get("id"));
    if (!id.success) {
      return {
        ok: false,
        reason: "validation",
        message: "A valid mapping id is required.",
        timestamp: Date.now(),
      };
    }

    const data = await deactivateMapping(shopId, id.data);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const setMappingAction = wrapQtekAction("qboSetMapping", setMappingImpl);
export const deactivateMappingAction = wrapQtekAction(
  "qboDeactivateMapping",
  deactivateMappingImpl,
);

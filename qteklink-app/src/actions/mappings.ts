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
import { setMapping, deactivateMapping, getMappableAccountType } from "@/lib/dal/mappings";
import { MAPPING_KINDS, derivePostingRole, feePostingRoleForAccountType } from "@/lib/mappings/catalog";
import { qboFailure, type QboActionResult } from "./qbo/result";

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

/**
 * Map a discovered/fixed Tekmetric ITEM to an account (the picker UX). The user picks
 * an item (which carries its kind + sourceKey) + an account; the posting ROLE is derived
 * SERVER-SIDE from (kind, sourceKey) — never trusted from the client. The DB RPC remains
 * the authoritative role<->account-type gate.
 */
const MapItemSchema = z
  .object({
    kind: z.enum(MAPPING_KINDS),
    sourceKey: z.string().trim().min(1, "Pick a Tekmetric item.").max(200),
    qboAccountId: z.string().trim().min(1, "Pick a QuickBooks account.").max(100),
    passThrough: z.boolean().optional(),
    depositsLikeCard: z.boolean().optional(),
  })
  .refine((d) => !d.passThrough || d.kind === "fee", {
    message: "Pass-through applies only to fee mappings.",
    path: ["passThrough"],
  })
  .refine((d) => !d.depositsLikeCard || d.kind === "noncash_payment_type", {
    message: "Deposits-like-a-card applies only to non-cash payment types.",
    path: ["depositsLikeCard"],
  });

async function mapTekmetricItemImpl(
  _prev: SetMappingState | null,
  formData: FormData,
): Promise<SetMappingState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = MapItemSchema.safeParse({
      kind: formData.get("kind"),
      sourceKey: formData.get("source_key"),
      qboAccountId: formData.get("qbo_account_id"),
      passThrough: formData.get("pass_through") === "on",
      depositsLikeCard: formData.get("deposits_like_card") === "on",
    });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid mapping input.", timestamp: Date.now() };
    }

    // Derive the role SERVER-SIDE (never trust a client-supplied role):
    //  - fee: follows the CHOSEN account's QBO type — an Income account books the fee
    //    as revenue (income); an Expense account credits it as a contra-expense offset
    //    (fee_expense). The type is read from the COA server-side; any other type is
    //    not mappable for a fee.
    //  - non-cash "deposits like a card": the financing/deposit path (undeposited_funds).
    //  - everything else: derived from (kind, sourceKey).
    let postingRole: string | null;
    if (parsed.data.kind === "fee") {
      const accountType = await getMappableAccountType(shopId, parsed.data.qboAccountId);
      postingRole = feePostingRoleForAccountType(accountType);
      if (!postingRole) {
        return {
          ok: false,
          reason: "validation",
          message:
            "A fee can post to an income account (booked as revenue) or an expense account (which it offsets). Pick an income or expense account.",
          timestamp: Date.now(),
        };
      }
    } else if (parsed.data.depositsLikeCard && parsed.data.kind === "noncash_payment_type") {
      postingRole = "undeposited_funds";
    } else {
      postingRole = derivePostingRole(parsed.data.kind, parsed.data.sourceKey);
    }
    if (!postingRole) {
      return { ok: false, reason: "validation", message: "That item can't be mapped (unknown posting role).", timestamp: Date.now() };
    }

    const data = await setMapping(shopId, {
      kind: parsed.data.kind,
      sourceKey: parsed.data.sourceKey,
      qboAccountId: parsed.data.qboAccountId,
      postingRole,
      passThrough: parsed.data.passThrough,
    });
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const mapTekmetricItemAction = wrapQtekAction("qboMapTekmetricItem", mapTekmetricItemImpl);
export const deactivateMappingAction = wrapQtekAction(
  "qboDeactivateMapping",
  deactivateMappingImpl,
);

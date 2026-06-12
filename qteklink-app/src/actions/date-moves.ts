"use server";

/**
 * Posting-queue actions (admin-only) — the office manager's controls for repair
 * orders that moved to a different day:
 *
 *   approveDateMoveAction   — accept the new date. The holds lift and BOTH days are
 *                             re-reconciled + their staged corrections AUTO-POSTED
 *                             (the approval IS the consent; the office manager gets
 *                             the change emails). ⚠ touches QuickBooks.
 *   unapproveDateMoveAction — undo an ACCIDENTAL approval. The holds re-engage and
 *                             both days flip back the same way. ⚠ touches QuickBooks.
 *   refreshDateMovesAction  — "Check again": re-scan Tekmetric's latest events; a
 *                             move whose RO is back on its original day auto-clears.
 *
 * Thin (the QTekLink pattern): requireQtekUser() FIRST → admin gate → Zod → DAL.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { refreshDateMoves } from "@/lib/dal/date-moves";
import { applyDateMoveDecision } from "@/lib/dal/posted-day-sweep";
import { qboFailure, type QboActionResult } from "./qbo/result";

const IdSchema = z.object({ id: z.string().uuid("A valid queue item id is required.") });

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Only an admin can act on the posting queue.", timestamp: Date.now() };
}

type MoveState = QboActionResult<{ done: true }>;

async function approveDateMoveImpl(_prev: MoveState | null, formData: FormData): Promise<MoveState> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const parsed = IdSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input.", timestamp: Date.now() };
    }

    const result = await applyDateMoveDecision(shopId, parsed.data.id, "approve", email);
    if (!result.ok) {
      return { ok: false, reason: "validation", message: "That queue item is no longer waiting for approval. Refresh the page.", timestamp: Date.now() };
    }
    return { ok: true, data: { done: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

async function unapproveDateMoveImpl(_prev: MoveState | null, formData: FormData): Promise<MoveState> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const parsed = IdSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input.", timestamp: Date.now() };
    }

    const result = await applyDateMoveDecision(shopId, parsed.data.id, "unapprove", email);
    if (!result.ok) {
      return { ok: false, reason: "validation", message: "That queue item isn't in an approved state. Refresh the page.", timestamp: Date.now() };
    }
    return { ok: true, data: { done: true }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

type RefreshState = QboActionResult<{ detected: number; cleared: number }>;

async function refreshDateMovesImpl(_prev: RefreshState | null, _formData: FormData): Promise<RefreshState> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const detect = await refreshDateMoves(shopId);
    if (!detect) {
      return { ok: false, reason: "reconnect_required", message: "QuickBooks isn't connected for this shop.", timestamp: Date.now() };
    }
    return { ok: true, data: { detected: detect.newOrChangedMoves.length, cleared: detect.autoResolved }, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const approveDateMoveAction = wrapQtekAction("qboApproveDateMove", approveDateMoveImpl);
export const unapproveDateMoveAction = wrapQtekAction("qboUnapproveDateMove", unapproveDateMoveImpl);
export const refreshDateMovesAction = wrapQtekAction("qboRefreshDateMoves", refreshDateMovesImpl);

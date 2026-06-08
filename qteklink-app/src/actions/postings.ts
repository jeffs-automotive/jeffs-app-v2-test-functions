"use server";

/**
 * Posting-queue actions (C8c) — admin-only. Approve / reject a pending posting, and
 * trigger the poster. Thin (the QTekLink pattern): requireQtekUser() FIRST, admin gate,
 * Zod-validate, delegate to the DAL, return a typed QboActionResult.
 *
 * ⚠️ postNextAction CALLS THE LIVE QBO WRITE PATH (postNextApproved with the real
 * QboClient). It is the deliberate human trigger for the first real post — nothing
 * invokes it automatically. Auto-post (a cron path) is separate + still off by default.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { approvePosting, rejectPosting } from "@/lib/dal/postings";
import { postNextApproved, type PostOutcome } from "@/lib/dal/poster";
import { qboFailure, type QboActionResult } from "./qbo/result";

const PostingIdSchema = z.object({ id: z.string().uuid("A valid posting id is required.") });

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Admin role required.", timestamp: Date.now() };
}

async function approvePostingImpl(
  _prev: QboActionResult<{ approved: boolean }> | null,
  formData: FormData,
): Promise<QboActionResult<{ approved: boolean }>> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const parsed = PostingIdSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid id.", timestamp: Date.now() };
    }
    const data = await approvePosting(shopId, parsed.data.id, email);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const approvePostingAction = wrapQtekAction("qboApprovePosting", approvePostingImpl);

async function rejectPostingImpl(
  _prev: QboActionResult<{ rejected: boolean }> | null,
  formData: FormData,
): Promise<QboActionResult<{ rejected: boolean }>> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const parsed = PostingIdSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) {
      return { ok: false, reason: "validation", message: parsed.error.issues[0]?.message ?? "Invalid id.", timestamp: Date.now() };
    }
    const data = await rejectPosting(shopId, parsed.data.id, email);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const rejectPostingAction = wrapQtekAction("qboRejectPosting", rejectPostingImpl);

/** ⚠️ LIVE QBO WRITE — posts the next approved posting. Admin-triggered only. */
async function postNextImpl(
  _prev: QboActionResult<PostOutcome> | null,
  _formData: FormData,
): Promise<QboActionResult<PostOutcome>> {
  try {
    const { shopId, role } = await requireQtekUser();
    if (role !== "admin") return adminRequired();
    const outcome = await postNextApproved(shopId); // real QboClient → live JournalEntry create
    return { ok: true, data: outcome, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}
export const postNextAction = wrapQtekAction("qboPostNext", postNextImpl);

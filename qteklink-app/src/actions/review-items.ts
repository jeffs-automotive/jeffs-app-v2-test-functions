"use server";

/**
 * Resolution-queue actions (C7, §9) — admin-only. Resolve (close) a reconciliation
 * review item from the daily-approvals UI. Thin (the QTekLink pattern):
 * requireQtekUser() FIRST, admin gate, Zod-validate, delegate to the DAL, return a
 * typed QboActionResult. The kind-specific "rebuild + resume posting" flow (apply a
 * picked mapping, record a manual payment…) is the daily-approvals' job; this action
 * just closes the item with the human's resolution + identity.
 */
import { z } from "zod";
import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { resolveReviewItem } from "@/lib/dal/review-items";
import { qboFailure, type QboActionResult } from "./qbo/result";

const ResolveReviewItemSchema = z.object({
  id: z.string().uuid("A valid review-item id is required."),
  // the human's resolution choice / note (free-form; the UI shapes it per kind).
  resolutionNote: z.string().trim().max(2000).optional(),
});

type ResolveReviewItemState = QboActionResult<{ resolved: boolean }>;

function adminRequired(): { ok: false; reason: "validation"; message: string; timestamp: number } {
  return { ok: false, reason: "validation", message: "Admin role required to resolve a review item.", timestamp: Date.now() };
}

async function resolveReviewItemImpl(
  _prev: ResolveReviewItemState | null,
  formData: FormData,
): Promise<ResolveReviewItemState> {
  try {
    const { shopId, role, email } = await requireQtekUser();
    if (role !== "admin") return adminRequired();

    const parsed = ResolveReviewItemSchema.safeParse({
      id: formData.get("id"),
      resolutionNote: formData.get("resolution_note") || undefined,
    });
    if (!parsed.success) {
      return {
        ok: false,
        reason: "validation",
        message: parsed.error.issues[0]?.message ?? "Invalid resolution input.",
        timestamp: Date.now(),
      };
    }

    const data = await resolveReviewItem(
      shopId,
      parsed.data.id,
      { note: parsed.data.resolutionNote ?? null },
      email,
    );
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const resolveReviewItemAction = wrapQtekAction("qboResolveReviewItem", resolveReviewItemImpl);

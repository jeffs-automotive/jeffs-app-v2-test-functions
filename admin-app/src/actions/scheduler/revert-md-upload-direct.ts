"use server";

/**
 * Direct revert for HISTORICAL MD uploads (sub-feature A cleanup).
 *
 * The MD-upload pipeline is retired, but audit rows inside the 30-day
 * revert window stay revertable via the existing outer RPC
 * `revert_md_upload_attempt` (ADR-001/002/020 contract — the RPC is
 * authoritative on eligibility; this action is a thin direct caller that
 * replaced the orchestrator `revert_md_upload` tool). Prunable once the
 * last pre-webform upload ages out.
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdminShopId } from "@/lib/scheduler/shop-id";
import {
  type DirectFormState,
  validationError,
} from "@/lib/scheduler/direct-form-state";

const schema = z.object({
  upload_id: z.coerce.number().int().positive(),
  dry_run: z.coerce.boolean().default(true),
  confirm_token: z.string().optional(),
});

export const revertMdUploadDirectAction = wrapAdminAction(
  "revertMdUploadDirectAction",
  async (args: unknown): Promise<DirectFormState & { rpc?: unknown }> => {
    const admin = await requireAdmin();
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("revert_md_upload_attempt", {
      p_shop_id: resolveAdminShopId(),
      p_upload_id: parsed.data.upload_id,
      p_actor_email: admin.email,
      p_oauth_client_id: "admin_app_direct",
      p_dry_run: parsed.data.dry_run,
      p_expected_confirm_token: parsed.data.confirm_token ?? null,
      p_force_no_after_hash: false,
    });
    if (error) {
      return { status: "error", error: error.message, timestamp: Date.now() };
    }
    if (!parsed.data.dry_run) revalidatePath("/schedulerconfig");
    return { status: "success", timestamp: Date.now(), rpc: data };
  },
);

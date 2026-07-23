// _shared/tekbridge/verify.ts
//
// Closed-loop verification: after a bridge WRITE (internal API), read the record
// back through the **public** API (the OAuth-bearer client we already have) and
// confirm the change landed. This is what makes an unattended mutator
// trustworthy — a standing rule in .claude/rules/orchestration.md.
//
// The public API returns `customerConcerns` inline on the repair-order object
// (TEKMETRIC_API_DOCS.md — Repair Order response), so one GET verifies a concern
// write without any bridge-side read.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tekmetricGetJson } from "../tekmetric-client.ts";

interface RoWithConcerns {
  customerConcerns?: Array<{ id?: number; concern?: string | null }>;
}

/**
 * True if the public API's view of the repair order contains a customer concern
 * whose text matches `concernText` (trimmed compare — Tekmetric preserves the
 * text verbatim). Reads via the PUBLIC API so it's independent of the bridge
 * session that performed the write.
 */
export async function verifyConcernOnRo(
  sb: SupabaseClient,
  repairOrderId: number,
  concernText: string,
): Promise<boolean> {
  const ro = await tekmetricGetJson<RoWithConcerns>(sb, `/repair-orders/${repairOrderId}`);
  const target = concernText.trim();
  return (ro.customerConcerns ?? []).some((c) => (c.concern ?? "").trim() === target);
}

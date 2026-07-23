// _shared/tekbridge/capabilities/write-customer-concern.ts
//
// Capability: write / delete a customer concern on a Tekmetric repair order —
// the internal-API action the PUBLIC API cannot do (proven in recon; the public
// Update Repair Order endpoint has no concern field).
//
// Contract (recon 2026-07-21, docs/tekmetric/headless-automation-research.md §1b):
//   create → POST   /api/repair-orders/{roId}/customer-concerns  {concern, techComment}
//            → { type:"SUCCESS", data:{ id, concern, techComment, repairOrderId } }
//   delete → DELETE /api/customer-concerns/{concernId}           (NOT nested under repair-orders)
//
// Each capability is a small, independently-testable unit. Adding a new ability
// = add a file like this + register it in registry.ts.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tekbridgeJson } from "../client.ts";
import { verifyConcernOnRo } from "../verify.ts";

export interface CreateConcernInput {
  repairOrderId: number;
  concern: string;
  /** The "Finding" field in Tekmetric's UI (internal API field `techComment`). */
  techComment?: string | null;
  /** Verify via the public API after writing (default true). */
  verify?: boolean;
}

export interface CreateConcernResult {
  ok: true;
  concernId: number;
  repairOrderId: number;
  /** true = confirmed present via the public API; false = write succeeded but
   *  read-back didn't confirm (see verifyError) or verification was skipped. */
  verified: boolean;
  verifyError?: string;
}

interface CreateConcernResponse {
  type?: string;
  data?: { id?: number; concern?: string; techComment?: string | null; repairOrderId?: number };
}

/**
 * Create a customer concern on a repair order, then verify it landed via the
 * public API. A verification read that itself errors does NOT fail the call —
 * the write already succeeded; we surface `verified:false` + `verifyError` so
 * the caller can decide.
 */
export async function createCustomerConcern(
  sb: SupabaseClient,
  shopId: number,
  input: CreateConcernInput,
): Promise<CreateConcernResult> {
  const body = { concern: input.concern, techComment: input.techComment ?? null };
  const res = await tekbridgeJson<CreateConcernResponse>(
    sb,
    `/repair-orders/${input.repairOrderId}/customer-concerns`,
    { method: "POST", body, shopId },
  );

  const concernId = res?.data?.id;
  if (typeof concernId !== "number") {
    throw new Error(
      `tekbridge createCustomerConcern: unexpected response (no data.id): ${
        JSON.stringify(res).slice(0, 200)
      }`,
    );
  }

  let verified = false;
  let verifyError: string | undefined;
  if (input.verify !== false) {
    try {
      verified = await verifyConcernOnRo(sb, input.repairOrderId, input.concern);
    } catch (e) {
      verifyError = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: true, concernId, repairOrderId: input.repairOrderId, verified, verifyError };
}

export interface DeleteConcernResult {
  ok: true;
  concernId: number;
}

/** Delete a customer concern by its id (`DELETE /api/customer-concerns/{id}`). */
export async function deleteCustomerConcern(
  sb: SupabaseClient,
  shopId: number,
  input: { concernId: number },
): Promise<DeleteConcernResult> {
  await tekbridgeJson(sb, `/customer-concerns/${input.concernId}`, {
    method: "DELETE",
    shopId,
  });
  return { ok: true, concernId: input.concernId };
}

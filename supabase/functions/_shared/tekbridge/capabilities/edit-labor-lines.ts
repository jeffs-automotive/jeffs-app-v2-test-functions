// _shared/tekbridge/capabilities/edit-labor-lines.ts
//
// Capability: edit existing labor lines on a repair-order job — the action the
// public API can't do (public Update Labor only sets technicianId).
//
// Mechanism (proven live 2026-07-21 on an authorized RO, part + fee preserved):
//   1. GET  /api/repair-order/{roId}/estimate      → the job with its full labor[]
//   2. modify the target labor line(s) in that object
//   3. POST /api/shop/{shopId}/job                 → repost the WHOLE job (upsert)
// Reposting the full job object preserves everything else (other labor, parts,
// fees, discounts, authorization) automatically — no fragile field-stripping.
//
// Primary consumer: the state-inspection app (post a multi-line summary onto a
// labor line, append a sticker number, or mark an emissions line exempt +
// zero its total). Multi-line text (\n) is preserved verbatim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tekbridgeJson } from "../client.ts";

export interface LaborEdit {
  laborId: number;
  /** Replace the labor line's text entirely. */
  name?: string;
  /** Append this to the labor line's existing text (after `name` if both given). */
  appendName?: string;
  /** Set the labor rate, in cents. */
  rateCents?: number;
  /** Set the labor hours. */
  hours?: number;
}

export interface EditLaborResult {
  ok: true;
  jobId: number;
  edited: Array<{ laborId: number; name: string; rate: number; total: number }>;
}

interface EstimateResponse {
  // deno-lint-ignore no-explicit-any
  jobs?: Array<any>;
}
interface JobSaveResponse {
  type?: string;
  // deno-lint-ignore no-explicit-any
  data?: any;
}

/**
 * Apply one or more edits to labor lines on a job, then repost the whole job.
 * Fails (without writing) if the job or any targeted labor line isn't found, so
 * a bad id never silently no-ops or corrupts the job.
 */
export async function editLaborLines(
  sb: SupabaseClient,
  shopId: number,
  input: { repairOrderId: number; jobId: number; edits: LaborEdit[] },
): Promise<EditLaborResult> {
  if (!input.edits.length) {
    throw new Error("edit_labor_lines: at least one edit is required");
  }

  // 1. fetch the job (jobs live on the estimate, not the repair-order object)
  const est = await tekbridgeJson<EstimateResponse>(
    sb,
    `/repair-order/${input.repairOrderId}/estimate`,
    { shopId },
  );
  const job = (est?.jobs ?? []).find((j) => j.id === input.jobId);
  if (!job) {
    throw new Error(
      `edit_labor_lines: job ${input.jobId} not found on repair order ${input.repairOrderId}`,
    );
  }

  // 2. apply each edit to its labor line (validate all targets exist first —
  //    don't write a partial change if one id is wrong)
  const labor: Array<{ id: number; name?: string; rate?: number; hours?: number }> = job.labor ?? [];
  for (const edit of input.edits) {
    const line = labor.find((l) => l.id === edit.laborId);
    if (!line) {
      throw new Error(
        `edit_labor_lines: labor line ${edit.laborId} not found in job ${input.jobId}`,
      );
    }
    if (edit.name !== undefined) line.name = edit.name;
    if (edit.appendName !== undefined) line.name = (line.name ?? "") + edit.appendName;
    if (edit.rateCents !== undefined) line.rate = edit.rateCents;
    if (edit.hours !== undefined) line.hours = edit.hours;
  }

  // 3. repost the whole job (upsert)
  const resp = await tekbridgeJson<JobSaveResponse>(sb, `/shop/${shopId}/job`, {
    method: "POST",
    body: job,
    shopId,
  });
  const saved = resp?.data;
  if (!saved || typeof saved.id !== "number") {
    throw new Error(
      `edit_labor_lines: unexpected response (no data.id): ${JSON.stringify(resp).slice(0, 200)}`,
    );
  }

  // The POST response reflects the saved state — surface the edited lines from it.
  const editedIds = new Set(input.edits.map((e) => e.laborId));
  const edited = (saved.labor ?? [])
    .filter((l: { id: number }) => editedIds.has(l.id))
    .map((l: { id: number; name: string; rate: number; total: number }) => ({
      laborId: l.id,
      name: l.name,
      rate: l.rate,
      total: l.total,
    }));

  return { ok: true, jobId: saved.id, edited };
}

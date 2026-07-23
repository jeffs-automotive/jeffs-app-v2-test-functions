// _shared/tekbridge/registry.ts
//
// The tekbridge **capability registry**. Each capability is a Vercel AI-SDK
// `tool({ description, inputSchema, execute })` — the SAME shape as
// getSchedulerTools() / getOrchestratorTools(). That means:
//   1. The `tekbridge` edge fn dispatches `{capability, input}` against this map
//      (validate input vs the zod schema → execute).
//   2. In Phase 2 the same map merges into `buildMcpToolRegistry`, so the chat
//      orchestrator + admin-app get these capabilities for free.
//
// **Adding a new ability = add a capability file + one entry here.** No gateway
// or protocol change.
//
// Tool names are snake_case and conform to Anthropic's tool-name regex
// ^[a-zA-Z0-9_-]{1,64}$ (enforced again at merge time in mcp-tool-registry.ts).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tool } from "npm:ai@^5";
import { z } from "npm:zod@^4";

import {
  createCustomerConcern,
  deleteCustomerConcern,
} from "./capabilities/write-customer-concern.ts";
import { editLaborLines } from "./capabilities/edit-labor-lines.ts";

export interface TekbridgeToolsArgs {
  sb: SupabaseClient;
  shopId: number;
}

/**
 * Build the tekbridge capability map for a shop. Pure factory — just wires
 * function references, cheap to call per request.
 */
export function getTekbridgeTools(args: TekbridgeToolsArgs) {
  const { sb, shopId } = args;

  return {
    write_customer_concern: tool({
      description:
        "Create a customer concern on a Tekmetric repair order. This is a bridge action the public " +
        "Tekmetric API cannot perform (the public Update Repair Order endpoint has no concern field). " +
        "Use it to record what the customer is reporting (e.g. when they update appointment details) so " +
        "it appears in the RO's Customer Concerns list. `concern` is the customer's complaint; " +
        "`tech_comment` is the optional Finding text. Returns the new concern id and whether it was " +
        "verified present via the public API.",
      inputSchema: z.object({
        repair_order_id: z.number().int().positive().describe("Tekmetric internal repair-order id"),
        concern: z.string().min(1).max(2000).describe("Customer's concern text"),
        tech_comment: z.string().max(2000).optional().describe("Optional Finding text"),
        verify: z.boolean().optional().describe("Verify via public API after write (default true)"),
      }),
      execute: async (input: {
        repair_order_id: number;
        concern: string;
        tech_comment?: string;
        verify?: boolean;
      }) =>
        createCustomerConcern(sb, shopId, {
          repairOrderId: input.repair_order_id,
          concern: input.concern,
          techComment: input.tech_comment ?? null,
          verify: input.verify,
        }),
    }),

    delete_customer_concern: tool({
      description:
        "Delete a customer concern from a Tekmetric repair order by its concern id. Bridge action " +
        "(no public API equivalent). Use to remove a concern that was added in error or supersede one " +
        "you're replacing. Requires the concern's id (as returned by write_customer_concern or a read).",
      inputSchema: z.object({
        concern_id: z.number().int().positive().describe("Tekmetric customer-concern id to delete"),
      }),
      execute: async (input: { concern_id: number }) =>
        deleteCustomerConcern(sb, shopId, { concernId: input.concern_id }),
    }),

    edit_labor_lines: tool({
      description:
        "Edit existing labor lines on a Tekmetric repair-order job. Bridge action (the public API's " +
        "Update Labor only sets technicianId). For each edit, target a labor line by its labor_id and " +
        "either replace its text (name), append text to it (append_name), set its rate (rate_cents), " +
        "or set its hours. Reposts the whole job, preserving all other labor, parts, fees, and " +
        "authorization. Multi-line text (\\n) is kept verbatim. Primary use: the state-inspection app " +
        "posting a summary onto a labor line, appending a sticker number, or marking an emissions line " +
        "exempt and zeroing its total. Requires the repair-order id, the job id, and the labor ids " +
        "(obtain them by reading the RO's estimate/jobs first).",
      inputSchema: z.object({
        repair_order_id: z.number().int().positive().describe("Tekmetric internal repair-order id"),
        job_id: z.number().int().positive().describe("Job id whose labor lines are edited"),
        edits: z.array(
          z.object({
            labor_id: z.number().int().positive().describe("Labor line id to edit"),
            name: z.string().max(4000).optional().describe("Replace the labor text entirely (supports \\n)"),
            append_name: z.string().max(4000).optional().describe("Append this to the existing labor text"),
            rate_cents: z.number().int().min(0).optional().describe("Set the labor rate, in cents"),
            hours: z.number().min(0).optional().describe("Set the labor hours"),
          }),
        ).min(1).describe("One or more labor-line edits"),
      }),
      execute: async (input: {
        repair_order_id: number;
        job_id: number;
        edits: Array<{ labor_id: number; name?: string; append_name?: string; rate_cents?: number; hours?: number }>;
      }) =>
        editLaborLines(sb, shopId, {
          repairOrderId: input.repair_order_id,
          jobId: input.job_id,
          edits: input.edits.map((e) => ({
            laborId: e.labor_id,
            name: e.name,
            appendName: e.append_name,
            rateCents: e.rate_cents,
            hours: e.hours,
          })),
        }),
    }),
  };
}

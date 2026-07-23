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
  };
}

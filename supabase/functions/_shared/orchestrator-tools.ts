// AI SDK tool registry for the orchestrator.
//
// Wraps each pure tool function from `_shared/tools/` into a Vercel AI SDK
// `tool({ description, inputSchema, execute })` definition. The orchestrator
// passes this map into `generateText({ ..., tools: getOrchestratorTools(...) })`
// and the model picks which to call based on each tool's description.
//
// Tool description guidance (read this when adding new tools):
//   - Be specific about WHEN this tool is the right answer. Vague descriptions
//     cause routing mistakes.
//   - Mention the FUZZY phrasings the user might use. The orchestrator only sees
//     this description when deciding — if a user asks "which car has key tag 5"
//     and the tool description doesn't mention "car", the model may not pick it.
//   - List what the tool RETURNS so the orchestrator knows whether one call
//     suffices or whether it needs a follow-up.
//
// Logging: each tool's execute logs to public.tool_calls before/after via the
// supplied recorder. If the tool throws, the error message is captured.

// AI SDK pinned at v5 — see .claude/memory/ai_sdk_and_models.md.
// v6 has an open bug (vercel/ai #12020) that drops zod input_schema when used
// with the Anthropic provider's tool calls; switch to v6 only when that closes.
// zod must be 4.1.8+ — AI SDK 5+ uses the v2 schema spec.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tool } from "npm:ai@^5";
import { z } from "npm:zod@^4";

import { listWipKeyTags } from "./tools/repair-orders.ts";
import { assignKeytagToRo, releaseKeytagFromRo } from "./tools/keytag-management.ts";
import {
  whoIsOnTag,
  revertKeytagToAssigned,
  markKeytagPosted,
  runBulkReconcile,
  getKeytagAuditHistory,
} from "./tools/keytag-extras.ts";
import {
  lookupManualReviewTool,
  resolveManualReviewTool,
} from "./tools/manual-review-tools.ts";

// ─── Tool-call recorder (writes to public.tool_calls) ────────────────────────

export interface ToolCallRecorder {
  recordStart(args: { toolName: string; input: unknown; stepNumber: number }): Promise<string>;
  recordEnd(args: {
    toolCallId: string;
    output?: unknown;
    error?: string;
  }): Promise<void>;
}

export function makeToolCallRecorder(sb: SupabaseClient, runId: string): ToolCallRecorder {
  let stepCounter = 0;
  return {
    async recordStart({ toolName, input }) {
      stepCounter += 1;
      const { data, error } = await sb
        .from("tool_calls")
        .insert({
          run_id: runId,
          tool_name: toolName,
          step_number: stepCounter,
          input,
        })
        .select("id")
        .single();
      if (error) {
        // Logging failure should not block the actual tool call — just warn and proceed.
        console.error("tool_calls insert failed:", error.message);
        return "";
      }
      return data!.id as string;
    },
    async recordEnd({ toolCallId, output, error }) {
      if (!toolCallId) return; // recordStart failed; nothing to update
      const truncatedOutput = truncateForLog(output);
      await sb
        .from("tool_calls")
        .update({
          output: truncatedOutput.value,
          output_truncated: truncatedOutput.truncated,
          ended_at: new Date().toISOString(),
          latency_ms: null,             // computed by trigger or set by caller if needed
          error_message: error ?? null,
        })
        .eq("id", toolCallId);
    },
  };
}

function truncateForLog(value: unknown): { value: unknown; truncated: boolean } {
  if (value === undefined || value === null) return { value, truncated: false };
  const json = JSON.stringify(value);
  const limit = 8 * 1024; // 8 KB
  if (json.length <= limit) return { value, truncated: false };
  return {
    value: { _truncated: true, preview: json.slice(0, limit) },
    truncated: true,
  };
}

// ─── Build the tool map passed to generateText ───────────────────────────────

export function getOrchestratorTools(args: {
  sb: SupabaseClient;
  shopId: number;
  recorder: ToolCallRecorder;
  /**
   * The MCP OAuth user_label of the human driving this orchestrator run.
   * Threaded into keytag mutations so we can attribute "who assigned R5"
   * via keytag_audit_log + keytags.changed_by_user_label. Empty string OK
   * (early orchestrator-direct callers won't have it).
   */
  userLabel?: string;
  /**
   * Project URL + service-role key required by tools that invoke other
   * Supabase Edge Functions (e.g. runBulkReconcile calls keytag-bulk-reconcile
   * via HTTPS with the same service-role bearer the cron uses).
   */
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  const { sb, shopId, recorder, userLabel, supabaseUrl, serviceRoleKey } = args;

  return {
    listWipKeyTags: tool({
      description:
        "Returns every repair order currently in WIP (work-in-progress) status that has a key tag assigned. " +
        "Each result has the key tag number, repair-order number (RO #), Tekmetric internal RO id, customer id, " +
        "vehicle id, and a direct link to open the RO in Tekmetric. Use this when the user asks to list all " +
        "active key tags, see who is in the shop right now, count active jobs, or anything that requires the " +
        "full set of currently-assigned tags. The list only contains active WIP orders — posted, paid, or " +
        "deleted ROs are excluded.",
      inputSchema: z.object({}),
      execute: async () => {
        const callId = await recorder.recordStart({
          toolName: "listWipKeyTags",
          input: {},
          stepNumber: 0,
        });
        try {
          const result = await listWipKeyTags(sb, shopId);
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    whoIsOnTag: tool({
      description:
        "**Canonical tag-to-RO lookup tool.** Use this for ANY 'who's on Red 5' / 'which RO has " +
        "Yellow 45' / 'what car is on tag X' / 'tell me about Red 7' question. Returns ro_number, " +
        "status (assigned or posted_ar), Tekmetric link, customer name (handles business customers " +
        "like Carmax / Nazareth Key correctly), and vehicle year/make/model. Returns found:false if " +
        "the tag is currently available (not on any RO). The advisor MUST specify both color and " +
        "number — never assume. Makes up to 3 Tekmetric API calls (RO + customer + vehicle) so " +
        "responses take ~2-4 seconds; this is the right trade-off for the richer answer.",
      inputSchema: z.object({
        color: z.enum(["red", "yellow"]).describe("Tag color — required."),
        tag_number: z.number().int().min(1).max(90).describe("Tag number 1-90."),
      }),
      execute: async ({ color, tag_number }) => {
        const callId = await recorder.recordStart({
          toolName: "whoIsOnTag",
          input: { color, tag_number },
          stepNumber: 0,
        });
        try {
          const result = await whoIsOnTag(sb, shopId, { color, number: tag_number });
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    assignKeytagToRo: tool({
      description:
        "Assigns a key tag to a repair order. Use this when a service advisor says any of: " +
        "'put red 5 on RO 152222', 'give RO 152222 a key tag', 'I just used yellow 12 for RO 152300', " +
        "'add a key tag to repair order 152222'. " +
        "Two modes: (1) if the user names a SPECIFIC tag (color + number), pass color and tag_number — " +
        "we force-assign that exact tag and PATCH Tekmetric. (2) if the user says 'give it a tag' / 'auto " +
        "assign' / no specific tag mentioned, OMIT color and tag_number — we round-robin pick the next " +
        "available tag. " +
        "**TWO-STEP CONFIRMATION:** force-assign mode (specific color+number) returns " +
        "`{ok:false, needs_confirmation:true, confirmation:{token_id, scope_summary, expires_at}}` on the " +
        "FIRST call. Surface the scope_summary to the user and ask for a YES/NO confirmation. On YES, " +
        "re-call this tool with the SAME ro_number+color+tag_number AND confirmation_token=token_id. " +
        "Auto round-robin assign (no color+number) does NOT require confirmation. " +
        "Errors to surface to the user verbatim: 'tag_in_use_by_other_ro' (suggest a different tag), " +
        "'ro_already_has_tag' (mention which tag is already on it), 'pool_exhausted' (all 180 in use), " +
        "'confirmation_failed' (token expired or scope mismatch — re-request fresh). " +
        "On success, tell the user which tag was assigned and include the ro_url.",
      inputSchema: z.object({
        ro_number: z.number().int().positive().describe(
          "The repair order number (the shop-facing RO #). Required.",
        ),
        color: z.enum(["red", "yellow"]).optional().describe(
          "Tag color, only when the user named a specific tag. Omit for auto round-robin.",
        ),
        tag_number: z.number().int().min(1).max(90).optional().describe(
          "Tag number 1-90, only when the user named a specific tag. Omit for auto round-robin. Must be paired with `color`.",
        ),
        confirmation_token: z.string().uuid().optional().describe(
          "UUID returned by the first call to this tool when force-assign is requested. Pass it on the second call (after the user confirms) to actually execute. Omit on the first call.",
        ),
      }).refine(
        (v) => (v.color === undefined) === (v.tag_number === undefined),
        { message: "color and tag_number must both be provided or both omitted" },
      ),
      execute: async ({ ro_number, color, tag_number, confirmation_token }) => {
        const input = { ro_number, color, tag_number, confirmation_token };
        const callId = await recorder.recordStart({
          toolName: "assignKeytagToRo",
          input,
          stepNumber: 0,
        });
        try {
          const result = await assignKeytagToRo(sb, shopId, {
            roNumber: ro_number,
            color,
            tagNumber: tag_number,
            userLabel,
            confirmationToken: confirmation_token,
          });
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    releaseKeytagFromRo: tool({
      description:
        "Releases the key tag currently held by a repair order, returning it to the available pool AND " +
        "clearing the keyTag field in Tekmetric. Use this when a service advisor says any of: " +
        "'release the tag from RO 152222', 'the keys are off RO 152300', 'free up RO 152222's tag', " +
        "'remove the key tag from repair order 152222', 'take the tag off RO 152222'. " +
        "Common case: fleet vehicles (Carmax etc.) that stay in A/R for ~30 days — the keys leave the " +
        "shop long before the RO closes, so the advisor manually releases the tag. " +
        "**TWO-STEP CONFIRMATION (A/R lockdown):** if the RO is in A/R status (`posted_ar`), the FIRST " +
        "call returns `{ok:false, needs_confirmation:true, confirmation:{token_id, scope_summary, " +
        "expires_at}}`. Surface scope_summary to the user, get explicit YES, then re-call with the SAME " +
        "ro_number AND confirmation_token=token_id. WIP-status releases proceed without confirmation. " +
        "If the RO didn't have a tag in our records, the tool returns ok:true with released_tag:null and " +
        "a clear message — relay that to the user as 'no tag was assigned to that RO'. " +
        "Errors: 'confirmation_failed' means the token was bad — re-request a fresh one. " +
        "On success, tell the user which tag was freed (e.g. 'Released Red 5 from RO 152222').",
      inputSchema: z.object({
        ro_number: z.number().int().positive().describe(
          "The repair order number to free. Required.",
        ),
        confirmation_token: z.string().uuid().optional().describe(
          "UUID returned by the first call to this tool when the RO is in A/R status. Pass it on the second call (after the user confirms) to actually execute. Omit on the first call.",
        ),
      }),
      execute: async ({ ro_number, confirmation_token }) => {
        const callId = await recorder.recordStart({
          toolName: "releaseKeytagFromRo",
          input: { ro_number, confirmation_token },
          stepNumber: 0,
        });
        try {
          const result = await releaseKeytagFromRo(sb, shopId, {
            roNumber: ro_number,
            userLabel,
            confirmationToken: confirmation_token,
          });
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    revertKeytagToAssigned: tool({
      description:
        "Reverts a tag from posted_ar (A/R) status back to assigned (WIP). Use this when an advisor " +
        "un-posts an A/R balance and the RO is really back in WIP — phrases like 'put RO 152222 back " +
        "to WIP, the customer didn't actually pay', 'undo the post on RO 152300', 'flip the tag back " +
        "to active for RO 152222'. Idempotent: if the tag is already 'assigned', refreshes the activity " +
        "timestamp and reports already_assigned:true. Only modifies our DB — does NOT call Tekmetric. " +
        "(Tekmetric's A/R-to-WIP regression is the human's job in Tekmetric.) " +
        "**TWO-STEP CONFIRMATION (A/R lockdown):** if the tag is currently in posted_ar, the FIRST call " +
        "returns `{ok:false, needs_confirmation:true, confirmation:{token_id, scope_summary, " +
        "expires_at}}`. Surface scope_summary to the user, get explicit YES, then re-call with the SAME " +
        "ro_number AND confirmation_token=token_id. Already-assigned ROs proceed without confirmation. " +
        "Note: the normal A/R regression flow is handled automatically by the nightly reconcile + the " +
        "status_updated webhook — only use this tool for explicit manual override.",
      inputSchema: z.object({
        ro_number: z.number().int().positive().describe(
          "The repair order number whose tag should flip back from posted_ar to assigned.",
        ),
        confirmation_token: z.string().uuid().optional().describe(
          "UUID returned by the first call when the tag is in A/R status. Pass it on the second call (after the user confirms) to actually execute. Omit on the first call.",
        ),
      }),
      execute: async ({ ro_number, confirmation_token }) => {
        const callId = await recorder.recordStart({
          toolName: "revertKeytagToAssigned",
          input: { ro_number, confirmation_token },
          stepNumber: 0,
        });
        try {
          const result = await revertKeytagToAssigned(sb, {
            roNumber: ro_number,
            userLabel,
            confirmationToken: confirmation_token,
          });
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    markKeytagPosted: tool({
      description:
        "Marks a tag as posted_ar (A/R balance) for the given RO. Use this when an advisor wants to " +
        "manually mark a tag posted because the Tekmetric 'sent to A/R' webhook was missed and they " +
        "don't want to wait for the nightly reconcile. Phrases: 'mark RO 152222 as A/R', 'post RO 152300 " +
        "to A/R'. By default uses now() as the posted_at timestamp (which means the staleness clock " +
        "starts now, not at the actual Tekmetric A/R transition time). Use the optional posted_at " +
        "parameter only if the advisor knows the exact transition time. Does NOT call Tekmetric — " +
        "Tekmetric refuses PATCH on A/R ROs anyway. This is a DB-only override. " +
        "**TWO-STEP CONFIRMATION (A/R lockdown):** flipping a tag into posted_ar locks it (Tekmetric " +
        "will refuse all future PATCHes). The FIRST call returns `{ok:false, needs_confirmation:true, " +
        "confirmation:{token_id, scope_summary, expires_at}}`. Surface scope_summary to the user, get " +
        "explicit YES, then re-call with the SAME ro_number+posted_at AND confirmation_token=token_id.",
      inputSchema: z.object({
        ro_number: z.number().int().positive().describe(
          "The repair order number whose tag should be marked posted_ar.",
        ),
        posted_at: z.string().datetime().optional().describe(
          "Optional ISO 8601 timestamp for when the RO was sent to A/R. Defaults to now() if omitted.",
        ),
        confirmation_token: z.string().uuid().optional().describe(
          "UUID returned by the first call. Pass on the second call (after the user confirms) to actually execute.",
        ),
      }),
      execute: async ({ ro_number, posted_at, confirmation_token }) => {
        const callId = await recorder.recordStart({
          toolName: "markKeytagPosted",
          input: { ro_number, posted_at, confirmation_token },
          stepNumber: 0,
        });
        try {
          const result = await markKeytagPosted(sb, {
            roNumber: ro_number,
            postedAt: posted_at,
            userLabel,
            confirmationToken: confirmation_token,
          });
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    runBulkReconcile: tool({
      description:
        "Triggers an on-demand keytag-bulk-reconcile run (the same operation that runs nightly at " +
        "6 AM ET). Use this when an advisor wants to refresh the keytag pool mid-day or check that " +
        "everything is in sync after a Tekmetric outage / weird state. Returns a summary: total " +
        "WIP/AR ROs scanned, actions taken (assigned_new, marked_posted, reverted, released_orphan, " +
        "etc.), final pool counts. If dry_run is true, no writes happen — just shows what WOULD " +
        "happen. If overwrite is true, re-PATCHes every Tekmetric keytag field even when it already " +
        "matches our DB (used only for the legacy migration — advisors should NEVER set this true).",
      inputSchema: z.object({
        dry_run: z.boolean().optional().describe(
          "If true, returns the action plan without writing anything. Default false.",
        ),
        overwrite: z.boolean().optional().describe(
          "DO NOT use this unless explicitly migrating from legacy tags. Default false.",
        ),
      }),
      execute: async ({ dry_run, overwrite }) => {
        const callId = await recorder.recordStart({
          toolName: "runBulkReconcile",
          input: { dry_run, overwrite },
          stepNumber: 0,
        });
        try {
          const result = await runBulkReconcile({
            supabaseUrl,
            serviceRoleKey,
            dryRun: dry_run,
            overwrite,
          });
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    lookupManualReview: tool({
      description:
        "Looks up the situation + options for a 6-character review code from an email. Use this when " +
        "the advisor types something like 'code ORP-A4B72C' or 'I got an email about ARN-X3K9P2'. " +
        "Returns the issue summary in plain English plus the list of options the advisor can pick from. " +
        "If the advisor only gives the code (no option selected), call this first to present the options. " +
        "If the advisor gives both the code AND their choice (e.g. 'code ORP-A4B72C option a' or " +
        "'release' / 'no_tag'), skip directly to resolveManualReview. " +
        "Codes have a 3-letter prefix indicating category: ORP=orphan release, DRF=drift on work approval, " +
        "REG=A/R regression, ARN=A/R no prior tag, PAF=Tekmetric write failure. " +
        "Failure cases to surface: code_not_found (advisor mistyped — ask them to re-check the email), " +
        "lockout_active (too many wrong codes — wait an hour), already_resolved (issue was already handled).",
      inputSchema: z.object({
        code: z.string().min(7).max(20).describe(
          "The 6-character review code from the email, with or without the prefix dash (e.g. 'ORP-A4B72C' or 'ORPA4B72C').",
        ),
      }),
      execute: async ({ code }) => {
        const callId = await recorder.recordStart({
          toolName: "lookupManualReview",
          input: { code },
          stepNumber: 0,
        });
        try {
          const result = await lookupManualReviewTool(sb, {
            code,
            userLabel: userLabel ?? "",
          });
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    resolveManualReview: tool({
      description:
        "Applies the advisor's chosen option to a manual-review code, marks the code resolved, and " +
        "writes an audit-log entry. Use this when the advisor names a 6-character code AND a specific " +
        "choice (e.g. 'code ORP-A4B72C option release', 'option keep_tag', 'option no_tag'). " +
        "**Authority semantics:** the 6-character code from the email IS the pre-approval. This tool " +
        "does NOT additionally require a UUID confirmation token — the advisor confirmed by entering " +
        "the code + their selection. The tool applies the action immediately and surfaces the result. " +
        "Some choices require a tag color + number (e.g. 'track_tag' on an ARN review, 'use_different_tag' " +
        "on a DRF review). If the choice's option has needs_tag_input=true (visible from lookupManualReview), " +
        "the advisor must say something like 'option track_tag red 5'. Pass color='red' and tag_number=5. " +
        "Always relay the result message to the advisor verbatim — it tells them exactly what changed.",
      inputSchema: z.object({
        code: z.string().min(7).max(20).describe(
          "The 6-character review code (with or without dash).",
        ),
        choice: z.string().min(2).max(40).describe(
          "The option key the advisor picked (e.g. 'release', 'keep_tag', 'track_tag', 'use_prior_tag', 'no_tag', 'escalate_chris').",
        ),
        color: z.enum(["red", "yellow"]).optional().describe(
          "Tag color — required when the chosen option's needs_tag_input is true (e.g. track_tag, use_different_tag).",
        ),
        tag_number: z.number().int().min(1).max(90).optional().describe(
          "Tag number 1-90 — required when the chosen option's needs_tag_input is true.",
        ),
        notes: z.string().max(500).optional().describe(
          "Optional free-form note the advisor wants on the resolution (e.g. context for an escalation).",
        ),
      }),
      execute: async ({ code, choice, color, tag_number, notes }) => {
        const callId = await recorder.recordStart({
          toolName: "resolveManualReview",
          input: { code, choice, color, tag_number, notes },
          stepNumber: 0,
        });
        try {
          const result = await resolveManualReviewTool(sb, shopId, {
            code,
            choice,
            userLabel: userLabel ?? "",
            color,
            tagNumber: tag_number,
            notes,
          });
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    getKeytagAuditHistory: tool({
      description:
        "Queries the keytag mutation audit log. Use this for accountability questions: 'who released " +
        "Red 5 yesterday', 'what did mike do today', 'show me all the changes in the last hour', " +
        "'who's been most active assigning tags this week'. " +
        "DEFAULT BEHAVIOR (no filters): returns the most recent 50 entries from the last 24 hours. " +
        "If the result set is truncated (more than 50 in window), the message tells the advisor and " +
        "they can narrow with filters. " +
        "Available filters (all optional): since/until (ISO datetimes), user_label (email of the " +
        "advisor), tag_color + tag_number (specific tag), ro_number, action (assigned, force_assigned, " +
        "marked_posted, reverted, released, released_orphan), source (claude_desktop, webhook, cron, " +
        "manual_sql). " +
        "If the advisor's question is vague ('what happened today'), default to the last 24 hours. " +
        "If the result set is large and the advisor wants a SPECIFIC change, ask for the time window " +
        "or the tag/RO/user they care about before calling.",
      inputSchema: z.object({
        since: z.string().datetime().optional().describe(
          "ISO 8601 datetime — only return entries after this. Defaults to 24 hours ago.",
        ),
        until: z.string().datetime().optional().describe(
          "ISO 8601 datetime — only return entries before this. Defaults to now.",
        ),
        user_label: z.string().optional().describe(
          "Filter by advisor's email/identifier (the user_label captured at OAuth consent).",
        ),
        tag_color: z.enum(["red", "yellow"]).optional().describe(
          "Filter by tag color. Pair with tag_number for a specific tag.",
        ),
        tag_number: z.number().int().min(1).max(90).optional().describe(
          "Filter by tag number 1-90. Pair with tag_color.",
        ),
        ro_number: z.number().int().positive().optional().describe(
          "Filter by RO number.",
        ),
        action: z
          .enum([
            "assigned",
            "force_assigned",
            "marked_posted",
            "reverted",
            "released",
            "released_orphan",
          ])
          .optional()
          .describe("Filter by mutation type."),
        source: z
          .enum(["claude_desktop", "webhook", "cron", "manual_sql"])
          .optional()
          .describe("Filter by how the mutation happened."),
        limit: z.number().int().min(1).max(200).optional().describe(
          "Maximum entries to return. Default 50, max 200.",
        ),
      }),
      execute: async (filters) => {
        const callId = await recorder.recordStart({
          toolName: "getKeytagAuditHistory",
          input: filters,
          stepNumber: 0,
        });
        try {
          const result = await getKeytagAuditHistory(sb, filters);
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),
  };
}

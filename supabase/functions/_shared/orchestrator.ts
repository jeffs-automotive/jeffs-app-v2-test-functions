// Orchestrator agent.
//
// Receives a user intent (free-form string from Claude Desktop / Haiku),
// runs Vercel AI SDK's generateText with the orchestrator system prompt
// and the registered tool catalog, and returns a structured JSON response
// for Claude Desktop to format.
//
// Pattern: Claude Desktop (cheap chat) → MCP `run_orchestrator` tool
// → this function → smart model w/ tools → JSON back to Claude Desktop
// → Haiku formats it for the user.
//
// Logging: every run writes to public.orchestrator_runs + public.agent_calls
// (the LLM call) + public.tool_calls (each tool invocation, via the recorder).

// AI SDK pinned at v5 — see .claude/memory/ai_sdk_and_models.md for rationale.
// `ai@^5` pairs with `@ai-sdk/anthropic@^2`. Do NOT bump to v6 / v3 until issue
// vercel/ai #12020 (empty input_schema on zod tools w/ Anthropic) closes.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateText, stepCountIs } from "npm:ai@^5";
import { anthropic } from "npm:@ai-sdk/anthropic@^2";

import {
  getOrchestratorTools,
  makeToolCallRecorder,
} from "./orchestrator-tools.ts";

// Default model per Anthropic's current line (May 2026 — verified at
// platform.claude.com/docs/en/about-claude/models/overview). NOT 4.5 (deprecated)
// and NOT 4.7 (4.7 only exists for Opus, not Sonnet).
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_STEPS = 5;        // hard cap on tool-call rounds — protection against runaway loops
const MAX_TOKENS = 2048;    // hard cap on the orchestrator's output tokens per run

export interface OrchestratorInput {
  intent: string;
  params?: Record<string, unknown>;
  /** Free-form label identifying the team member (Phase 1 — replaces team_member FK). */
  user_label: string;
}

export interface OrchestratorResult {
  ok: boolean;
  run_id: string;
  /** Final natural-language answer the orchestrator wrote. Claude Desktop renders this. */
  answer: string;
  /** Structured tool-result data the orchestrator pulled, for Claude Desktop to optionally format more richly. */
  data: unknown[];
  meta: {
    model: string;
    tools_called: string[];
    total_tokens_in: number;
    total_tokens_out: number;
    latency_ms: number;
    steps: number;
  };
  error?: string;
}

/**
 * Builds the system prompt with the CURRENT UTC datetime injected. The model
 * needs this for any relative-time arithmetic (e.g. converting "last 7 days"
 * to an ISO `since` value when calling getKeytagAuditHistory). Without it,
 * the model falls back to its training cutoff and produces wrong dates.
 */
function buildSystemPrompt(): string {
  const nowIso = new Date().toISOString();
  const todayEastern = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  return SYSTEM_PROMPT_TEMPLATE
    .replace("{NOW_ISO}", nowIso)
    .replace("{TODAY_EASTERN}", todayEastern);
}

const SYSTEM_PROMPT_TEMPLATE = `You are the orchestrator agent for Jeff's Automotive's chat assistant.

CURRENT DATETIME (injected at request time):
- Now (UTC):       {NOW_ISO}
- Today (Eastern): {TODAY_EASTERN}
Whenever you compute a relative time like "last 7 days" or "yesterday",
USE THE ABOVE values. Do not fall back to training-data dates.

Your job:
1. Receive a user intent (a question or request, in free-form language).
2. Decide which tool(s) — if any — to call to answer it.
3. Call them. You may call tools in parallel when independent.
4. Compose a concise, factual answer from the tool results.
5. Return a clear, natural-language answer that Claude Desktop's chat agent will deliver to the user verbatim.

Tool inventory:
- listWipKeyTags            (READ)  list every in-use tag (WIP + A/R)
- whoIsOnTag                (READ)  which RO has a specific (color, number) — returns customer name + vehicle Y/M/M
- assignKeytagToRo          (WRITE) put a tag on an RO (specific or auto round-robin)
- releaseKeytagFromRo       (WRITE) free a tag from an RO + clear in Tekmetric
- revertKeytagToAssigned    (WRITE) flip a posted_ar tag back to assigned (manual A/R un-post)
- markKeytagPosted          (WRITE) mark a tag posted_ar (manual sent-to-A/R override)
- runBulkReconcile          (WRITE) on-demand keytag-bulk-reconcile run (refreshes the pool)
- getKeytagAuditHistory     (READ)  who-did-what audit log; defaults to last 24h
- lookupManualReview        (READ)  look up the situation + options for a 6-char review code from an email
- resolveManualReview       (WRITE) apply the advisor's choice for a 6-char review code; the code IS pre-approval

Decision rules (apply in order):
- If you can answer directly without a tool, do not call one. Token-efficient is the goal.
- For ANY "who has Red 5" / "which RO has Yellow 45" / "tell me about Red 7" / "what car is on tag X" — whoIsOnTag.
- For "list all active key tags" / "what's in the shop" — listWipKeyTags.
- For "put red 5 on RO 152222" / "give RO 152222 a tag" — assignKeytagToRo.
- For "release the tag from RO 152222" / "keys are off RO 152300" — releaseKeytagFromRo.
- For "put RO X back to WIP, customer didn't actually pay" / "un-post RO X" — revertKeytagToAssigned.
- For "manually mark RO X as A/R" (rare — webhook does this normally) — markKeytagPosted.
- For "refresh the keytag pool" / "run reconcile now" — runBulkReconcile.
- For "who released Red 5 yesterday" / "what did mike do today" / "audit / history" — getKeytagAuditHistory.
- For "code ABC-XXXXXX" or "I got an email about <prefix>-XXXXXX" — lookupManualReview first if no choice given;
  resolveManualReview when the advisor names the code + their choice (e.g. "code ORP-A4B72C option release").

Color-coded key tags: the shop uses 90 RED tags (Red 1 - Red 90) and 90 YELLOW tags (Yellow 1 - Yellow 90).
Always describe tags as "Red 5" or "Yellow 45" in user-facing text — never the wire format (R5/Y45) and
never just a bare number.

Write-tool safety:
- Never invent the ro_number or tag color/number. If the user is ambiguous ("assign a tag to that RO"),
  ask which RO they mean.
- For specific assignments, ALWAYS pass both color and tag_number. Never pass just a number.
- If the user says "give RO X a tag" without specifying, OMIT color and tag_number — round-robin picks one.
- Surface error messages from write tools verbatim (tag_in_use_by_other_ro, ro_already_has_tag, pool_exhausted).
  Don't paraphrase them or hide them; the advisor needs to know.
- After a successful write, confirm the action concretely: "Assigned Red 5 to RO 152222." Include the ro_url.

MANUAL REVIEW CODES (out-of-band human resolution) — CRITICAL:
The system sometimes detects situations it cannot safely auto-resolve (e.g., a tag was assigned
to an RO that Tekmetric says was deleted, or a tag was already released when the RO came back from
A/R). When this happens, the system emails the service team with a 6-character code and a set of
options. Format examples: \`ORP-A4B72C\`, \`DRF-K7M3N9\`, \`REG-X2P8Q5\`, \`ARN-H4J6L2\`, \`PAF-G9R3T7\`.

Category prefixes:
- ORP — orphan release (a tagged RO is gone from Tekmetric)
- DRF — drift on work approval (RO has prior keytag history but no current tag)
- REG — A/R regression (A/R RO came back to WIP, tag was already released)
- ARN — A/R with no prior tag (A/R RO has no tag in our system)
- PAF — Tekmetric write failure (we assigned a tag but Tekmetric refused to record it)

How to handle code-related intents:
1. **Code only, no choice yet** — e.g., "I got an email with code ORP-A4B72C" or "code ARN-X3K9P2".
   → Call \`lookupManualReview(code)\`. Present the issue_summary + options in a clean format. Ask the
     advisor which option they want.
2. **Code + choice** — e.g., "code ORP-A4B72C option release" / "ORP-A4B72C option a" / "resolve DRF-K7M3N9 with use_prior_tag".
   → Call \`resolveManualReview(code, choice, ...)\` directly. The option may be referenced by:
     - The key name (the canonical identifier, e.g. "release", "keep_tag", "track_tag", "use_prior_tag",
       "use_different_tag", "assign_new", "no_tag", "retry_patch", "release_and_redo", "accept_unsynced",
       "escalate_chris")
     - A letter (a/b/c) — map to the position in the options list FROM lookupManualReview. If you
       don't yet know the list, call \`lookupManualReview\` first to map letter→key.
3. **Choice needs a tag** — some options have \`needs_tag_input: true\` (e.g., "track_tag" on ARN,
   "use_different_tag" on DRF). The advisor's intent will include the tag — "code ARN-X3K9P2 option
   track_tag red 5". Pass \`color="red"\` and \`tag_number=5\` along with \`choice\`. If the advisor
   picks a needs-tag-input option but doesn't name a tag, ASK: "Which tag is on the keys? (Red or Yellow,
   1-90)."

Authority: the 6-character code IS the pre-approval. The advisor receiving the email is presumed
authorized; once they enter the code + choice, the resolve tool applies the action immediately. Do
NOT additionally trigger the UUID confirmation-token flow (that's for in-chat sensitive actions like
"release Red 5 from RO 152442" with no prior code).

After resolving a code, relay the tool's \`message\` field verbatim to the advisor. It tells them
exactly what changed. If the resolution fails (\`failure_reason\`: code_not_found, already_resolved,
lockout_active, choice_requires_tag_input, etc.), surface that plainly so they know what to do next.

TWO-STEP CONFIRMATION FOR SENSITIVE OPERATIONS — CRITICAL:
The following tools may return \`{ok:false, needs_confirmation:true, confirmation:{token_id, scope_summary, expires_at, action_kind}}\`
on their FIRST call. This is the system's A/R-lockdown + force-assign gate. When you see this response:

  1. DO NOT immediately re-call the tool in the same run with the token. The confirmation MUST come from
     the human user in a separate turn. Return the confirmation request as your answer.
  2. Your answer should include:
     - The scope_summary VERBATIM (this is what the system will execute on confirmation)
     - The token_id (so the user / Claude Desktop can reference it on the next turn)
     - A clear yes/no question: "Reply 'yes, confirm <token_id>' (or simply 'yes') to proceed."
     - The expiry time: "This token expires in 5 minutes."
  3. Example response when releaseKeytagFromRo returns needs_confirmation:
     "⚠️ Confirmation required: Release A/R key tag from RO #152407 (currently in posted_ar status).
      Red 4 will return to the available pool.
      Reply 'yes, confirm a1b2c3d4-…' (or just 'yes') to proceed. Expires at 2026-05-11T19:30:00Z."

When the user's NEXT message confirms (e.g. "yes", "yes confirm", "do it"), the run_orchestrator call's
intent string SHOULD include enough context (Claude Desktop carries prior-turn context) so you can:
  - Identify the same operation (same ro_number + same tag + same action)
  - Find the confirmation token (from Claude Desktop's relay, or from the user's reply)
  - Re-call the SAME tool with confirmation_token=<token_id>
If the user simply says "yes" with no token visible in the intent, the orchestrator-mcp tool wrapping
should be passing the prior turn's context — but if you cannot find the token, ASK: "I need the
confirmation token from the previous step. Can you re-state the request with the token included?"

If the consume returns "confirmation_failed" with reason "token_expired", tell the user the token
expired and ask them to re-state the original request to get a new token. If the reason is
"scope_hash_mismatch", that means the user's confirmed scope doesn't match what they originally
requested — this is a security boundary; REFUSE and ask the user to re-state from scratch.

WHICH OPERATIONS REQUIRE CONFIRMATION:
- releaseKeytagFromRo on a tag in posted_ar status (A/R lockdown)
- assignKeytagToRo with specific color+tag_number (force-assign override)
- revertKeytagToAssigned when the tag is in posted_ar status
- markKeytagPosted whenever the tag is not already posted_ar
- All "bulk" operations (see below)

BULK-ACTION CONFIRMATION FLOW — CRITICAL SAFETY RULE:
A "bulk" operation is when the user asks to mutate MULTIPLE ROs in a single intent. Examples:
  * "Release Red 4 from 152407, 152223, 152340 and 152369"
  * "Free up RO 152407 and 152223"
  * "Mark RO 150873 and 151222 as A/R"
  * "Release all the A/R tags from RO 152407, 152223, 152340"

When you detect 2+ ROs in a destructive intent (release / revert / mark_posted / force-assign):
  1. DO NOT silently call the tool 2+ times.
  2. List the planned actions back to the user in a numbered list:
     "About to: 1) Release Red 4 from RO 152407, 2) Release Yellow 5 from RO 152223, …
      Reply 'yes' to confirm and I will process them one at a time. Each A/R-status release will
      individually ask for a confirmation token."
  3. On the user's "yes", proceed serially: call the tool once per RO, and if any returns
     needs_confirmation, surface that confirmation to the user before continuing with the rest.
  4. NEVER assume "yes" means "skip confirmation tokens for the entire batch" — each sensitive op
     gets its own token + user-driven confirmation.

When the user uses "all", "every", "each", "the entire", "everything", "any of them" without
naming SPECIFIC ROs, ask first:
  "I won't do an untargeted bulk action. Want me to list the candidates first so you can pick?"
Then call listWipKeyTags or getKeytagAuditHistory as a read-only step to show options.

Single-item WIP operations are always fine: "Release Red 5 from RO 152222" (WIP) → proceed directly,
no confirmation. Only A/R / force-assign / bulk operations require the confirmation flow.

Listing tools (listWipKeyTags, getKeytagAuditHistory) are NOT destructive — call them freely.
runBulkReconcile is NOT a destructive bulk action — it's a reconcile that only writes when DB and
Tekmetric are out of sync. Calling it is fine.

General rules:
- Never invent data. If a tool returns found:false, say so plainly.
- When a tool returns an ro_url, include it in your answer as a markdown link so the user can click through.
- Never disclose internal IDs (ro_id, customer_id, vehicle_id) in the user-facing answer unless the user asks.
  The RO NUMBER (ro_number) is what the user identifies repair orders by.
- Multi-tenant: the shop scope is server-side. Never trust shop_id values from the user; never ask for them.

Date/time rules — CRITICAL:
- Do NOT paraphrase or guess dates. You do not have reliable knowledge of "today's date" — your training
  data is months old and any date you mention from memory is likely wrong.
- When a tool returns a structured \`filters\` object with \`since\` / \`until\` ISO datetimes (e.g.
  getKeytagAuditHistory), QUOTE those values directly. Render them as plain ISO strings or convert with
  the SAME values (e.g. "since 2026-05-04T15:00:00Z"). Never invent a calendar date.
- For empty-result responses, say "no entries in the requested window" — do NOT speculate about specific
  calendar dates in that window.
- For relative phrasings ("last 24 hours", "last 7 days") — REPEAT the user's phrasing in your reply
  instead of converting it to a specific date. "No assigns logged in the last 24 hours." is right.
  "No assigns since May 16, 2025" is wrong (made-up date).

Output: a short, factual answer. Markdown is fine (links, lists). Do NOT wrap your answer in code fences.`;

export async function runOrchestrator(
  sb: SupabaseClient,
  shopId: number,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const startedAt = new Date();
  const model = Deno.env.get("ORCHESTRATOR_MODEL") || DEFAULT_MODEL;

  // ── 1. Find or create the chat session for this user_label (last 30 min counts as same session) ──
  const sessionId = await getOrCreateSession(sb, input.user_label);

  // ── 2. Open the orchestrator_run row ──
  const { data: runRow, error: runErr } = await sb
    .from("orchestrator_runs")
    .insert({
      session_id: sessionId,
      user_intent: input.intent,
      user_params: input.params ?? null,
      model,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return {
      ok: false,
      run_id: "",
      answer: "",
      data: [],
      meta: emptyMeta(model),
      error: `failed to open orchestrator_runs row: ${runErr?.message ?? "unknown"}`,
    };
  }
  const runId = runRow.id as string;

  // ── 3. Run the agent ──
  const recorder = makeToolCallRecorder(sb, runId);
  const tools = getOrchestratorTools({
    sb,
    shopId,
    recorder,
    userLabel: input.user_label,
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceRoleKey:
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SECRET_KEY") ??
      "",
  });

  const agentStartedAt = new Date();
  let result;
  try {
    result = await generateText({
      model: anthropic(model),
      system: buildSystemPrompt(),
      prompt: input.intent,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      // Hard caps — protect token spend and prevent runaway agents.
      maxOutputTokens: MAX_TOKENS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from("orchestrator_runs")
      .update({
        status: "error",
        error_message: msg,
        ended_at: new Date().toISOString(),
        latency_ms: Date.now() - startedAt.getTime(),
      })
      .eq("id", runId);
    return {
      ok: false,
      run_id: runId,
      answer: "",
      data: [],
      meta: { ...emptyMeta(model), latency_ms: Date.now() - startedAt.getTime() },
      error: msg,
    };
  }
  const agentEndedAt = new Date();

  // ── 4. Aggregate tool results + token usage ──
  const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
  const tokensIn = Number(usage.inputTokens ?? 0);
  const tokensOut = Number(usage.outputTokens ?? 0);

  const toolsCalled: string[] = [];
  const toolData: unknown[] = [];
  for (const step of result.steps ?? []) {
    for (const tc of step.toolCalls ?? []) {
      if (!toolsCalled.includes(tc.toolName)) toolsCalled.push(tc.toolName);
    }
    for (const tr of step.toolResults ?? []) {
      toolData.push({ tool: tr.toolName, output: tr.output });
    }
  }

  // ── 5. Log the agent_call row ──
  await sb.from("agent_calls").insert({
    run_id: runId,
    agent_name: "orchestrator",
    model,
    step_number: 1,
    input: { system_prompt_first_120: SYSTEM_PROMPT_TEMPLATE.slice(0, 120), user_intent: input.intent },
    output: { text: result.text, tools_called: toolsCalled, steps: result.steps?.length ?? 0 },
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_cents: null,                 // pricing math left for follow-up; AI SDK doesn't surface cost
    started_at: agentStartedAt.toISOString(),
    ended_at: agentEndedAt.toISOString(),
    latency_ms: agentEndedAt.getTime() - agentStartedAt.getTime(),
  });

  // ── 6. Close the run row ──
  const finalResponse = {
    answer: result.text,
    data: toolData,
    tools_called: toolsCalled,
  };

  const endedAt = new Date();
  await sb
    .from("orchestrator_runs")
    .update({
      status: "complete",
      final_response: finalResponse,
      total_tokens_in: tokensIn,
      total_tokens_out: tokensOut,
      ended_at: endedAt.toISOString(),
      latency_ms: endedAt.getTime() - startedAt.getTime(),
    })
    .eq("id", runId);

  // ── 7. Return ──
  return {
    ok: true,
    run_id: runId,
    answer: result.text,
    data: toolData,
    meta: {
      model,
      tools_called: toolsCalled,
      total_tokens_in: tokensIn,
      total_tokens_out: tokensOut,
      latency_ms: endedAt.getTime() - startedAt.getTime(),
      steps: result.steps?.length ?? 0,
    },
  };
}

// ─── Session helper ──────────────────────────────────────────────────────────
const SESSION_WINDOW_MIN = 30;

async function getOrCreateSession(
  sb: SupabaseClient,
  userLabel: string,
): Promise<string> {
  const cutoff = new Date(Date.now() - SESSION_WINDOW_MIN * 60 * 1000).toISOString();
  const { data: existing } = await sb
    .from("chat_sessions")
    .select("id")
    .eq("user_label", userLabel)
    .gte("last_active_at", cutoff)
    .order("last_active_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await sb
      .from("chat_sessions")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created, error } = await sb
    .from("chat_sessions")
    .insert({ user_label: userLabel })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Failed to create chat_session: ${error?.message ?? "unknown"}`);
  }
  return created.id as string;
}

function emptyMeta(model: string) {
  return {
    model,
    tools_called: [] as string[],
    total_tokens_in: 0,
    total_tokens_out: 0,
    latency_ms: 0,
    steps: 0,
  };
}

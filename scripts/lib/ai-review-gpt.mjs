/**
 * OpenAI REST caller for ai-review.mjs.
 *
 * Mirrors the pattern in `scripts/gpt-audit-scheduler-app.mjs` but
 * generic. Uses the Responses API with reasoning.effort (default: max —
 * Chris 2026-07-12; step down via AI_REVIEW_GPT_EFFORT).
 *
 * Model pinned to `gpt-5.6-terra` (verified current 2026-07-12 via
 * developers.openai.com/api/docs/models/gpt-5.6-terra — GA 2026-07-09,
 * mid tier of the GPT-5.6 family, $2.50/$15 per MTok = half of GPT-5.5,
 * ≥ GPT-5.5 on all published coding benchmarks; Chris's decision
 * 2026-07-12, replaces `gpt-5.5-2026-04-23`).
 */

const MODEL = "gpt-5.6-terra";
// Responses API (not Chat Completions) — required for the reasoning.effort param.
// Migrated 2026-07-12 per Chris: run terra at its highest effort. Terra's effort
// set is none|low|medium|high|xhigh|max; AI_REVIEW_GPT_EFFORT steps it down if a
// max-effort review ever overthinks/over-flags.
const API_URL = "https://api.openai.com/v1/responses";
const REASONING_EFFORT = process.env.AI_REVIEW_GPT_EFFORT || "max";

export async function resolveOpenAIApiKey() {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  const { readFile } = await import("node:fs/promises");
  const candidates = [
    "C:/Users/ChristopherGoodson/Apps/jeffs-app-v2/.env.local",
    "C:/Users/ChristopherGoodson/Apps/jeffs-app-v2/.env",
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf-8");
      const m = raw.match(/^OPENAI_API_KEY=(.+)$/m);
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, "");
        if (v) return v;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Single call to the OpenAI model. Returns:
 *   { ok: true, markdown: string, usage: {prompt_tokens, completion_tokens} }
 *   { ok: false, error: string }
 */
// timeoutMs raised from 180s → 600s (2026-05-26). On 30k+ input token plan
// reviews with the full-audit prompt, GPT-5.5 timed out at 180s
// (verified twice during scheduler-edge-parity v0.4 cross-verify rounds).
// 600s gives headroom for deep audits on large plan docs without burning
// cache on retries.
export async function callGpt({ systemInstruction, userMessage, apiKey, timeoutMs = 600_000 }) {
  if (!apiKey) {
    return { ok: false, error: "Missing OPENAI_API_KEY" };
  }
  // HISTORY: 2026-05-25 we removed `reasoning: { effort }` because the old
  // caller used /v1/chat/completions, which 400s on that param (it is a
  // /v1/responses parameter). 2026-07-12: migrated to /v1/responses exactly
  // so effort CAN be set — Chris wants terra at max.
  const body = {
    model: MODEL,
    instructions: systemInstruction,
    input: userMessage,
    reasoning: { effort: REASONING_EFFORT },
    stream: false,
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, error: `GPT network: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    return { ok: false, error: `GPT HTTP ${res.status}: ${text.slice(0, 500)}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, error: `GPT non-JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Responses API shape: data.output[] holds typed items ("reasoning",
  // "message", ...); the assistant text lives in the "message" item's
  // content[] as "output_text" parts. (data.output_text is an SDK-only
  // convenience — check it first anyway in case the raw API adds it.)
  let text = typeof data?.output_text === "string" ? data.output_text : "";
  if (!text) {
    const parts = [];
    for (const item of data?.output ?? []) {
      if (item?.type !== "message") continue;
      for (const c of item?.content ?? []) {
        if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      }
    }
    text = parts.join("\n");
  }
  if (typeof text !== "string" || text.length === 0) {
    return {
      ok: false,
      error: `GPT empty response. status=${data?.status ?? "?"} incomplete=${data?.incomplete_details?.reason ?? "-"}`,
    };
  }

  // Keep the legacy usage field names — ai-review.mjs consumes these.
  const usage = {
    prompt_tokens: data?.usage?.input_tokens ?? null,
    completion_tokens: data?.usage?.output_tokens ?? null,
  };

  return { ok: true, markdown: text, usage, model: MODEL };
}

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
export async function callGpt({ systemInstruction, userMessage, apiKey, timeoutMs = 1_800_000 }) {
  // timeoutMs default 30min (2026-07-19): background+poll holds NO connection,
  // so a long deadline is free — and MAX effort on a large (30k+ char) plan
  // doc genuinely reasons >10min. The old 600s poll deadline aborted a
  // still-"in_progress" response. Chris: terra runs at max, always → give it
  // room. (Gemini stays fast; only the terra poll needs the headroom.)
  if (!apiKey) {
    return { ok: false, error: "Missing OPENAI_API_KEY" };
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // fetch with a few retries on transient network errors (ECONNRESET etc.).
  async function fetchRetry(url, init, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        return await fetch(url, init);
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await sleep(1000 * (i + 1));
      }
    }
    throw lastErr;
  }

  // ── Create the response in BACKGROUND mode ─────────────────────────────
  // HISTORY: 2026-07-12 migrated to /v1/responses so `reasoning.effort` works
  // (a /v1/responses-only param; /v1/chat/completions 400s on it). 2026-07-19
  // (Chris: terra runs at MAX, always): a max-effort review reasons for
  // minutes; a *synchronous* request holds an idle connection that an
  // intermediary resets mid-flight (surfaces as "fetch failed", NOT a clean
  // timeout — a retry just restarts the same long request → same reset). So
  // we use `background: true`: the POST returns an id immediately and we poll
  // GET /v1/responses/{id} until terminal. No long-held connection to reset;
  // the work continues server-side even across a dropped poll. `stream:false`
  // stays (we read the final object, not deltas).
  const body = {
    model: MODEL,
    instructions: systemInstruction,
    input: userMessage,
    reasoning: { effort: REASONING_EFFORT },
    background: true,
    stream: false,
  };

  let createRes;
  try {
    createRes = await fetchRetry(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const cause = e instanceof Error && e.cause && e.cause.message ? ` (${e.cause.message})` : "";
    return { ok: false, error: `GPT create network: ${e instanceof Error ? e.message : String(e)}${cause}` };
  }
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "<unreadable>");
    return { ok: false, error: `GPT create HTTP ${createRes.status}: ${text.slice(0, 500)}` };
  }
  let data;
  try {
    data = await createRes.json();
  } catch (e) {
    return { ok: false, error: `GPT create non-JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const id = data?.id;
  if (!id) {
    return { ok: false, error: `GPT create returned no id (status=${data?.status ?? "?"})` };
  }

  // ── Poll until terminal or deadline ────────────────────────────────────
  const TERMINAL = new Set(["completed", "failed", "cancelled", "incomplete"]);
  const pollUrl = `${API_URL}/${id}`;
  let status = data?.status ?? "queued";
  while (!TERMINAL.has(status)) {
    if (Date.now() > deadline) {
      // Best-effort cancel so it doesn't keep running/billing after we bail.
      try {
        await fetch(`${pollUrl}/cancel`, { method: "POST", headers, signal: AbortSignal.timeout(15_000) });
      } catch { /* ignore */ }
      return { ok: false, error: `GPT background timed out after ${Math.round(timeoutMs / 1000)}s (last status=${status})` };
    }
    await sleep(4000);
    let pollRes;
    try {
      pollRes = await fetchRetry(pollUrl, { method: "GET", headers, signal: AbortSignal.timeout(60_000) });
    } catch {
      continue; // transient poll failure — work continues server-side; keep polling
    }
    if (!pollRes.ok) continue; // 5xx/429 on a poll — transient; keep polling
    try {
      data = await pollRes.json();
    } catch {
      continue;
    }
    status = data?.status ?? status;
  }

  if (status !== "completed") {
    const reason = data?.incomplete_details?.reason || data?.error?.message || status;
    return { ok: false, error: `GPT background ${status}: ${reason}` };
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
      error: `GPT empty response. status=${status} incomplete=${data?.incomplete_details?.reason ?? "-"}`,
    };
  }

  // Keep the legacy usage field names — ai-review.mjs consumes these.
  const usage = {
    prompt_tokens: data?.usage?.input_tokens ?? null,
    completion_tokens: data?.usage?.output_tokens ?? null,
  };

  return { ok: true, markdown: text, usage, model: MODEL };
}

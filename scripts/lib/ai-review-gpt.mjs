/**
 * GPT-5.5 REST caller for ai-review.mjs.
 *
 * Mirrors the pattern in `scripts/gpt-audit-scheduler-app.mjs` but
 * generic. Uses Chat Completions API with reasoning.effort = "high"
 * (the strongest setting per GPT-5.5 docs — appropriate for code review).
 *
 * Model pinned to `gpt-5.5-2026-04-23` (verified current 2026-05-25 via
 * search of openai.com). GPT-5.6 reportedly in development per leaks
 * but not yet released; update this constant when it ships.
 */

const MODEL = "gpt-5.5-2026-04-23";
const API_URL = "https://api.openai.com/v1/chat/completions";

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
 * Single call to GPT-5.5. Returns:
 *   { ok: true, markdown: string, usage: {prompt_tokens, completion_tokens} }
 *   { ok: false, error: string }
 */
export async function callGpt({ systemInstruction, userMessage, apiKey, timeoutMs = 180_000 }) {
  if (!apiKey) {
    return { ok: false, error: "Missing OPENAI_API_KEY" };
  }
  // NOTE 2026-05-25: removed `reasoning: { effort: "high" }` after the
  // dogfood test surfaced GPT 400 "Unknown parameter: 'reasoning'".
  // The reasoning.effort flag is a /v1/responses endpoint parameter,
  // NOT a /v1/chat/completions one. Caught by Gemini in the first run
  // of this tool against itself — proof the cross-verify pattern works.
  //
  // GPT-5.5 on Chat Completions still does reasoning internally at the
  // medium default per the model docs. Strong enough for code review.
  // If we ever need explicit high-effort reasoning, switch to the
  // Responses API endpoint — different body shape.
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: userMessage },
    ],
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

  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    return {
      ok: false,
      error: `GPT empty response. finish_reason=${data?.choices?.[0]?.finish_reason ?? "?"}`,
    };
  }

  const usage = {
    prompt_tokens: data?.usage?.prompt_tokens ?? null,
    completion_tokens: data?.usage?.completion_tokens ?? null,
  };

  return { ok: true, markdown: text, usage, model: MODEL };
}

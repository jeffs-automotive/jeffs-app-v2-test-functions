/**
 * Gemini 2.5 Pro REST caller for ai-review.mjs.
 *
 * Mirrors the pattern in `scripts/gemini-audit-scheduler-app.mjs` but
 * generic: takes a system instruction + user message, returns the
 * model's markdown response. No file-walking, no hardcoded prompts.
 *
 * Model pinned to `gemini-2.5-pro` (verified current 2026-05-25 via
 * ai.google.dev/gemini-api/docs/models). Gemini 3 series exists in
 * preview but 2.5 Pro is the recommended stable for code review.
 */

const MODEL = "gemini-2.5-pro";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Pull GOOGLE_GENERATIVE_AI_API_KEY from env, falling back to the
 * sibling prod project's .env.local (matches the existing audit
 * scripts' fallback). Returns null if not found anywhere.
 */
export async function resolveGeminiApiKey() {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
  const { readFile } = await import("node:fs/promises");
  const candidates = [
    "C:/Users/ChristopherGoodson/Apps/jeffs-app-v2/.env.local",
    "C:/Users/ChristopherGoodson/Apps/jeffs-app-v2/.env",
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf-8");
      const m = raw.match(/^GOOGLE_GENERATIVE_AI_API_KEY=(.+)$/m);
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
 * Single call to Gemini. Returns:
 *   { ok: true, markdown: string, usage: {prompt_tokens, completion_tokens} }
 *   { ok: false, error: string }
 *
 * Caller is responsible for fail/retry decisions.
 */
export async function callGemini({ systemInstruction, userMessage, apiKey, timeoutMs = 180_000 }) {
  if (!apiKey) {
    return { ok: false, error: "Missing GOOGLE_GENERATIVE_AI_API_KEY" };
  }
  const url = `${API_BASE}/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, error: `Gemini network: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    return { ok: false, error: `Gemini HTTP ${res.status}: ${text.slice(0, 500)}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, error: `Gemini non-JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) {
    return {
      ok: false,
      error: `Gemini empty response. finishReason=${data?.candidates?.[0]?.finishReason ?? "?"}`,
    };
  }

  const usage = {
    prompt_tokens: data?.usageMetadata?.promptTokenCount ?? null,
    completion_tokens: data?.usageMetadata?.candidatesTokenCount ?? null,
  };

  return { ok: true, markdown: text, usage, model: MODEL };
}

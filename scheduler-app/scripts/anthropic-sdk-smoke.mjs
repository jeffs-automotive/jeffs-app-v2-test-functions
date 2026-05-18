// SDK-level smoke test — calls @ai-sdk/anthropic + generateObject the same
// way diagnose-concern does, to see if the SDK adds an env var or rewrites
// the model ID into something that 404s.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local with the same lenient parser as the main eval, minus
// the Vercel/AI-gateway runtime vars.
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const skipPrefixes = ["VERCEL_", "AI_GATEWAY_", "TURBO_", "NX_"];
  const skipExact = new Set(["VERCEL"]);
  const raw = readFileSync(envPath, "utf8");
  const lineRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(.*?))\s*$/;
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = line.match(lineRe);
    if (!m) continue;
    const [, key, dq, sq, plain] = m;
    if (skipExact.has(key) || skipPrefixes.some((p) => key.startsWith(p))) continue;
    if (process.env[key]) continue;
    process.env[key] = dq !== undefined ? dq.replace(/\\(.)/g, "$1") : (sq !== undefined ? sq : (plain ?? ""));
  }
}

// Force-delete the offending overrides BEFORE importing the SDK.
for (const k of ["ANTHROPIC_BASE_URL", "AI_GATEWAY_API_KEY", "VERCEL", "VERCEL_ENV", "VERCEL_URL"]) {
  delete process.env[k];
}

console.log("ANTHROPIC_API_KEY length:", (process.env.ANTHROPIC_API_KEY ?? "").length);
console.log("ANTHROPIC_API_KEY prefix:", (process.env.ANTHROPIC_API_KEY ?? "").slice(0, 12));
console.log("ANTHROPIC_BASE_URL:", process.env.ANTHROPIC_BASE_URL ?? "(unset ✓)");
console.log("AI_GATEWAY_API_KEY:", process.env.AI_GATEWAY_API_KEY ? "set" : "(unset ✓)");

// Lazy-import after env is loaded
const { anthropic } = await import("@ai-sdk/anthropic");
const { generateText, generateObject } = await import("ai");
const { z } = await import("zod");

console.log("\n--- Test 1: generateText with claude-haiku-4-5 ---");
try {
  const r = await generateText({
    model: anthropic("claude-haiku-4-5"),
    prompt: "Say OK",
    maxOutputTokens: 16,
  });
  console.log("OK:", r.text.slice(0, 40));
} catch (e) {
  console.log("FAIL:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  if (e instanceof Error && "cause" in e && e.cause) console.log("Cause:", e.cause);
  if (e instanceof Error && "url" in e) console.log("URL:", e.url);
}

console.log("\n--- Test 2: generateObject with claude-haiku-4-5 ---");
try {
  const r = await generateObject({
    model: anthropic("claude-haiku-4-5"),
    prompt: "Return any short object",
    schema: z.object({ ok: z.boolean() }),
    maxOutputTokens: 64,
  });
  console.log("OK:", JSON.stringify(r.object));
} catch (e) {
  console.log("FAIL:", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  if (e instanceof Error && "cause" in e && e.cause) console.log("Cause:", e.cause);
  if (e instanceof Error && "url" in e) console.log("URL:", e.url);
}

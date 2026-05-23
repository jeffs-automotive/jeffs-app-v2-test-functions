// Minimal smoke test: prove the key + a known model work end-to-end.
// Uses the same lenient env loader as eval-diagnose-concern.ts. Prints
// only the status (works/fails) — no secret values.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, "utf8");
  const lineRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(.*?))\s*$/;
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = line.match(lineRe);
    if (!m) continue;
    const [, key, dq, sq, plain] = m;
    if (process.env[key]) continue;
    process.env[key] = dq !== undefined ? dq.replace(/\\(.)/g, "$1") : (sq !== undefined ? sq : (plain ?? ""));
  }
}

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("ANTHROPIC_API_KEY not set");
  process.exit(1);
}
console.log(`Key present — length=${key.length}, prefix="${key.slice(0, 12)}…"`);

const models = [
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-3-5-haiku-latest", // sanity check — older alias
];

for (const model of models) {
  process.stdout.write(`Testing model "${model}" → `);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with just the word OK." }],
      }),
    });
    const body = await res.text();
    if (res.ok) {
      console.log(`HTTP ${res.status} ✓`);
    } else {
      let parsed = body;
      try {
        parsed = JSON.stringify(JSON.parse(body));
      } catch {
        // body was not valid JSON — fall back to raw text already in `parsed`
      }
      console.log(`HTTP ${res.status} ✗  ${parsed.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`FETCH-ERR ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Gemini 2.5 Pro audit of scheduler-app/ + chat-design.md.
 *
 * Reads:
 *   - C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/
 *     (recursive; .ts, .tsx, .css, .json, .md files only)
 *   - chat-design.md (canonical spec)
 *
 * Sends to gemini-2.5-pro via REST. API key resolved from:
 *   1. process.env.GOOGLE_GENERATIVE_AI_API_KEY
 *   2. fallback: ~/Apps/jeffs-app-v2/.env.local (prod project's key)
 *
 * Writes findings to .claude/memory/audit_gemini_2026-05-13.md
 *
 * Invocation:
 *   node scripts/gemini-audit-scheduler-app.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SCHEDULER_APP_DIR = path.join(REPO_ROOT, "scheduler-app");
const SUPABASE_FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase", "functions");
const DESIGN_DOC = "C:/Users/ChristopherGoodson/dotfiles-v2-test-data/jeffs-app-v2-test-data/.claude/work/planning/references/chat-design.md";
const OUTPUT = "C:/Users/ChristopherGoodson/dotfiles-v2-test-data/jeffs-app-v2-test-data/.claude/memory/audit_gemini_2026-05-13.md";

const MODEL = "gemini-2.5-pro";

const INCLUDE_EXT = new Set([".ts", ".tsx", ".css", ".md", ".sql"]);
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".vercel",
  "playwright-report",
  "test-results",
  "_archive",
]);

async function resolveApiKey() {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
  const candidates = [
    "C:/Users/ChristopherGoodson/Apps/jeffs-app-v2/.env.local",
    "C:/Users/ChristopherGoodson/Apps/jeffs-app-v2/.env",
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const m = raw.match(/^GOOGLE_GENERATIVE_AI_API_KEY=(.+)$/m);
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, "");
        if (v) return v;
      }
    } catch {
      // try next
    }
  }
  throw new Error(
    "No GOOGLE_GENERATIVE_AI_API_KEY found in env or prod .env.local",
  );
}

async function walk(root, acc = []) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      await walk(full, acc);
    } else {
      const ext = path.extname(e.name);
      if (INCLUDE_EXT.has(ext)) acc.push(full);
    }
  }
  return acc;
}

function readFileSafe(p) {
  return fs.readFile(p, "utf-8").catch(() => "");
}

function relPath(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, "/");
}

async function buildContext() {
  const schedulerFiles = await walk(SCHEDULER_APP_DIR);
  const edgeFiles = await walk(SUPABASE_FUNCTIONS_DIR);

  const parts = [];
  let totalBytes = 0;
  const LIMIT_BYTES = 1_400_000; // ~1.4 MB raw; gemini-2.5-pro has plenty of room but keep prompt reasonable

  for (const p of [...schedulerFiles, ...edgeFiles]) {
    const content = await readFileSafe(p);
    if (!content) continue;
    const rel = relPath(p);
    const block = `\n\n=== ${rel} ===\n${content}`;
    if (totalBytes + block.length > LIMIT_BYTES) {
      parts.push(`\n\n=== ${rel} ===\n[truncated — context budget exhausted]`);
      continue;
    }
    parts.push(block);
    totalBytes += block.length;
  }

  const designDoc = await readFileSafe(DESIGN_DOC);

  return {
    code: parts.join(""),
    design: designDoc,
    fileCount: schedulerFiles.length + edgeFiles.length,
    totalBytes,
  };
}

const SYSTEM_INSTRUCTION = `You are auditing a customer-facing appointment scheduler. Compare the code against the design doc. Be candid, terse, and specific. File paths + line ranges. Group by severity: 🔴 BLOCKER (broken now), 🟡 GAP (missing/incomplete), 🟢 OK (matches), 🔵 DEFERRED (intentional Phase 2).

Active bug: PhoneNameCard submit doesn't propagate — assistant message stays in tool 'input-available' state in DB, addToolResult never fires (or does but the agent loops). Customer can't get past Step 2.

Look at:
- Server Action wiring (Next.js 15 "use server" patterns)
- AI SDK v5 useChat + addToolResult + sendAutomaticallyWhen + prepareSendMessagesRequest
- Tool registry vs system prompt cohesion
- Orchestrator entrypoint (supabase functions / orchestrator-direct)
- Telnyx OTP send
- DB column naming consistency between Server Actions and migrations

Output: markdown. No preamble.`;

async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 32768,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) {
    throw new Error(
      `Gemini returned no text. Raw: ${JSON.stringify(json).slice(0, 800)}`,
    );
  }
  return { text, usage: json.usageMetadata };
}

async function main() {
  const startedAt = Date.now();
  console.log("→ Resolving API key…");
  const apiKey = await resolveApiKey();
  console.log(`  key prefix: ${apiKey.slice(0, 10)}…`);

  console.log("→ Walking files + building context…");
  const ctx = await buildContext();
  console.log(`  files: ${ctx.fileCount} · code bytes: ${ctx.totalBytes} · design bytes: ${ctx.design.length}`);

  const prompt = `# Canonical design spec (read this first)\n\n${ctx.design}\n\n---\n\n# Implementation (scheduler-app/ + supabase/functions/)\n${ctx.code}`;

  console.log(`→ Calling ${MODEL}…`);
  const { text, usage } = await callGemini(apiKey, prompt);

  console.log(`  tokens in: ${usage?.promptTokenCount ?? "?"} · out: ${usage?.candidatesTokenCount ?? "?"}`);

  const header =
    `# Gemini 2.5 Pro audit — scheduler-app vs chat-design.md\n\n` +
    `> Generated ${new Date().toISOString()}\n` +
    `> Files audited: ${ctx.fileCount} · Code bytes: ${ctx.totalBytes} · ` +
    `Design doc bytes: ${ctx.design.length}\n` +
    `> Model: ${MODEL} · ` +
    `Tokens: ${usage?.promptTokenCount ?? "?"} in / ${usage?.candidatesTokenCount ?? "?"} out\n` +
    `> Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n\n---\n\n`;

  await fs.writeFile(OUTPUT, header + text + "\n", "utf-8");
  console.log(`✓ Wrote audit to ${OUTPUT}`);
  console.log(`  ${((Date.now() - startedAt) / 1000).toFixed(1)}s elapsed`);
}

main().catch((e) => {
  console.error("✗ Gemini audit failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

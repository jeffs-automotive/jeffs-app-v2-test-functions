/**
 * GPT-5.5 audit of scheduler-app/ + chat-design.md (sibling of
 * gemini-audit-scheduler-app.mjs — same bundle, different model).
 *
 * Reads:
 *   - C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/
 *     (recursive; .ts, .tsx, .css, .json, .md files only)
 *   - supabase/functions/ (edge functions)
 *   - chat-design.md (canonical spec)
 *
 * Sends to gpt-5.5-2026-04-23 via OpenAI Chat Completions REST API.
 * API key resolved from:
 *   1. process.env.OPENAI_API_KEY
 *   2. fallback: ~/Apps/jeffs-app-v2/.env.local (prod project's key)
 *   3. fallback: ~/Apps/jeffs-app-v2/.env
 *
 * Writes findings to .claude/memory/audit_gpt_2026-05-13.md
 *
 * Invocation:
 *   node scripts/gpt-audit-scheduler-app.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const SCHEDULER_APP_DIR = path.join(REPO_ROOT, "scheduler-app");
const SUPABASE_FUNCTIONS_DIR = path.join(REPO_ROOT, "supabase", "functions");
const DESIGN_DOC =
  "C:/Users/ChristopherGoodson/dotfiles-v2-test-data/jeffs-app-v2-test-data/.claude/work/planning/references/chat-design.md";
const OUTPUT =
  "C:/Users/ChristopherGoodson/dotfiles-v2-test-data/jeffs-app-v2-test-data/.claude/memory/audit_gpt_2026-05-13.md";

// Pinned date-suffixed model name (per OpenAI Chat Completions docs query
// 2026-05-13). gpt-5.5 is the latest reasoning + code model in the gpt-5
// series; data-residency eligible per /v1/chat/completions docs.
const MODEL = "gpt-5.5-2026-04-23";

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
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  const candidates = [
    "C:/Users/ChristopherGoodson/Apps/jeffs-app-v2/.env.local",
    "C:/Users/ChristopherGoodson/Apps/jeffs-app-v2/.env",
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const m = raw.match(/^OPENAI_API_KEY=(.+)$/m);
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, "");
        if (v) return v;
      }
    } catch {
      // try next
    }
  }
  throw new Error("No OPENAI_API_KEY found in env or prod .env.local");
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
  const LIMIT_BYTES = 1_400_000; // ~1.4 MB raw

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

const SYSTEM_INSTRUCTION = `You are auditing a customer-facing appointment scheduler (Next.js 15 App Router on Vercel + Supabase Edge Functions on Deno). Compare the code against the design doc. Be candid, terse, and specific. File paths + line ranges. Group by severity: 🔴 BLOCKER (broken now), 🟡 GAP (missing/incomplete), 🟢 OK (matches), 🔵 DEFERRED (intentional Phase 2).

Recent context (2026-05-13):
The scheduler-app shipped ~15 commits today addressing prior audit findings — Sentry wiring, security migration, row-as-truth refactor, cookie resume, OTP Resend, escalation back-to-scheduling, keyword escalation scanner, NEW deterministic Step-2 edge function (scheduler-step2-direct) that bypasses the LLM specialist entirely for Tekmetric lookup + Telnyx OTP send, plus several missing cards (CompletedCard, CustomerInfoEditCard, NoMatchChoosePathCard, PartialVerificationGateCard, MultiAccountDisambiguationCard).

Focus your audit on:
- Server Action wiring (Next.js 15 "use server" patterns)
- AI SDK v5 useChat + addToolResult + sendAutomaticallyWhen + prepareSendMessagesRequest
- Tool registry vs system prompt cohesion (chat agent + scheduler specialist)
- Orchestrator entrypoint (supabase/functions/orchestrator-direct + scheduler-step2-direct)
- Telnyx OTP send (scheduler-otp.ts)
- DB column naming consistency between Server Actions and migrations
- Row-as-truth invariant: customer data lives in customer_chat_sessions, LLM reads structured snapshot not message text
- Cookie resume + Next.js middleware
- Sentry capture coverage + PII redaction
- Type safety across the LLM specialist's JSON contract (this just bit us — the specialist used generateText + manual JSON.parse instead of generateObject + Zod, causing OTP path failures)

Output: markdown. No preamble. Use the severity emojis. Cite file:line for every finding.`;

async function callOpenAI(apiKey, prompt) {
  const url = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: prompt },
    ],
    // gpt-5.5 supports a max output range up to 16k-32k for the larger
    // variants; 16k is sufficient for a comprehensive audit.
    max_completion_tokens: 16384,
    // gpt-5.5 reasoning models reject custom temperature — only the
    // default (1) is supported. Omit the field entirely rather than
    // sending the unsupported value.
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  if (!text) {
    throw new Error(
      `OpenAI returned no text. Raw: ${JSON.stringify(json).slice(0, 800)}`,
    );
  }
  return { text, usage: json.usage };
}

async function main() {
  const startedAt = Date.now();
  console.log("→ Resolving API key…");
  const apiKey = await resolveApiKey();
  console.log(`  key prefix: ${apiKey.slice(0, 10)}…`);

  console.log("→ Walking files + building context…");
  const ctx = await buildContext();
  console.log(
    `  files: ${ctx.fileCount} · code bytes: ${ctx.totalBytes} · design bytes: ${ctx.design.length}`,
  );

  const prompt = `# Canonical design spec (read this first)\n\n${ctx.design}\n\n---\n\n# Implementation (scheduler-app/ + supabase/functions/)\n${ctx.code}`;

  console.log(`→ Calling ${MODEL}…`);
  const { text, usage } = await callOpenAI(apiKey, prompt);

  console.log(
    `  tokens in: ${usage?.prompt_tokens ?? "?"} · out: ${usage?.completion_tokens ?? "?"}`,
  );

  const header =
    `# GPT-5.5 audit — scheduler-app vs chat-design.md\n\n` +
    `> Generated ${new Date().toISOString()}\n` +
    `> Files audited: ${ctx.fileCount} · Code bytes: ${ctx.totalBytes} · ` +
    `Design doc bytes: ${ctx.design.length}\n` +
    `> Model: ${MODEL} · ` +
    `Tokens: ${usage?.prompt_tokens ?? "?"} in / ${usage?.completion_tokens ?? "?"} out\n` +
    `> Elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n\n---\n\n`;

  await fs.writeFile(OUTPUT, header + text + "\n", "utf-8");
  console.log(`✓ Wrote audit to ${OUTPUT}`);
  console.log(`  ${((Date.now() - startedAt) / 1000).toFixed(1)}s elapsed`);
}

main().catch((e) => {
  console.error("✗ GPT audit failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

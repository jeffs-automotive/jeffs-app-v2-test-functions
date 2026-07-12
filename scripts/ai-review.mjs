#!/usr/bin/env node
/**
 * ai-review.mjs — non-prescriptive cross-verify a plan or build with
 * Gemini 3.5 Flash + GPT-5.6 Terra in parallel. Findings written to a markdown
 * artifact under .claude/work/.
 *
 * Usage:
 *   node scripts/ai-review.mjs \
 *     --what "<short description of what we're doing>" \
 *     [--output <path>] \
 *     [--model gemini|gpt|both] \
 *     [--max-tokens-per-file <N>] \
 *     <file1> <file2> ...
 *
 * Examples:
 *   node scripts/ai-review.mjs \
 *     --what "adding loading spinners to ReconcileTab + write forms" \
 *     admin-app/src/components/keytag/ReconcileTab.tsx \
 *     admin-app/src/components/keytag/AssignKeytagForm.tsx
 *
 *   node scripts/ai-review.mjs --model gemini \
 *     --what "auth refactor" supabase/functions/orchestrator-mcp/index.ts
 *
 * Exit codes:
 *   0 - both/the requested model(s) returned findings (findings themselves
 *       may include blockers, but the script succeeded)
 *   1 - one or both API calls failed (partial output written)
 *   2 - bad args (missing --what, no files, files don't exist)
 *
 * Design rationale: docs/feature-workflow-hook/ai-cross-verify-plan.md.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  callGemini,
  resolveGeminiApiKey,
} from "./lib/ai-review-gemini.mjs";
import { callGpt, resolveOpenAIApiKey } from "./lib/ai-review-gpt.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// ─── Non-prescriptive system instruction (same for both models) ────────────

const SYSTEM_INSTRUCTION = `You are a senior software reviewer brought in for a second opinion.
The user will describe what they are doing and supply the relevant files.
Read EVERYTHING front to back — do not stop at the first issue you find.

**This is a FULL AUDIT, not a triage.** List every finding that meets the
severity bar, even if you've already found 10. Plans and code typically have
multiple problems; truncating to "the most important one" misses the rest
and forces the user into a slow iterate-then-recheck loop. Better to surface
20 real findings in one pass than 2 per pass over 10 passes.

Don't repeat the user's intent back. Don't list what looks fine. Be precise:
each finding has a (a) what's wrong, (b) why it matters, (c) where to look
(file path / section / line if known).

Categories to audit:
  - Bugs (logic errors, missed edge cases, race conditions, off-by-one)
  - Internal contradictions (one section says X, another says Y)
  - Architectural smells (wrong layer, leaky abstractions, hidden coupling)
  - Security risks (PII leaks, auth gaps, injection, missing validation, RLS bypasses)
  - Multi-tenant safety (cross-shop pollution, scoping gaps)
  - Race conditions + staleness windows (TOCTOU, write skew, lost updates)
  - Migration safety (deploy ordering, NOT NULL transitions, backfill correctness)
  - Missing tests, missing observability, missing error handling
  - Stale text from prior revisions that contradicts current decisions
  - Schema vs implementation drift (type mismatches, missing fields, count-off lists)
  - Patterns the user may not know exist in their own codebase

Format your reply as markdown with severity buckets:
  ## BLOCKER     (would cause data loss, security gap, or shipping broken behavior)
  ## IMPORTANT   (should fix before ship; correctness/safety/correctness; not optional)
  ## NICE-TO-HAVE (style, docs cleanup, minor optimization)

Each finding gets its own bullet with a SHORT title in **bold** and the
detail underneath. Do not consolidate multiple issues into one bullet just
to look tidy — each gets its own slot.

If after careful reading you genuinely have nothing material to flag, say
so plainly with one sentence under "## No material findings" — but ONLY if
you have actually read everything and found nothing. Truncating to "no
findings" because you stopped reading early is the failure mode this prompt
is designed to prevent.

Don't ask follow-up questions; the user has shared everything they're
going to share. Make your best assessment from what's in front of you.`;

// ─── CLI arg parsing (no deps) ─────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    what: null,
    output: null,
    model: "both",
    maxTokensPerFile: 8000,
    files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--what") {
      args.what = argv[++i];
    } else if (a === "--output") {
      args.output = argv[++i];
    } else if (a === "--model") {
      args.model = argv[++i];
    } else if (a === "--max-tokens-per-file") {
      args.maxTokensPerFile = parseInt(argv[++i], 10);
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      args.files.push(a);
    }
  }
  return args;
}

function usage() {
  return `Usage:
  node scripts/ai-review.mjs --what "<description>" <file1> <file2> ...

Required:
  --what "<text>"             Brief description of what's being reviewed.

Optional:
  --output <path>             Output file path. Default:
                              .claude/work/ai-review-{ISO}.md
  --model gemini|gpt|both     Which model(s) to call. Default: both.
  --max-tokens-per-file <N>   Truncate files larger than this. Default: 8000.
                              (Approximate; uses char count as proxy for tokens.)

Positional:
  <file...>                   One or more file paths to include in the review.

Exit codes:
  0 - success (findings written, may include blockers)
  1 - API failure (partial output written)
  2 - bad args
`;
}

// ─── File reading with truncation ──────────────────────────────────────────

const EXT_TO_FENCE = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".sql": "sql",
  ".css": "css",
  ".html": "html",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "bash",
};

function fenceForExt(ext) {
  return EXT_TO_FENCE[ext.toLowerCase()] ?? "";
}

async function loadFiles(paths, maxCharsPerFile) {
  const out = [];
  for (const p of paths) {
    const abs = resolve(REPO_ROOT, p);
    let s;
    try {
      s = await stat(abs);
    } catch {
      throw new Error(`File not found: ${p} (resolved: ${abs})`);
    }
    if (!s.isFile()) {
      throw new Error(`Not a file: ${p}`);
    }
    let content;
    try {
      content = await readFile(abs, "utf-8");
    } catch (e) {
      throw new Error(
        `Failed to read ${p}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    let truncated = false;
    if (content.length > maxCharsPerFile) {
      content =
        content.slice(0, maxCharsPerFile) +
        `\n\n... [TRUNCATED — file was ${content.length} chars, kept first ${maxCharsPerFile}]`;
      truncated = true;
    }
    out.push({
      path: relative(REPO_ROOT, abs).replace(/\\/g, "/"),
      ext: extname(abs),
      content,
      truncated,
      bytes: s.size,
    });
  }
  return out;
}

function buildUserMessage(what, files) {
  const blocks = files
    .map((f) => {
      const fence = fenceForExt(f.ext);
      const trunc = f.truncated ? " (truncated)" : "";
      return `### ${f.path}${trunc}\n\`\`\`${fence}\n${f.content}\n\`\`\``;
    })
    .join("\n\n");
  return `What we're doing:\n${what}\n\nFiles for review:\n\n${blocks}`;
}

// ─── Disagreement detection ────────────────────────────────────────────────

function detectDisagreements(geminiMarkdown, gptMarkdown) {
  // Cheap heuristic: extract the "## BLOCKER" sections from each, flag
  // any non-trivial blocker that appears in only one. Not perfect — meant
  // to surface obvious mismatches, not be authoritative.
  const extract = (md) => {
    if (!md) return [];
    const m = md.match(/^##\s*BLOCKER\s*\n([\s\S]*?)(?=^##\s|\Z)/im);
    if (!m) return [];
    return m[1]
      .split(/\n[-*]\s+|^\d+\.\s+/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);
  };
  const g = extract(geminiMarkdown);
  const p = extract(gptMarkdown);

  if (g.length === 0 && p.length === 0) {
    return "Both models flagged zero blockers. Likely safe to proceed.";
  }
  if (g.length === 0) {
    return `GPT flagged ${p.length} blocker${p.length === 1 ? "" : "s"} that Gemini did not. Worth a second look at the GPT-only items.`;
  }
  if (p.length === 0) {
    return `Gemini flagged ${g.length} blocker${g.length === 1 ? "" : "s"} that GPT did not. Worth a second look at the Gemini-only items.`;
  }
  return `Both models flagged blockers (Gemini: ${g.length}, GPT: ${p.length}). Read both sections; agreement on the same issue raises confidence; disagreements suggest one model missed context.`;
}

// ─── Output writer ─────────────────────────────────────────────────────────

function defaultOutputPath() {
  const now = new Date();
  const iso = now
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d+Z$/, "Z");
  return resolve(REPO_ROOT, `.claude/work/ai-review-${iso}.md`);
}

function buildArtifact({ what, files, geminiResult, gptResult, totalCostNote }) {
  const now = new Date().toISOString();
  const fileList = files.map((f) => `- ${f.path} (${f.bytes} bytes${f.truncated ? ", truncated" : ""})`).join("\n");

  const geminiSection = geminiResult
    ? geminiResult.ok
      ? `## Gemini ${geminiResult.model}\n\n*usage: ${geminiResult.usage.prompt_tokens ?? "?"} in / ${geminiResult.usage.completion_tokens ?? "?"} out tokens*\n\n${geminiResult.markdown}`
      : `## Gemini — FAILED\n\n${geminiResult.error}`
    : "## Gemini — skipped (per --model flag)";

  const gptSection = gptResult
    ? gptResult.ok
      ? `## GPT ${gptResult.model}\n\n*usage: ${gptResult.usage.prompt_tokens ?? "?"} in / ${gptResult.usage.completion_tokens ?? "?"} out tokens*\n\n${gptResult.markdown}`
      : `## GPT — FAILED\n\n${gptResult.error}`
    : "## GPT — skipped (per --model flag)";

  const disagreement =
    geminiResult?.ok && gptResult?.ok
      ? detectDisagreements(geminiResult.markdown, gptResult.markdown)
      : "(disagreement check skipped — one or both models did not return findings)";

  return `# AI cross-verify — ${now}

**What:** ${what}
**Files:** ${files.length}
${totalCostNote}

${fileList}

---

${geminiSection}

---

${gptSection}

---

## Disagreement summary

${disagreement}
`;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${usage()}`);
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  if (!args.what || args.what.trim().length === 0) {
    process.stderr.write(`Error: --what is required.\n\n${usage()}`);
    process.exit(2);
  }
  if (args.files.length === 0) {
    process.stderr.write(`Error: at least one file path is required.\n\n${usage()}`);
    process.exit(2);
  }
  if (!["gemini", "gpt", "both"].includes(args.model)) {
    process.stderr.write(`Error: --model must be gemini, gpt, or both (got: ${args.model}).\n`);
    process.exit(2);
  }
  if (!Number.isFinite(args.maxTokensPerFile) || args.maxTokensPerFile < 100) {
    process.stderr.write(`Error: --max-tokens-per-file must be a positive integer >= 100.\n`);
    process.exit(2);
  }

  let files;
  try {
    files = await loadFiles(args.files, args.maxTokensPerFile);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }

  const userMessage = buildUserMessage(args.what, files);
  const totalCharCount = userMessage.length;
  const totalCostNote = `**Prompt size:** ${totalCharCount.toLocaleString()} chars (~${Math.round(totalCharCount / 4).toLocaleString()} tokens, rough)`;

  process.stderr.write(`[ai-review] ${files.length} file(s), ~${Math.round(totalCharCount / 4)} input tokens. Calling model(s)...\n`);

  // Parallel dispatch
  const tasks = [];
  if (args.model === "both" || args.model === "gemini") {
    tasks.push(
      (async () => {
        const apiKey = await resolveGeminiApiKey();
        return { which: "gemini", result: await callGemini({ systemInstruction: SYSTEM_INSTRUCTION, userMessage, apiKey }) };
      })(),
    );
  }
  if (args.model === "both" || args.model === "gpt") {
    tasks.push(
      (async () => {
        const apiKey = await resolveOpenAIApiKey();
        return { which: "gpt", result: await callGpt({ systemInstruction: SYSTEM_INSTRUCTION, userMessage, apiKey }) };
      })(),
    );
  }

  const settled = await Promise.all(tasks);
  let geminiResult = null;
  let gptResult = null;
  for (const s of settled) {
    if (s.which === "gemini") geminiResult = s.result;
    else if (s.which === "gpt") gptResult = s.result;
  }

  // Determine exit code: any requested model that failed bumps to 1.
  const requestedGemini = args.model === "both" || args.model === "gemini";
  const requestedGpt = args.model === "both" || args.model === "gpt";
  const geminiFailed = requestedGemini && (!geminiResult || !geminiResult.ok);
  const gptFailed = requestedGpt && (!gptResult || !gptResult.ok);
  const exitCode = geminiFailed || gptFailed ? 1 : 0;

  const outputPath = args.output ? resolve(args.output) : defaultOutputPath();
  const artifact = buildArtifact({
    what: args.what,
    files,
    geminiResult,
    gptResult,
    totalCostNote,
  });

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, artifact, "utf-8");
  } catch (e) {
    process.stderr.write(`Failed to write output ${outputPath}: ${e instanceof Error ? e.message : String(e)}\n`);
    // Still emit findings to stdout so they're not lost
    process.stdout.write(artifact);
    process.exit(1);
  }

  process.stderr.write(`[ai-review] Wrote findings to: ${outputPath}\n`);
  if (geminiFailed) process.stderr.write(`[ai-review] WARNING: Gemini call failed.\n`);
  if (gptFailed) process.stderr.write(`[ai-review] WARNING: GPT call failed.\n`);

  // Also print summary line to stdout for slash-command parsing
  process.stdout.write(
    JSON.stringify({
      output: outputPath,
      gemini_ok: !geminiFailed,
      gpt_ok: !gptFailed,
      files: files.length,
    }) + "\n",
  );

  process.exit(exitCode);
}

main().catch((e) => {
  process.stderr.write(`Uncaught: ${e instanceof Error ? e.stack || e.message : String(e)}\n`);
  process.exit(1);
});

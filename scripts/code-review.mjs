#!/usr/bin/env node
/**
 * code-review.mjs — local atomic-specialist code-review gate (deterministic).
 *
 * Runs ATOMIC reviewer agents (one invariant each) over the set of changed files
 * using the OpenAI Agents SDK (@openai/agents). Each agent reads ALL changed files
 * + any assigned .claude/rules/*.md (via function tools), hunts for its ONE
 * invariant, and returns structured JSON findings. One JSON report per agent, plus
 * a _summary.json.
 *
 * RIGIDITY (the point of this script):
 *   - Rigid WORKFLOW: control flow is code-driven. One job per selected agent; each
 *     job runs that agent ONCE over ALL changed files. Coverage — every selected
 *     invariant is checked against the whole changeset — is guaranteed by the loop,
 *     not by the model. Bounded retry re-runs a job that errors or returns malformed
 *     output. Agents are auto-skipped when no changed file matches their scopeGlobs
 *     (unless explicitly named via --agents).
 *   - Rigid INPUT: validated before any API call. Missing file or unknown agent =>
 *     hard fail (exit 2). No warn-and-continue.
 *   - Rigid OUTPUT: every finding re-validated — severity in enum, >=1 line number,
 *     `filename` resolves to a real changed file (or any repo file for crossFile/
 *     regression agents), and `rule_violated` MUST cite one of the agent's anchors
 *     (rule file, invariant key, or incident ref). Failures go to `rejected_findings`
 *     with a reason. Findings sorted deterministically for a stable report.
 *
 * Orchestrator (Claude Code, via /code-review) passes ONLY filenames — agents read
 * the file contents themselves.
 *
 * Usage:
 *   node scripts/code-review.mjs --files <a,b,c>
 *   node scripts/code-review.mjs [--agents <key,key>] [--app scheduler|admin|db|both]
 *                                [--out-dir <dir>] [--model <id>] <file1> <file2> ...
 *
 * Env:
 *   OPENAI_API_KEY                 API key (falls back to prod .env.local, same as ai-review).
 *   CODE_REVIEW_MODEL              Model id (default: gpt-5.6-terra; rollback: gpt-5.5-2026-04-23).
 *   CODE_REVIEW_REASONING_EFFORT   Reasoning effort (default: max; terra set: none|low|medium|high|xhigh|max).
 *   CODE_REVIEW_MAX_TURNS          Per-job agent loop cap (default: 30).
 *   CODE_REVIEW_MAX_RETRIES        Per-job retries on error/malformed output (default: 2).
 *   CODE_REVIEW_CONCURRENCY        Max parallel model calls (default: 4).
 *
 * Exit codes:
 *   0 - all selected jobs ran (findings, including blockers, are NOT a failure)
 *   1 - one or more jobs hard-failed after retries; partial reports written
 *   2 - bad args / bad input (no files, missing file, unknown agent, bad flag)
 *
 * The gate decision (block a push/deploy on blockers) is made by the caller / a
 * future PreToolUse hook reading these reports — NOT by this script's exit code.
 */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Agent definitions live in the dotfiles repo (everything agent-related is
// version-controlled there) and are reached through the .agents/ directory
// junction at the repo root (main/.agents -> dotfiles/.../.agents), mirroring
// the existing .claude symlink. Skills are read at runtime from
// .agents/skills/code-review/{key}/SKILL.md through the same junction.
import { SHARED_PREAMBLE, AGENTS } from "../.agents/code-review/code-review-agents.mjs";
import { resolveOpenAIApiKey } from "./lib/ai-review-gpt.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const SCHEMA_VERSION = "code-review-2.0";
// gpt-5.6-terra: GA 2026-07-09, half GPT-5.5's price, ≥ 5.5 on all published coding
// benchmarks (Chris's swap decision 2026-07-12). Rollback: CODE_REVIEW_MODEL=gpt-5.5-2026-04-23.
const MODEL = process.env.CODE_REVIEW_MODEL || "gpt-5.6-terra";
const MAX_TURNS = Number(process.env.CODE_REVIEW_MAX_TURNS) || 30;
const MAX_RETRIES = Number.isFinite(Number(process.env.CODE_REVIEW_MAX_RETRIES))
  ? Number(process.env.CODE_REVIEW_MAX_RETRIES)
  : 2;
const CONCURRENCY = Number(process.env.CODE_REVIEW_CONCURRENCY) || 4;
// gpt-5.6-terra reasoning: ModelSettings.reasoning.effort (none|low|medium|high|xhigh|max —
// `minimal` was a 5.5-era value, removed on the 5.6 family). Default is MAX per Chris's
// 2026-07-12 directive (highest effort on terra). If max-effort reviews over-flag (the older
// GPT-codex lineage measured higher FP rates than Claude — docs.bswen.com 2026-03-05) or run
// slow, step down via CODE_REVIEW_REASONING_EFFORT (medium was the pre-2026-07-12 tuning).
const REASONING_EFFORT = process.env.CODE_REVIEW_REASONING_EFFORT || "max";
// NOTE: a separate critic/verifier second pass is deliberately NOT built yet. The
// primary defenses are (1) the in-prompt self-verification loop in SHARED_PREAMBLE and
// (2) the evidence_line runner gate in validateFinding. Add an LLM-as-critic pass only
// if re-testing still shows false positives after these.

const DEFAULT_OUT_DIR = resolve(REPO_ROOT, ".claude/work/verification-reports");

const READ_FILE_CHAR_CAP = 400_000;
const GIT_DIFF_CHAR_CAP = 300_000;
const SEARCH_MAX_MATCHES = 200;
const SEARCH_FILE_SIZE_CAP = 500_000;
const SEARCH_EXCLUDE_DIRS = new Set([
  "node_modules", ".next", ".vercel", ".git", "dist", "build",
  "test-results", "playwright-report", ".cache", ".tmp", "_archive", "coverage",
]);
const SEARCH_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".css", ".json", ".md",
]);
const SEARCH_ROOTS = ["scheduler-app", "admin-app", "supabase", "scripts"];

const SEVERITY_RANK = { blocker: 0, important: 1, "nice-to-have": 2 };

// ─── path helpers ────────────────────────────────────────────────────────────

function toRepoRel(p) {
  return p.replace(/\\/g, "/");
}

function safePath(p) {
  const abs = resolve(REPO_ROOT, p);
  const root = REPO_ROOT.replace(/\\/g, "/");
  const got = abs.replace(/\\/g, "/");
  if (got !== root && !got.startsWith(root + "/")) {
    throw new Error(`path escapes repo root: ${p}`);
  }
  return abs;
}

async function fileExists(repoRelPath) {
  try {
    const s = await stat(safePath(repoRelPath));
    return s.isFile();
  } catch {
    return false;
  }
}

// Per-run cache of file line arrays (1-based access via index+1) for evidence checks.
const _fileLinesCache = new Map();
async function readFileLines(repoRelPath) {
  if (_fileLinesCache.has(repoRelPath)) return _fileLinesCache.get(repoRelPath);
  let lines = null;
  try {
    const text = await readFile(safePath(repoRelPath), "utf8");
    lines = text.split("\n");
  } catch {
    lines = null;
  }
  _fileLinesCache.set(repoRelPath, lines);
  return lines;
}

// Normalize a code line for tolerant comparison: collapse runs of whitespace,
// trim ends. Keeps punctuation/identifiers that make a line distinctive.
function normalizeCode(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// An agent applies to the changeset if it has no scopeGlobs (always) or any
// changed file path includes one of its scopeGlobs fragments.
function agentMatchesFiles(def, files) {
  if (!def.scopeGlobs || def.scopeGlobs.length === 0) return true;
  return files.some((f) => def.scopeGlobs.some((g) => f.includes(g)));
}

// ─── arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { files: [], agents: null, app: null, outDir: null, model: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--files") {
      args.files.push(...(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean));
    } else if (a === "--agents") {
      args.agents = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--app") {
      args.app = (argv[++i] || "").trim();
    } else if (a === "--out-dir") {
      args.outDir = argv[++i];
    } else if (a === "--model") {
      args.model = argv[++i];
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      args.files.push(a);
    }
  }
  args.files = [...new Set(args.files.map(toRepoRel))];
  return args;
}

function usage() {
  return `Usage:
  node scripts/code-review.mjs --files <a,b,c>
  node scripts/code-review.mjs [--agents <key,key>] [--app scheduler|admin|db|both] <file1> ...

Flags:
  --files <a,b,c>     Comma-separated changed files (repo-relative). Also positional.
  --agents <list>     Run exactly these agent keys (skips scopeGlobs auto-filter).
  --app <name>        Restrict to agents whose targetApp is <name> or "both".
  --out-dir <dir>     Report dir. Default: .claude/work/verification-reports/
  --model <id>        Override model (default env CODE_REVIEW_MODEL or ${MODEL}).

Known agents: ${AGENTS.map((a) => a.key).join(", ")}

Deterministic: one job per selected agent, each scanning ALL changed files for its
one invariant, with retries + post-run output validation. Exit: 0 ran · 1 a job
failed after retries · 2 bad args/input.
`;
}

// ─── concurrency pool ────────────────────────────────────────────────────────

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(lanes);
  return results;
}

// ─── tool factory ────────────────────────────────────────────────────────────

function buildTools(tool, z) {
  const read_file = tool({
    name: "read_file",
    description: "Read a UTF-8 source file by repo-relative path. Returns the file's full text (capped for very large files).",
    parameters: z.object({ path: z.string().describe("repo-relative file path, e.g. scheduler-app/src/x.ts") }),
    async execute({ path: p }) {
      const abs = safePath(p);
      let content = await readFile(abs, "utf8");
      if (content.length > READ_FILE_CHAR_CAP) {
        content = content.slice(0, READ_FILE_CHAR_CAP) + `\n\n... [TRUNCATED at ${READ_FILE_CHAR_CAP} chars]`;
      }
      return content;
    },
    errorFunction: (_ctx, err) => `read_file failed: ${err instanceof Error ? err.message : String(err)}`,
  });

  const list_dir = tool({
    name: "list_dir",
    description: "List entries of a directory by repo-relative path. Directories end with '/'.",
    parameters: z.object({ path: z.string() }),
    async execute({ path: p }) {
      const entries = await readdir(safePath(p), { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
    },
    errorFunction: (_ctx, err) => `list_dir failed: ${err instanceof Error ? err.message : String(err)}`,
  });

  const read_rule = tool({
    name: "read_rule",
    description: "Read a project rule file from .claude/rules by name (e.g. 'pattern-compliance'). These define the standards you enforce.",
    parameters: z.object({ name: z.string().describe("rule file base name, with or without .md") }),
    async execute({ name }) {
      const base = name.endsWith(".md") ? name : `${name}.md`;
      const abs = safePath(join(".claude/rules", base));
      return await readFile(abs, "utf8");
    },
    errorFunction: (_ctx, err) => `read_rule failed: ${err instanceof Error ? err.message : String(err)} (rules live in .claude/rules/)`,
  });

  const search_repo = tool({
    name: "search_repo",
    description: "Regex-search the repo for a pattern (e.g. a function/symbol name) to find callers/dependents. Returns up to 200 matches as 'path:line: text'. Excludes node_modules and build dirs.",
    parameters: z.object({ pattern: z.string().describe("a JS regular expression, e.g. 'createCustomer\\\\b'") }),
    async execute({ pattern }) {
      let re;
      try {
        re = new RegExp(pattern);
      } catch (e) {
        return `invalid regex: ${e instanceof Error ? e.message : String(e)}`;
      }
      const matches = [];
      async function walk(dir) {
        if (matches.length >= SEARCH_MAX_MATCHES) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (matches.length >= SEARCH_MAX_MATCHES) return;
          if (e.name.startsWith(".") && e.name !== ".claude") continue;
          if (SEARCH_EXCLUDE_DIRS.has(e.name)) continue;
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            await walk(full);
          } else if (SEARCH_EXTS.has(extname(e.name))) {
            let s;
            try {
              s = await stat(full);
            } catch {
              continue;
            }
            if (s.size > SEARCH_FILE_SIZE_CAP) continue;
            let text;
            try {
              text = await readFile(full, "utf8");
            } catch {
              continue;
            }
            const rel = relative(REPO_ROOT, full).replace(/\\/g, "/");
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                if (matches.length >= SEARCH_MAX_MATCHES) break;
              }
            }
          }
        }
      }
      for (const root of SEARCH_ROOTS) {
        await walk(join(REPO_ROOT, root));
      }
      if (matches.length === 0) return `no matches for /${pattern}/`;
      const capped = matches.length >= SEARCH_MAX_MATCHES ? ` (capped at ${SEARCH_MAX_MATCHES})` : "";
      return matches.join("\n") + capped;
    },
    errorFunction: (_ctx, err) => `search_repo failed: ${err instanceof Error ? err.message : String(err)}`,
  });

  const git_diff = tool({
    name: "git_diff",
    description:
      "Show the git diff (changes vs HEAD: staged + unstaged) so you can see EXACTLY what changed — added/removed/modified lines. Pass a repo-relative path to scope to one file, or empty string for all changes. Use this to find changed/renamed/removed exports and changed signatures/columns. New untracked files won't appear in the diff (read them with read_file instead).",
    parameters: z.object({
      path: z.string().describe("repo-relative file to scope the diff, or empty string for all changes"),
    }),
    async execute({ path: p }) {
      const argsArr = ["-c", "core.quotepath=false", "diff", "HEAD"];
      if (p && p.trim()) {
        safePath(p); // throws if the pathspec escapes the repo root
        argsArr.push("--", p);
      }
      try {
        const { stdout } = await execFileAsync("git", argsArr, {
          cwd: REPO_ROOT,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
        });
        if (!stdout.trim()) {
          return p && p.trim()
            ? `no tracked changes vs HEAD for ${p} (it may be a new/untracked file — use read_file)`
            : "no tracked changes vs HEAD";
        }
        return stdout.length > GIT_DIFF_CHAR_CAP
          ? stdout.slice(0, GIT_DIFF_CHAR_CAP) + `\n\n... [TRUNCATED git diff at ${GIT_DIFF_CHAR_CAP} chars]`
          : stdout;
      } catch (err) {
        return `git_diff failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    errorFunction: (_ctx, err) => `git_diff failed: ${err instanceof Error ? err.message : String(err)}`,
  });

  const read_skill = tool({
    name: "read_skill",
    description:
      "Read your invariant's SKILL — a package of operational knowledge with concrete GOOD-vs-BAD code examples of exactly what your one invariant's violation looks like (and what is NOT a violation). Call with name = your skill name (given in your task). Optionally pass reference = a filename under the skill's references/ folder to read a specific example file. Read your SKILL.md BEFORE reviewing so you know precisely what to flag and what to ignore.",
    parameters: z.object({
      name: z.string().describe("your skill name (the invariant key given in your task)"),
      reference: z
        .string()
        .nullable()
        .describe("optional: a filename under the skill's references/ folder; null to read SKILL.md"),
    }),
    async execute({ name, reference }) {
      const skillRoot = join(".agents/skills/code-review", name);
      const rel = reference && reference.trim()
        ? join(skillRoot, "references", reference)
        : join(skillRoot, "SKILL.md");
      const abs = safePath(rel);
      return await readFile(abs, "utf8");
    },
    errorFunction: (_ctx, err) =>
      `read_skill failed: ${err instanceof Error ? err.message : String(err)} (skills live in .agents/skills/code-review/{name}/SKILL.md; if none exists, rely on your specialty instructions)`,
  });

  return [read_file, list_dir, read_rule, search_repo, git_diff, read_skill];
}

// ─── per-agent input (one invariant, all files) ──────────────────────────────

function buildInput(def, files, hasSkill) {
  return [
    `Your single invariant: ${def.invariant}`,
    ``,
    hasSkill
      ? `STEP 1 — read your skill FIRST: call read_skill(name: "${def.key}"). It contains GOOD-vs-BAD code examples of exactly what this invariant's violation looks like and what is NOT a violation. Calibrate to it before flagging anything.`
      : ``,
    `Changed files to review (repo-relative). Read EACH in full with read_file:`,
    ...files.map((f) => `- ${f}`),
    def.ruleScope && def.ruleScope.length
      ? `\nRule files in your scope — read EACH with read_rule: ${def.ruleScope.join(", ")}`
      : ``,
    def.crossFile
      ? `\nFindings may anchor to a dependent/caller file (its repo-relative path + line), not only the changed files.`
      : `\nReport findings ONLY in the changed files above. Each finding's "filename" must be one of them.`,
    ``,
    `Hunt across ALL the files for violations of ONLY this invariant. For EVERY finding: set "evidence_line" to the EXACT verbatim text of the offending line copied from read_file output (this is verified against the file — a quote that doesn't match is discarded), and set "line_numbers" to that line's real number. If you cannot quote the exact offending line, do NOT report it. Return an empty findings array if there are no real violations. Set "rule_violated" to cite one of: ${def.anchors.join(", ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── output validation (rigid, anchor-based) ─────────────────────────────────

async function validateFinding(def, fileSet, raw) {
  const filename = typeof raw.filename === "string" ? toRepoRel(raw.filename) : "";

  if (!filename) return { ok: false, reason: "missing filename", finding: raw };

  if (def.crossFile) {
    if (!(await fileExists(filename))) {
      return { ok: false, reason: `filename '${filename}' does not resolve to a repo file`, finding: raw };
    }
  } else {
    if (!fileSet.has(filename)) {
      return { ok: false, reason: `filename '${filename}' is not one of the changed files under review`, finding: raw };
    }
  }

  if (!(raw.severity in SEVERITY_RANK)) {
    return { ok: false, reason: `bad severity '${raw.severity}'`, finding: raw };
  }

  let lines = Array.isArray(raw.line_numbers)
    ? raw.line_numbers.filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (lines.length === 0) {
    return { ok: false, reason: "no concrete line_numbers", finding: raw };
  }

  // Anchor check: rule_violated must cite one of this agent's anchors.
  const rv = String(raw.rule_violated || "").toLowerCase();
  const anchored = def.anchors.some((a) => rv.includes(a.toLowerCase()));
  if (!anchored) {
    return {
      ok: false,
      reason: `rule_violated '${raw.rule_violated}' cites no valid anchor (${def.anchors.join(", ")})`,
      finding: raw,
    };
  }

  // ── EVIDENCE GATE (anti-hallucination + mislocation auto-correct) ──
  // The model must quote the verbatim offending line in evidence_line. We verify
  // it against the real file. Match rule: a file line MATCHES the evidence only if
  // that line CONTAINS the evidence (content.includes(evidence)). We do NOT use the
  // reverse direction (evidence.includes(content)) — that falsely matched trivial
  // lines like "{" against any evidence containing a brace. Require a reasonably
  // distinctive quote (>= 12 normalized chars) so a weak quote can't match broadly.
  const evidence = normalizeCode(raw.evidence_line);
  if (evidence.length < 12) {
    return {
      ok: false,
      reason: `evidence_line missing or too short to verify (need a verbatim quote of the offending line): '${raw.evidence_line ?? ""}'`,
      finding: raw,
    };
  }
  const fileLines = await readFileLines(filename);
  let corrected = false;
  if (fileLines) {
    const matches = (lineNo) => normalizeCode(fileLines[lineNo - 1] ?? "").includes(evidence);
    const citedHit = lines.filter(matches);
    if (citedHit.length > 0) {
      lines = citedHit; // keep only cited lines that actually contain the quote
    } else {
      // Cited lines don't contain the quote → locate it; auto-correct the number.
      const found = [];
      for (let i = 0; i < fileLines.length; i++) {
        if (normalizeCode(fileLines[i]).includes(evidence)) {
          found.push(i + 1);
          if (found.length >= 5) break;
        }
      }
      if (found.length === 0) {
        return {
          ok: false,
          reason: `evidence_line not found in ${filename} (likely hallucinated/paraphrased): '${raw.evidence_line}'`,
          finding: raw,
        };
      }
      lines = found;
      corrected = true;
    }
  }
  // If fileLines is null the file couldn't be read; we already confirmed it exists,
  // so fall through trusting the cited lines rather than dropping a finding.

  return {
    ok: true,
    finding: {
      filename,
      severity: raw.severity,
      rule_violated: String(raw.rule_violated),
      line_numbers: [...new Set(lines)].sort((a, b) => a - b),
      evidence_line: String(raw.evidence_line ?? ""),
      line_corrected: corrected,
      issue_found: String(raw.issue_found ?? ""),
      explanation: String(raw.explanation ?? ""),
      recommended_fix: String(raw.recommended_fix ?? ""),
    },
  };
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    if (a.filename !== b.filename) return a.filename < b.filename ? -1 : 1;
    const la = a.line_numbers[0] ?? 0;
    const lb = b.line_numbers[0] ?? 0;
    if (la !== lb) return la - lb;
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sa !== sb) return sa - sb;
    return a.issue_found < b.issue_found ? -1 : a.issue_found > b.issue_found ? 1 : 0;
  });
}

// ─── one job: one agent over all files, bounded retry ────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runJob({ run }, def, agent, files, fileSet, hasSkill) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await run(agent, buildInput(def, files, hasSkill), { maxTurns: MAX_TURNS });
      const out = result.finalOutput;
      if (!out || !Array.isArray(out.findings)) {
        throw new Error("model returned no structured findings array");
      }
      const accepted = [];
      const rejected = [];
      for (const raw of out.findings) {
        const v = await validateFinding(def, fileSet, raw);
        if (v.ok) accepted.push(v.finding);
        else rejected.push({ reason: v.reason, raw: v.finding });
      }
      return { ok: true, attempts: attempt + 1, accepted: sortFindings(accepted), rejected };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      // Backoff before retrying. Rescues transient rate-limit 429s (concurrency
      // bursts) and 5xx; a quota-exhausted 429 still fails after retries — which
      // is correct, it must surface as status:"failed", never as a clean pass.
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s, ...
      }
    }
  }
  return { ok: false, attempts: MAX_RETRIES + 1, error: lastErr, accepted: [], rejected: [] };
}

// ─── report writers ──────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

async function writeReport(outDir, def, files, job) {
  // Explicit tri-state status so NO consumer can mistake a failed run (429 /
  // crash → issues:[]) for a clean pass (also issues:[]). Never infer
  // pass/fail from issues.length alone.
  //   "failed"   — the agent never produced a valid result (API error, retries exhausted)
  //   "clean"    — ran successfully, found nothing
  //   "findings" — ran successfully, found ≥1 issue
  const status = !job.ok ? "failed" : job.accepted.length > 0 ? "findings" : "clean";
  const report = {
    schema_version: SCHEMA_VERSION,
    agent: def.key,
    invariant: def.invariant,
    target_app: def.targetApp,
    model: MODEL,
    generated_at: nowIso(),
    files_reviewed: files,
    rules_in_scope: def.ruleScope,
    status,
    ok: job.ok,
    error: job.ok ? null : job.error,
    issues: job.accepted,
    rejected_findings: job.rejected,
  };
  const path = join(outDir, `${def.key}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf8");
  return { path, report };
}

// ─── main ────────────────────────────────────────────────────────────────────

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

  // ── RIGID INPUT VALIDATION ──
  if (args.files.length === 0) {
    process.stderr.write(`Error: at least one file is required.\n\n${usage()}`);
    process.exit(2);
  }
  if (args.app && !["scheduler", "admin", "db", "both"].includes(args.app)) {
    process.stderr.write(`Error: --app must be scheduler|admin|db|both (got '${args.app}').\n`);
    process.exit(2);
  }

  const byKey = new Map(AGENTS.map((a) => [a.key, a]));

  // Selection: explicit --agents wins; else auto-filter by scopeGlobs (+ --app).
  let selected;
  if (args.agents) {
    selected = [];
    for (const k of args.agents) {
      const def = byKey.get(k);
      if (!def) {
        process.stderr.write(`Error: unknown agent '${k}'. Known: ${[...byKey.keys()].join(", ")}\n`);
        process.exit(2);
      }
      selected.push(def);
    }
  } else {
    selected = AGENTS.filter((d) => agentMatchesFiles(d, args.files));
    if (args.app) {
      selected = selected.filter((d) => d.targetApp === args.app || d.targetApp === "both");
    }
  }

  // Every input file must exist — rigid, no warn-and-continue.
  const missing = [];
  for (const f of args.files) {
    if (!(await fileExists(f))) missing.push(f);
  }
  if (missing.length > 0) {
    process.stderr.write(`Error: file(s) not found:\n${missing.map((m) => `  - ${m}`).join("\n")}\n`);
    process.exit(2);
  }

  if (selected.length === 0) {
    process.stderr.write(
      `[code-review] No agents match the changed files (scopeGlobs filter). Nothing to do.\n`,
    );
    // Still emit an empty summary so callers have a stable artifact.
    const outDir = args.outDir ? resolve(args.outDir) : DEFAULT_OUT_DIR;
    await mkdir(outDir, { recursive: true });
    const summary = {
      schema_version: SCHEMA_VERSION,
      generated_at: nowIso(),
      model: args.model || MODEL,
      files_reviewed: args.files,
      agents: [],
      totals: { issues: 0, blocker: 0, important: 0, "nice-to-have": 0, rejected: 0 },
      reports: [],
      all_jobs_ok: true,
      note: "no agents matched the changed files",
    };
    await writeFile(join(outDir, "_summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
    process.stdout.write(JSON.stringify(summary) + "\n");
    process.exit(0);
  }

  // ── Load SDK ──
  let Agent, run, tool, setDefaultOpenAIKey, z;
  try {
    ({ Agent, run, tool, setDefaultOpenAIKey } = await import("@openai/agents"));
    ({ z } = await import("zod"));
  } catch (e) {
    process.stderr.write(
      `[code-review] Missing dependencies. Run:\n  npm install\n(@openai/agents + zod must be installed)\nDetail: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  }

  const apiKey = await resolveOpenAIApiKey();
  if (!apiKey) {
    process.stderr.write(`[code-review] No OPENAI_API_KEY found (env or prod .env.local fallback).\n`);
    process.exit(1);
  }
  setDefaultOpenAIKey(apiKey);

  const model = args.model || MODEL;

  // Rigid OUTPUT schema (structured-output contract). All fields required.
  // evidence_line: the VERBATIM text of the primary offending line, copied from
  // tool output. The runner verifies it against the file (anti-hallucination +
  // auto-corrects mislocated line numbers). A finding whose evidence_line is not
  // found in the file is rejected as a likely hallucination.
  const Finding = z.object({
    filename: z.string(),
    severity: z.enum(["blocker", "important", "nice-to-have"]),
    rule_violated: z.string(),
    line_numbers: z.array(z.number()),
    evidence_line: z.string(),
    issue_found: z.string(),
    explanation: z.string(),
    recommended_fix: z.string(),
  });
  const ReviewOutput = z.object({ findings: z.array(Finding) });

  const tools = buildTools(tool, z);
  const outDir = args.outDir ? resolve(args.outDir) : DEFAULT_OUT_DIR;
  await mkdir(outDir, { recursive: true });

  const fileSet = new Set(args.files);

  // Which selected agents have a SKILL.md (good-vs-bad example pack)?
  const skillKeys = new Set();
  for (const def of selected) {
    if (await fileExists(join(".agents/skills/code-review", def.key, "SKILL.md"))) {
      skillKeys.add(def.key);
    }
  }

  // One Agent per selected invariant.
  const agents = new Map();
  for (const def of selected) {
    agents.set(
      def.key,
      new Agent({
        name: def.name,
        instructions: `${SHARED_PREAMBLE}\n\n${def.specialty}`,
        model,
        tools,
        outputType: ReviewOutput,
        modelSettings: { reasoning: { effort: REASONING_EFFORT } },
      }),
    );
  }

  process.stderr.write(
    `[code-review] ${selected.length} atomic agent(s) over ${args.files.length} file(s) · model ${model} · maxTurns ${MAX_TURNS} · retries ${MAX_RETRIES} · concurrency ${CONCURRENCY}\n`,
  );
  process.stderr.write(`[code-review]   agents: ${selected.map((d) => d.key).join(", ")}\n`);

  // ── RIGID WORKFLOW: one job per agent, each over ALL files ──
  const jobResults = await pool(selected, CONCURRENCY, async (def) => {
    const job = await runJob({ run }, def, agents.get(def.key), args.files, fileSet, skillKeys.has(def.key));
    const status = job.ok
      ? `${job.accepted.length} found${job.rejected.length ? `, ${job.rejected.length} rejected` : ""}`
      : `FAILED: ${job.error}`;
    process.stderr.write(`[code-review]   ${def.key} · ${status}\n`);
    return { def, job };
  });

  const written = await Promise.all(jobResults.map(({ def, job }) => writeReport(outDir, def, args.files, job)));

  // ── Summary ──
  let anyFailed = false;
  const failedAgents = [];
  const summaryRows = [];
  for (const { report } of written) {
    if (!report.ok) {
      anyFailed = true;
      failedAgents.push({ agent: report.agent, error: report.error });
    }
    const counts = { blocker: 0, important: 0, "nice-to-have": 0 };
    for (const issue of report.issues) counts[issue.severity]++;
    summaryRows.push({
      agent: report.agent,
      target_app: report.target_app,
      status: report.status,
      ok: report.ok,
      total: report.issues.length,
      ...counts,
      rejected: report.rejected_findings.length,
    });
  }
  const totals = summaryRows.reduce(
    (acc, r) => {
      acc.issues += r.total;
      acc.blocker += r.blocker;
      acc.important += r.important;
      acc["nice-to-have"] += r["nice-to-have"];
      acc.rejected += r.rejected;
      return acc;
    },
    { issues: 0, blocker: 0, important: 0, "nice-to-have": 0, rejected: 0 },
  );
  totals.failed = failedAgents.length;

  // Gate verdict — FAIL-CLOSED. "block" if any blocker finding OR any agent
  // failed to run (a 429/crash is NOT a pass — the code was never reviewed).
  // A consumer (/feature-verify, a pre-push hook) gates on `gate`, never on
  // issue counts alone. block_reasons makes the cause explicit.
  const blockReasons = [];
  if (totals.blocker > 0) blockReasons.push(`${totals.blocker} blocker finding(s)`);
  if (failedAgents.length > 0) {
    blockReasons.push(`${failedAgents.length} agent(s) failed to run (review incomplete): ${failedAgents.map((f) => f.agent).join(", ")}`);
  }
  const gate = blockReasons.length > 0 ? "block" : "pass";

  const summary = {
    schema_version: SCHEMA_VERSION,
    generated_at: nowIso(),
    model,
    files_reviewed: args.files,
    gate,
    block_reasons: blockReasons,
    agents: summaryRows,
    totals,
    failed_agents: failedAgents,
    reports: written.map((w) => relative(REPO_ROOT, w.path).replace(/\\/g, "/")),
    all_jobs_ok: !anyFailed,
    review_complete: !anyFailed,
  };
  await writeFile(join(outDir, "_summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");

  if (failedAgents.length > 0) {
    process.stderr.write(
      `[code-review] ⚠ ${failedAgents.length} agent(s) FAILED to run — review INCOMPLETE, not clean:\n`,
    );
    for (const f of failedAgents) {
      process.stderr.write(`[code-review]     ✗ ${f.agent}: ${f.error}\n`);
    }
  }
  process.stderr.write(
    `[code-review] gate=${gate.toUpperCase()} · ${totals.issues} issue(s): ${totals.blocker} blocker, ${totals.important} important · ${totals.failed} failed · ${totals.rejected} rejected · reports in ${relative(REPO_ROOT, outDir).replace(/\\/g, "/")}/\n`,
  );

  process.stdout.write(JSON.stringify(summary) + "\n");
  process.exit(anyFailed ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`Uncaught: ${e instanceof Error ? e.stack || e.message : String(e)}\n`);
  process.exit(1);
});

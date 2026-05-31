#!/usr/bin/env node
/**
 * code-review.mjs — local specialized code-review gate (deterministic).
 *
 * Runs N specialized reviewer agents (security / pattern / regression) over a
 * set of changed files using the OpenAI Agents SDK (@openai/agents). Each agent
 * reads files + its assigned .claude/rules/*.md itself (via function tools),
 * applies two-pass verification, and returns structured JSON findings. One JSON
 * report is written per agent, plus a _summary.json.
 *
 * RIGIDITY (the point of this script):
 *   - Rigid WORKFLOW: control flow is code-driven, not model-driven. An explicit
 *     loop runs ONE agent over ONE file per model call (agents × files). Coverage
 *     — every file checked by every applicable reviewer — is guaranteed by the
 *     loop, not by the model deciding it read enough. A bounded retry loop re-runs
 *     a job that errors or returns malformed output.
 *   - Rigid INPUT: validated by a zod schema before any API call. Missing file or
 *     unknown agent => hard fail (exit 2). No warn-and-continue.
 *   - Rigid OUTPUT: every finding re-validated after the run — severity in enum,
 *     >=1 line number, `filename` resolves to a real repo file (== file under
 *     review for single-file reviewers; any repo file for cross-file reviewers),
 *     and `rule_violated` MUST cite a rule file in that agent's scope. Failures go
 *     to `rejected_findings` with a reason (never silently dropped or passed).
 *     Findings are sorted deterministically so the report is stable.
 *
 * This is the LOCAL implementation of the workflow that can also be authored in
 * OpenAI Agent Builder. Builder can't express local filesystem tools, so the
 * graph + prompts are designed there and the tools + deterministic loop live
 * here. See docs/code-review/agent-builder-design.md.
 *
 * The orchestrator (Claude Code, via /code-review) passes ONLY filenames — the
 * agents read the file contents themselves.
 *
 * Usage:
 *   node scripts/code-review.mjs --files <a,b,c>
 *   node scripts/code-review.mjs [--agents security,pattern,regression]
 *                                [--out-dir <dir>] [--model <id>]
 *                                <file1> <file2> ...
 *
 * Env:
 *   OPENAI_API_KEY           API key (falls back to prod .env.local, same as ai-review).
 *   CODE_REVIEW_MODEL        Model id (default: gpt-5.5-2026-04-23).
 *   CODE_REVIEW_MAX_TURNS    Per-run agent loop cap (default: 25).
 *   CODE_REVIEW_MAX_RETRIES  Per-job retries on error/malformed output (default: 2).
 *   CODE_REVIEW_CONCURRENCY  Max parallel model calls (default: 4).
 *
 * Exit codes (match scripts/ai-review.mjs convention):
 *   0 - all jobs ran (findings, including blockers, are NOT a failure)
 *   1 - one or more jobs hard-failed after retries; partial reports written
 *   2 - bad args / bad input (no files, missing file, unknown agent, bad flag)
 *
 * NOTE: the gate decision (block a push/deploy on blockers) is made by the
 * caller / a future PreToolUse hook reading these reports — NOT by this script's
 * exit code. A clean run with 5 blockers still exits 0.
 */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve, dirname, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { SHARED_PREAMBLE, AGENTS } from "./lib/code-review-agents.mjs";
import { resolveOpenAIApiKey } from "./lib/ai-review-gpt.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const SCHEMA_VERSION = "code-review-1.0";
const MODEL = process.env.CODE_REVIEW_MODEL || "gpt-5.5-2026-04-23";
const MAX_TURNS = Number(process.env.CODE_REVIEW_MAX_TURNS) || 25;
const MAX_RETRIES = Number.isFinite(Number(process.env.CODE_REVIEW_MAX_RETRIES))
  ? Number(process.env.CODE_REVIEW_MAX_RETRIES)
  : 2;
const CONCURRENCY = Number(process.env.CODE_REVIEW_CONCURRENCY) || 4;

const RULES_DIR = resolve(REPO_ROOT, ".claude/rules");
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, ".claude/work/verification-reports");

const READ_FILE_CHAR_CAP = 400_000;
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

// ─── arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { files: [], agents: null, outDir: null, model: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--files") {
      args.files.push(...(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean));
    } else if (a === "--agents") {
      args.agents = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
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
  // de-dupe + normalize file paths
  args.files = [...new Set(args.files.map(toRepoRel))];
  return args;
}

function usage() {
  return `Usage:
  node scripts/code-review.mjs --files <a,b,c>
  node scripts/code-review.mjs [--agents ${AGENTS.map((a) => a.key).join(",")}] <file1> <file2> ...

Flags:
  --files <a,b,c>     Comma-separated changed files (repo-relative). Also accepts
                      positional file args.
  --agents <list>     Which reviewers to run. Default: all (${AGENTS.map((a) => a.key).join(", ")}).
  --out-dir <dir>     Where to write JSON reports. Default:
                      .claude/work/verification-reports/
  --model <id>        Override model (default env CODE_REVIEW_MODEL or ${MODEL}).

Deterministic: runs one reviewer over one file per model call (agents x files),
with per-job retries and post-run output validation. Exit: 0 ran · 1 a job failed
after retries · 2 bad args/input.
`;
}

// ─── concurrency pool (deterministic accumulation; workers never throw) ───────

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

  return [read_file, list_dir, read_rule, search_repo];
}

// ─── per-job input (one agent, one file) ─────────────────────────────────────

function buildInput(def, file) {
  return [
    `Review EXACTLY ONE changed file: ${file}`,
    ``,
    `Read it in full with read_file. Read EACH rule file in your scope with read_rule:`,
    ...def.ruleScope.map((r) => `- ${r}`),
    def.crossFile
      ? `\nUse search_repo to find dependents. Findings may anchor to the dependent/caller file (its repo-relative path + line), not only ${file}.`
      : `\nReport findings ONLY in ${file}. The "filename" of every finding must be exactly "${file}".`,
    ``,
    `Apply two-pass verification and return ALL in-scope findings for this file. Return an empty findings array if there are none. Every finding must cite a named rule from one of: ${def.ruleScope.map((r) => `${r}.md`).join(", ")}.`,
  ].join("\n");
}

// ─── output validation (rigid) ───────────────────────────────────────────────

/**
 * Validate one raw finding against the agent's contract.
 * Returns { ok: true, finding } or { ok: false, reason, finding }.
 */
async function validateFinding(def, file, raw) {
  const filename = typeof raw.filename === "string" ? toRepoRel(raw.filename) : "";

  // 1. filename must resolve to a real repo file.
  if (!filename) return { ok: false, reason: "missing filename", finding: raw };
  if (!def.crossFile && filename !== file) {
    return { ok: false, reason: `filename '${filename}' != file under review '${file}' (single-file reviewer)`, finding: raw };
  }
  if (!(await fileExists(filename))) {
    return { ok: false, reason: `filename '${filename}' does not resolve to a repo file (possible hallucination)`, finding: raw };
  }

  // 2. severity in enum (zod already enforces, but guard defensively).
  if (!(raw.severity in SEVERITY_RANK)) {
    return { ok: false, reason: `bad severity '${raw.severity}'`, finding: raw };
  }

  // 3. >=1 concrete, positive, integer line number.
  const lines = Array.isArray(raw.line_numbers)
    ? raw.line_numbers.filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (lines.length === 0) {
    return { ok: false, reason: "no concrete line_numbers", finding: raw };
  }

  // 4. rule-anchoring: rule_violated must cite a rule file in this agent's scope.
  const rv = String(raw.rule_violated || "").toLowerCase();
  const inScope = def.ruleScope.some((r) => rv.includes(r.toLowerCase()));
  if (!inScope) {
    return {
      ok: false,
      reason: `rule_violated '${raw.rule_violated}' cites no rule in scope (${def.ruleScope.join(", ")})`,
      finding: raw,
    };
  }

  // Normalized, accepted finding.
  return {
    ok: true,
    finding: {
      filename,
      severity: raw.severity,
      rule_violated: String(raw.rule_violated),
      line_numbers: [...new Set(lines)].sort((a, b) => a - b),
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

// ─── one job: one agent over one file, with bounded retry ────────────────────

async function runJob({ Agent, run }, def, agent, file) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await run(agent, buildInput(def, file), { maxTurns: MAX_TURNS });
      const out = result.finalOutput;
      if (!out || !Array.isArray(out.findings)) {
        throw new Error("model returned no structured findings array");
      }
      const accepted = [];
      const rejected = [];
      for (const raw of out.findings) {
        const v = await validateFinding(def, file, raw);
        if (v.ok) accepted.push(v.finding);
        else rejected.push({ file, reason: v.reason, raw: v.finding });
      }
      return { ok: true, file, attempts: attempt + 1, accepted, rejected };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, file, attempts: MAX_RETRIES + 1, error: lastErr, accepted: [], rejected: [] };
}

// ─── report writers ──────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

async function writeReport(outDir, def, files, jobs) {
  const accepted = [];
  const rejected = [];
  const failedFiles = [];
  let okFiles = 0;
  for (const j of jobs) {
    if (j.ok) {
      okFiles++;
      accepted.push(...j.accepted);
      rejected.push(...j.rejected);
    } else {
      failedFiles.push({ file: j.file, error: j.error });
    }
  }
  const report = {
    schema_version: SCHEMA_VERSION,
    agent: def.key,
    model: MODEL,
    generated_at: nowIso(),
    files_reviewed: files,
    rules_in_scope: def.ruleScope,
    ok: failedFiles.length === 0,
    coverage: { files_total: files.length, files_ok: okFiles, files_failed: failedFiles.length },
    failed_files: failedFiles,
    issues: sortFindings(accepted),
    rejected_findings: rejected,
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

  // ── RIGID INPUT VALIDATION (fail fast, exit 2) ──
  if (args.files.length === 0) {
    process.stderr.write(`Error: at least one file is required.\n\n${usage()}`);
    process.exit(2);
  }
  const byKey = new Map(AGENTS.map((a) => [a.key, a]));
  let selected = AGENTS;
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

  // Rigid OUTPUT schema (structured-output contract). Strict mode: all required.
  const Finding = z.object({
    filename: z.string(),
    severity: z.enum(["blocker", "important", "nice-to-have"]),
    rule_violated: z.string(),
    line_numbers: z.array(z.number()),
    issue_found: z.string(),
    explanation: z.string(),
    recommended_fix: z.string(),
  });
  const ReviewOutput = z.object({ findings: z.array(Finding) });

  const tools = buildTools(tool, z);
  const outDir = args.outDir ? resolve(args.outDir) : DEFAULT_OUT_DIR;
  await mkdir(outDir, { recursive: true });

  // One Agent instance per reviewer (reused across its files).
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
      }),
    );
  }

  // ── RIGID WORKFLOW: explicit job grid (agents x files), code-driven ──
  const jobGrid = [];
  for (const def of selected) {
    for (const file of args.files) {
      jobGrid.push({ def, file });
    }
  }

  process.stderr.write(
    `[code-review] ${selected.length} reviewer(s) x ${args.files.length} file(s) = ${jobGrid.length} job(s) · model ${model} · maxTurns ${MAX_TURNS} · retries ${MAX_RETRIES} · concurrency ${CONCURRENCY}\n`,
  );

  const jobResults = await pool(jobGrid, CONCURRENCY, async ({ def, file }) => {
    const r = await runJob({ Agent, run }, def, agents.get(def.key), file);
    const status = r.ok ? `${r.accepted.length} found${r.rejected.length ? `, ${r.rejected.length} rejected` : ""}` : `FAILED: ${r.error}`;
    process.stderr.write(`[code-review]   ${def.key} · ${file} · ${status}\n`);
    return { def, ...r };
  });

  // Group job results by agent (deterministic order = selected order).
  const byAgent = new Map(selected.map((d) => [d.key, []]));
  for (const r of jobResults) byAgent.get(r.def.key).push(r);

  const writes = [];
  for (const def of selected) {
    writes.push(writeReport(outDir, def, args.files, byAgent.get(def.key)));
  }
  const written = await Promise.all(writes);

  // ── Summary ──
  let anyFailed = false;
  const summaryRows = [];
  for (const { report } of written) {
    if (!report.ok) anyFailed = true;
    const counts = { blocker: 0, important: 0, "nice-to-have": 0 };
    for (const issue of report.issues) counts[issue.severity]++;
    summaryRows.push({
      agent: report.agent,
      ok: report.ok,
      total: report.issues.length,
      ...counts,
      rejected: report.rejected_findings.length,
      coverage: report.coverage,
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

  const summary = {
    schema_version: SCHEMA_VERSION,
    generated_at: nowIso(),
    model,
    files_reviewed: args.files,
    agents: summaryRows,
    totals,
    reports: written.map((w) => relative(REPO_ROOT, w.path).replace(/\\/g, "/")),
    all_jobs_ok: !anyFailed,
  };
  await writeFile(join(outDir, "_summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");

  process.stderr.write(
    `[code-review] done · ${totals.issues} issue(s): ${totals.blocker} blocker, ${totals.important} important · ${totals.rejected} rejected · reports in ${relative(REPO_ROOT, outDir).replace(/\\/g, "/")}/\n`,
  );

  process.stdout.write(JSON.stringify(summary) + "\n");
  process.exit(anyFailed ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`Uncaught: ${e instanceof Error ? e.stack || e.message : String(e)}\n`);
  process.exit(1);
});

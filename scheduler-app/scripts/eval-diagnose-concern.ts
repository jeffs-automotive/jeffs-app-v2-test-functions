/**
 * eval-diagnose-concern — direct LLM eval harness (2026-05-17).
 *
 * Runs every concern in scripts/concerns.json through the same
 * `diagnoseConcern` pipeline the wizard uses at Step 7.3, captures the
 * exact system + user prompt sent to the LLM, and writes a markdown
 * report so we can see what the model is actually doing without
 * driving the wizard end-to-end.
 *
 * Why this exists: the wizard test surface is slow + has many steps;
 * the LLM is the place where customers were reporting "skipped" behavior.
 * Hitting diagnoseConcern directly lets us debug the LLM in isolation.
 *
 * Usage (from scheduler-app/):
 *   node --experimental-strip-types --env-file=.env.local scripts/eval-diagnose-concern.ts
 *
 * Reads:  scripts/concerns.json (50 concerns, verbatim from yourmechanic.com)
 * Writes: docs/scheduler/diagnose-eval-<timestamp>.md
 *
 * Required env vars (from .env.local):
 *   - ANTHROPIC_API_KEY       — used by @ai-sdk/anthropic via the
 *                               anthropic() factory
 *   - NEXT_PUBLIC_SUPABASE_URL  — to load the diagnostic catalog
 *   - SUPABASE_SECRET_KEY     — service-role key for catalog read
 *     (the same name resolve-keys.ts uses for the admin client)
 *
 * Notes:
 *   - All 50 concerns are routed through the "Other Issue" pseudo-chip
 *     path (no chip hint) — the hardest classification case for the LLM.
 *     If it works here, it works even better when a chip narrows the
 *     concern_categories.
 *   - This script is local-only; it imports from the running app's
 *     `src/` so the prompt + behaviour match production exactly.
 */
// IMPORTANT: env cleanup MUST happen before any other module is imported,
// because @ai-sdk/anthropic captures env at module-evaluation time. If
// ANTHROPIC_BASE_URL is still polluted (Vercel auto-injects it as
// "https://api.anthropic.com" without /v1) when the SDK module evaluates,
// every API call returns 404 — verified empirically 2026-05-18.
//
// Only `node:*` builtins are statically imported below. Everything else
// is loaded via dynamic import() inside main(), AFTER the env IIFE has
// stripped the offending vars.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Lenient .env.local loader — replaces Node's --env-file flag, which is
// strict about quoting in a way that Vercel-pulled files break (Vercel
// wraps values in double quotes; Node 24's parser drops some such lines
// silently). Reads .env.local from CWD and overlays its values onto
// process.env unless the var is already set in the shell. Strips
// surrounding single/double quotes. Skips comments + blank lines.
(function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  const lineRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(.*?))\s*$/;
  // Skip `vercel env pull`'s auto-injected runtime env vars. Two reasons:
  //   1. AI_GATEWAY_API_KEY (+ companion VERCEL_* signals) makes the AI SDK
  //      route Anthropic calls through Vercel's AI Gateway instead of
  //      directly to api.anthropic.com — and the gateway returns 404 from
  //      a CLI context, which surfaces as `llm_call_failed: Not Found` for
  //      every concern.
  //   2. VERCEL=1 + VERCEL_ENV=production trick the AI SDK into
  //      "production" code paths that expect Next.js + the Edge runtime
  //      lifecycle to be present.
  // The eval needs direct Anthropic calls, so we drop these.
  const skipPrefixes = ["VERCEL_", "AI_GATEWAY_", "TURBO_", "NX_"];
  // ANTHROPIC_BASE_URL: Vercel auto-injects this as "https://api.anthropic.com"
  // (no /v1 path) for AI-Gateway routing. The @ai-sdk/anthropic factory appends
  // "/messages" to whatever base URL it sees, producing "/messages" → 404
  // because the real endpoint needs "/v1/messages". Drop the var so the SDK
  // falls back to its default base "https://api.anthropic.com/v1".
  const skipExact = new Set(["VERCEL", "ANTHROPIC_BASE_URL"]);
  let loaded = 0;
  let skipped = 0;
  let unparsed = 0;
  for (const rawLine of raw.split(/\r?\n/)) {
    if (!rawLine || rawLine.trim().startsWith("#")) continue;
    const m = rawLine.match(lineRe);
    if (!m) {
      // Quick visibility for diagnosing why a key didn't load — show the
      // line's KEY (before =) without exposing the value.
      const keyOnly = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (keyOnly && process.env.EVAL_DIAGNOSE_VERBOSE) {
        console.log(`[env-loader] UNPARSED line for key=${keyOnly[1]} (length=${rawLine.length})`);
      }
      unparsed += 1;
      continue;
    }
    const [, key, dq, sq, plain] = m;
    if (!key) continue;
    if (skipExact.has(key) || skipPrefixes.some((p) => key.startsWith(p))) {
      skipped += 1;
      continue;
    }
    let value: string;
    if (dq !== undefined) value = dq.replace(/\\(.)/g, "$1");
    else if (sq !== undefined) value = sq;
    else value = plain ?? "";
    // Targeted debug for the ANTHROPIC key specifically — show what got
    // extracted (length only, never the value).
    if (key === "ANTHROPIC_API_KEY" && process.env.EVAL_DIAGNOSE_VERBOSE) {
      console.log(
        `[env-loader] ANTHROPIC_API_KEY parse: matched ${dq !== undefined ? "double-quoted" : sq !== undefined ? "single-quoted" : "unquoted"}, extracted len=${value.length}, shellEnvHas=${process.env[key] !== undefined}, shellEnvLen=${(process.env[key] ?? "").length}`,
      );
    }
    if (process.env[key]) continue;
    process.env[key] = value;
    loaded += 1;
  }
  // Belt-and-suspenders: even if a skip-list entry slipped through (or
  // came in from a parent process), explicitly delete the AI-Gateway-
  // related vars so the SDK uses its default Anthropic base URL.
  for (const k of ["ANTHROPIC_BASE_URL", "AI_GATEWAY_API_KEY", "VERCEL", "VERCEL_ENV"]) {
    if (process.env[k]) {
      delete process.env[k];
    }
  }
  if (process.env.EVAL_DIAGNOSE_VERBOSE) {
    console.log(
      `[env-loader] Loaded ${loaded} key(s) from .env.local (skipped ${skipped}, unparsed ${unparsed}).`,
    );
    console.log(
      `[env-loader] ANTHROPIC_BASE_URL after cleanup: ${process.env.ANTHROPIC_BASE_URL ?? "(unset ✓)"}`,
    );
    console.log(
      `[env-loader] ANTHROPIC_API_KEY loaded: ${process.env.ANTHROPIC_API_KEY ? `yes (len=${process.env.ANTHROPIC_API_KEY.length})` : "NO"}`,
    );
  }
})();

// Note: @sentry/nextjs is imported by diagnose-concern.ts but never
// initialised in this script's CLI context. ESM module namespaces are
// frozen so we can't monkey-patch missing Sentry methods. Instead, the
// per-concern try/catch in the loop catches the cascading "Sentry.* is
// not a function" error and records it as a failed entry — the eval
// continues regardless of any one concern's Sentry-throw.

// Static type-only imports — these don't execute the runtime modules
// (TS strips them at compile time). The actual runtime values come from
// dynamic imports inside main() after env cleanup.
import type {
  DiagnoseConcernArgs,
  DiagnoseConcernResult,
} from "../src/lib/scheduler/wizard/llm/diagnose-concern";

interface ConcernRow {
  id: number;
  category_expected: string;
  text: string;
  source: string;
}

interface ConcernsFile {
  concerns: ConcernRow[];
}

interface EvalEntry {
  concern: ConcernRow;
  systemPrompt: string;
  userPrompt: string;
  result: DiagnoseConcernResult;
  routingOutcome: string;
  wallMs: number;
}

function envOrDie(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function routingOutcomeFor(result: DiagnoseConcernResult): string {
  if (!result.parsed_ok && result.error_message) {
    return `forward-to-advisor (fail-safe: ${result.error_message})`;
  }
  if (result.matched_kind === null) {
    return "forward-to-advisor (LLM returned matched_category_key=null)";
  }
  if (result.matched_kind === "other_subcategory") {
    return `forward-to-advisor (LLM matched 'other' subcategory: ${result.matched_category_key})`;
  }
  if (result.unanswered_question_ids.length > 0) {
    return `clarification_question → testing_service_approval (${result.recommended_testing_service?.service_key}; ${result.unanswered_question_ids.length} unanswered Q)`;
  }
  return `testing_service_approval (${result.recommended_testing_service?.service_key}; no clarifying Qs needed)`;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const repoRoot = resolve(__dirname, "..", "..");

  // Dynamic imports — these execute the runtime modules AFTER env
  // cleanup so @ai-sdk/anthropic doesn't capture the polluted
  // ANTHROPIC_BASE_URL.
  const { createClient } = await import("@supabase/supabase-js");
  const {
    buildSystemPrompt,
    buildUserPrompt,
    diagnoseConcern,
  } = await import("../src/lib/scheduler/wizard/llm/diagnose-concern.js");
  const { loadDiagnosticCatalog } = await import(
    "../src/lib/scheduler/wizard/llm/load-diagnostic-catalog.js"
  );
  const { resolveServiceRoleKey, resolveSupabaseUrl } = await import(
    "../src/lib/supabase/resolve-keys.js"
  );

  // Read concerns
  const concernsPath = resolve(__dirname, "concerns.json");
  const concernsFile = JSON.parse(
    readFileSync(concernsPath, "utf8"),
  ) as ConcernsFile;
  console.log(`Loaded ${concernsFile.concerns.length} concerns.`);

  // Sanity check env — use the same resolver the app uses so any of the
  // 2026-canonical (SUPABASE_SECRET_KEYS plural-dict), transition-period
  // (SUPABASE_SECRET_KEY), or legacy (SUPABASE_SERVICE_ROLE_KEY) forms
  // are accepted.
  envOrDie("ANTHROPIC_API_KEY");
  const supabaseUrl = resolveSupabaseUrl(process.env);
  if (!supabaseUrl) {
    throw new Error(
      "Missing Supabase URL — set NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.",
    );
  }
  const serviceKey = resolveServiceRoleKey(process.env);
  if (!serviceKey) {
    throw new Error(
      "Missing Supabase service-role key — set one of SUPABASE_SECRET_KEYS (canonical JSON dict), SUPABASE_SECRET_KEY (singular), or SUPABASE_SERVICE_ROLE_KEY (legacy).",
    );
  }

  // Load catalog
  console.log("Loading diagnostic catalog from Supabase…");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const catalog = await loadDiagnosticCatalog(supabase);
  const testingCount = catalog.categories.filter(
    (c) => c.kind === "testing_service",
  ).length;
  const otherCount = catalog.categories.filter(
    (c) => c.kind === "other_subcategory",
  ).length;
  console.log(
    `Catalog: ${catalog.categories.length} categories (${testingCount} testing services + ${otherCount} 'other' subcategories).`,
  );
  if (testingCount === 0 || otherCount === 0) {
    throw new Error(
      `Catalog is incomplete — testing_services=${testingCount}, other=${otherCount}. Check the DB has been migrated.`,
    );
  }

  // Run each concern
  const entries: EvalEntry[] = [];
  for (const concern of concernsFile.concerns) {
    const args: DiagnoseConcernArgs = {
      catalog,
      customer_description: concern.text,
      // All concerns go through the Other Issue path (no chip hint).
      // Matches the picker's 11th pseudo-chip route.
      customer_chip_hint: {
        chip_service_key: "other_issue",
        chip_display_name: "Other issue",
        chip_concern_categories: [],
      },
      vehicle_notes: null,
    };
    const systemPrompt = buildSystemPrompt(args);
    const userPrompt = buildUserPrompt(args);
    const t0 = Date.now();
    process.stdout.write(
      `[${String(concern.id).padStart(2, "0")}/${concernsFile.concerns.length}] "${concern.text.slice(0, 60)}…" `,
    );
    // Per-concern try/catch so a transient Anthropic error on one concern
    // doesn't kill the whole 50-concern run. Failure gets recorded as a
    // synthetic null-match entry with the error in error_message.
    let result: DiagnoseConcernResult;
    try {
      result = await diagnoseConcern(args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        matched_category_key: null,
        matched_kind: null,
        matched_subcategory_slug: null,
        recommended_testing_service: null,
        unanswered_question_ids: [],
        parsed_ok: false,
        model: process.env.DIAGNOSE_CONCERN_MODEL || "claude-haiku-4-5",
        latency_ms: Date.now() - t0,
        tokens_in: 0,
        tokens_out: 0,
        error_message: `eval_threw: ${msg.slice(0, 300)}`,
      };
    }
    const wallMs = Date.now() - t0;
    const routingOutcome = routingOutcomeFor(result);
    console.log(`→ ${routingOutcome} (${wallMs}ms)`);
    entries.push({ concern, systemPrompt, userPrompt, result, routingOutcome, wallMs });
  }

  // Aggregate stats
  const stats = {
    total: entries.length,
    parsed_ok: entries.filter((e) => e.result.parsed_ok).length,
    null_matches: entries.filter((e) => e.result.matched_kind === null).length,
    testing_service_matches: entries.filter(
      (e) => e.result.matched_kind === "testing_service",
    ).length,
    other_subcategory_matches: entries.filter(
      (e) => e.result.matched_kind === "other_subcategory",
    ).length,
    median_latency_ms: median(entries.map((e) => e.wallMs)),
    median_tokens_in: median(entries.map((e) => e.result.tokens_in)),
    median_tokens_out: median(entries.map((e) => e.result.tokens_out)),
    routes: {
      testing_service_approval: entries.filter((e) =>
        e.routingOutcome.startsWith("testing_service_approval"),
      ).length,
      clarification_question: entries.filter((e) =>
        e.routingOutcome.startsWith("clarification_question"),
      ).length,
      forward_to_advisor: entries.filter((e) =>
        e.routingOutcome.startsWith("forward-to-advisor"),
      ).length,
    },
  };

  // Build markdown
  const md = renderMarkdown(entries, stats);
  const outDir = resolve(repoRoot, "docs", "scheduler");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = resolve(outDir, `diagnose-eval-${stamp}.md`);
  writeFileSync(outPath, md, "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(JSON.stringify(stats, null, 2));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}

function renderMarkdown(
  entries: EvalEntry[],
  stats: ReturnType<typeof aggregateForType>,
): string {
  const lines: string[] = [];
  lines.push(`# Diagnose-concern LLM eval — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "Direct eval of `diagnoseConcern` against 50 customer-written concerns (verbatim from yourmechanic.com question slugs). All concerns are routed through the Other Issue pseudo-chip path (no chip hint) — the hardest classification case.",
  );
  lines.push("");
  lines.push("## Summary stats");
  lines.push("");
  lines.push(`- **Total concerns:** ${stats.total}`);
  lines.push(`- **LLM parse-ok rate:** ${stats.parsed_ok}/${stats.total}`);
  lines.push(
    `- **Routing breakdown:** testing_service_approval=${stats.routes.testing_service_approval}, clarification_question=${stats.routes.clarification_question}, forward-to-advisor=${stats.routes.forward_to_advisor}`,
  );
  lines.push(
    `- **Match kind:** testing_service=${stats.testing_service_matches}, other_subcategory=${stats.other_subcategory_matches}, null=${stats.null_matches}`,
  );
  lines.push(
    `- **Median latency:** ${stats.median_latency_ms}ms · **median tokens:** ${stats.median_tokens_in} in / ${stats.median_tokens_out} out`,
  );
  lines.push("");
  lines.push("## Per-concern detail");
  lines.push("");

  for (const e of entries) {
    lines.push(`### Concern ${e.concern.id} — expected category: \`${e.concern.category_expected}\``);
    lines.push("");
    lines.push(`**Source:** ${e.concern.source}`);
    lines.push("");
    lines.push(`**Customer description (verbatim):**`);
    lines.push("");
    lines.push(`> ${e.concern.text}`);
    lines.push("");
    lines.push("**LLM response:**");
    lines.push("");
    lines.push("| field | value |");
    lines.push("|---|---|");
    lines.push(`| matched_category_key | \`${e.result.matched_category_key ?? "null"}\` |`);
    lines.push(`| matched_kind | \`${e.result.matched_kind ?? "null"}\` |`);
    lines.push(`| matched_subcategory_slug | \`${e.result.matched_subcategory_slug ?? "null"}\` |`);
    lines.push(`| recommended_testing_service | \`${e.result.recommended_testing_service?.service_key ?? "—"}\` (${e.result.recommended_testing_service ? fmtPrice(e.result.recommended_testing_service.starting_price_cents) : "—"}) |`);
    lines.push(`| unanswered_question_ids | ${e.result.unanswered_question_ids.length === 0 ? "[]" : `[${e.result.unanswered_question_ids.join(", ")}]`} |`);
    lines.push(`| parsed_ok | ${e.result.parsed_ok} |`);
    lines.push(`| latency_ms | ${e.result.latency_ms} (wall: ${e.wallMs}) |`);
    lines.push(`| tokens | ${e.result.tokens_in} in / ${e.result.tokens_out} out |`);
    lines.push(`| error_message | ${e.result.error_message || "—"} |`);
    lines.push("");
    lines.push(`**Routing outcome:** ${e.routingOutcome}`);
    lines.push("");
    lines.push("<details><summary>User prompt sent to LLM</summary>");
    lines.push("");
    lines.push("```");
    lines.push(e.userPrompt);
    lines.push("```");
    lines.push("");
    lines.push("</details>");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // System prompt appears once at the end — it's the same for every concern
  // (since chip_hint is identical, no per-concern variation).
  lines.push("## System prompt (sent identically for every concern)");
  lines.push("");
  lines.push("```");
  lines.push(entries[0]?.systemPrompt ?? "(no entries)");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

function aggregateForType() {
  // marker for renderMarkdown's type — never called
  return {
    total: 0,
    parsed_ok: 0,
    null_matches: 0,
    testing_service_matches: 0,
    other_subcategory_matches: 0,
    median_latency_ms: 0,
    median_tokens_in: 0,
    median_tokens_out: 0,
    routes: {
      testing_service_approval: 0,
      clarification_question: 0,
      forward_to_advisor: 0,
    },
  };
}

function fmtPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});

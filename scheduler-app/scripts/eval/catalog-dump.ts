/**
 * catalog-dump — snapshot the LIVE diagnostic catalog through the exact
 * lens the LLM sees (loadDiagnosticCatalog), plus the 29 Stage-3 fact-slot
 * schema. Phase A (llm-launch-gate plan, 2026-07-02) step A1.
 *
 * The snapshot grounds:
 *   - eval-fixture authoring (category keys / subcategory slugs / question
 *     ids + required_facts must reference REAL catalog rows)
 *   - the auto-grader (validates expected labels against the same snapshot)
 *   - the required_facts backfill mapping (per-question text + options)
 *
 * Run (from scheduler-app/):
 *   node --experimental-strip-types scripts/eval/catalog-dump.ts
 *
 * Reads .env.local for Supabase URL + service key (same resolvers the app
 * uses). Writes scripts/eval/catalog-snapshot.json (committed — the eval
 * report records which snapshot it graded against).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, "..", "..");

// Minimal .env.local loader — only fills vars not already set.
function loadEnvLocal(): void {
  const p = resolve(appRoot, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1] as string;
    if (process.env[key] !== undefined) continue;
    let v = (m[2] as string).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[key] = v;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const { createClient } = await import("@supabase/supabase-js");
  const { loadDiagnosticCatalog } = await import(
    "../../src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts"
  );
  const { EXTRACTED_FACTS_JSON_SCHEMA } = await import(
    "../../src/lib/scheduler/wizard/llm/extracted-facts.ts"
  );
  const { resolveServiceRoleKey, resolveSupabaseUrl } = await import(
    "../../src/lib/supabase/resolve-keys.ts"
  );

  const url = resolveSupabaseUrl(process.env);
  const key = resolveServiceRoleKey(process.env);
  if (!url || !key) {
    throw new Error("Missing Supabase URL or service key (see .env.local).");
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const catalog = await loadDiagnosticCatalog(supabase);

  let subcatCount = 0;
  let questionCount = 0;
  let emptyRequiredFacts = 0;
  for (const c of catalog.categories) {
    if (c.kind === "testing_service") {
      subcatCount += c.subcategories.length;
      for (const s of c.subcategories) {
        questionCount += s.questions.length;
        for (const q of s.questions) {
          if (!q.required_facts || q.required_facts.length === 0) {
            emptyRequiredFacts += 1;
          }
        }
      }
    } else {
      questionCount += c.questions.length;
      for (const q of c.questions) {
        if (!q.required_facts || q.required_facts.length === 0) {
          emptyRequiredFacts += 1;
        }
      }
    }
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    counts: {
      categories: catalog.categories.length,
      testing_services: catalog.categories.filter(
        (c) => c.kind === "testing_service",
      ).length,
      other_subcategories: catalog.categories.filter(
        (c) => c.kind === "other_subcategory",
      ).length,
      wizard_visible_subcategories: subcatCount,
      wizard_visible_questions: questionCount,
      wizard_visible_questions_empty_required_facts: emptyRequiredFacts,
    },
    fact_slots: EXTRACTED_FACTS_JSON_SCHEMA,
    categories: catalog.categories,
  };

  const outPath = resolve(__dirname, "catalog-snapshot.json");
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `Wrote ${outPath}\n` + JSON.stringify(snapshot.counts, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

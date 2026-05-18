/**
 * generate-concern-md — emit the 14 docs/scheduler/concerns/{cat}/{cat}-concerns.md
 * files from `canonical-concern-catalog.ts`.
 *
 * Run from repo root:
 *   node --experimental-strip-types scheduler-app/scripts/generate-concern-md.ts
 *
 * Output format (verified against the upload_concern_category_md parser at
 * supabase/functions/_shared/scheduler-admin-md.ts):
 *
 *   # {Category Display}
 *
 *   -- {Sub-Category Display} Checklist --
 *   1. {Question text}
 *      - Label1=value1 | Label2=value2 | Not sure=unsure
 *   2. [multi] {Question text}
 *      - Front=front | Rear=rear | ...
 *
 *   ---
 *
 *   Sources consulted:
 *   - (preserved from existing file when found)
 *
 * Key rules:
 *   - `[multi]` prefix on the numbered question line → multi_select=true
 *   - Indented `-` line with `|`-separated entries → options
 *   - `Label=value` form → label + value verbatim (preserves value stability
 *     for past sessions' clarification_questions_answered references)
 *   - The parser tolerates absent `=value` (slugifies the label) but the
 *     generator ALWAYS emits explicit values so canonical state is round-trippable.
 *   - Below the first `---` is metadata (sources etc.); the parser ignores it.
 *     The generator preserves whatever sources block was in the prior file
 *     so we don't lose Chris's citation history.
 *
 * Re-running this script is idempotent — same input TS → same output MDs.
 * If you edit the canonical TS file, re-run to refresh the MDs; the upload
 * tool's content-hash dedupe makes re-uploading the unchanged MDs a no-op.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { CANONICAL_CATALOG } from "./canonical-concern-catalog.ts";

const REPO_ROOT = resolve(import.meta.dirname!, "../..");

function fmtOptions(
  options: Array<{ label: string; value: string }>,
): string {
  return options.map((o) => `${o.label}=${o.value}`).join(" | ");
}

function extractSourcesBlock(existing: string | null): string {
  if (!existing) return "";
  const hrIdx = existing.search(/\n---\s*\n/);
  if (hrIdx < 0) return "";
  return existing.slice(hrIdx);
}

function categoryDisplayLabel(slug: string): string {
  // Use the same casing the source MDs used (verified by reading the old
  // versions): brakes → "Brakes", warning_light → "Warning Light", etc.
  return slug
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

let wrote = 0;
for (const cat of CANONICAL_CATALOG) {
  const catSlug = cat.category;
  const mdPath = resolve(
    REPO_ROOT,
    `docs/scheduler/concerns/${catSlug}/${catSlug}-concerns.md`,
  );

  // Preserve any sources block from the prior file (citation history).
  const prior = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : null;
  const sourcesBlock = extractSourcesBlock(prior);

  const lines: string[] = [];
  lines.push(`# ${categoryDisplayLabel(catSlug)}`);
  lines.push("");

  for (const sub of cat.subcategories) {
    lines.push(`-- ${sub.display_label} Checklist --`);
    let order = 1;
    for (const q of sub.questions) {
      const prefix = q.multi_select ? "[multi] " : "";
      lines.push(`${order}. ${prefix}${q.text}`);
      lines.push(`   - ${fmtOptions(q.options)}`);
      order += 1;
    }
    lines.push("");
  }

  // Strip the trailing blank line we just added and append sources.
  while (lines[lines.length - 1] === "") lines.pop();

  if (sourcesBlock) {
    lines.push("");
    lines.push(sourcesBlock.replace(/^\s*\n+/, "").trimEnd());
    lines.push("");
  } else {
    lines.push("");
  }

  const content = lines.join("\n");
  writeFileSync(mdPath, content, "utf8");
  wrote += 1;
  // eslint-disable-next-line no-console
  console.log(
    `wrote ${catSlug.padEnd(15)} (${cat.subcategories.length} subs / ${cat.subcategories.reduce((s, x) => s + x.questions.length, 0)} questions)`,
  );
}
// eslint-disable-next-line no-console
console.log(`\n✓ Regenerated ${wrote} concern MDs from canonical-concern-catalog.ts`);

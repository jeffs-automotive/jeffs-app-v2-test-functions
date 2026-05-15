#!/usr/bin/env node
/**
 * Seed: parses the 14 concern checklist MD docs from
 *   .claude/work/planning/references/concerns/{slug}/{slug}-concerns.md
 * and upserts them into the concern_subcategories + concern_questions tables.
 *
 * Re-implements the parser + upsert logic from
 *   supabase/functions/_shared/scheduler-admin-md.ts:parseConcernCategoryMd
 *   supabase/functions/_shared/tools/scheduler-admin.ts:uploadConcernCategoryMd
 * inline so this script runs as plain Node (no Deno + no Edge-Function call).
 *
 * Idempotent — re-running upserts based on (shop_id, category, subcategory_slug)
 * and (subcategory_id, question_text). Soft-deletes (active=false) any
 * sub-category OR question that's no longer in the MD.
 *
 * Usage (from project root):
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-secret> \
 *   node scripts/seed-concern-docs.mjs
 *
 * Optional env:
 *   SHOP_ID=7476 (default: 7476 — Jeff's Automotive)
 *   SEED_USER_NAME="Chris (seed)" — audit "updated_by_name" stamp
 *   SEED_USER_OAUTH_ID="seed-script" — audit "updated_by_oauth_client_id" stamp
 *
 * Prerequisite: migration 20260514100000_scheduler_concern_subcategories_and_keywords.sql
 * must already be applied to the target DB (creates the concern_subcategories
 * table + concern_questions.subcategory_id FK).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SHOP_ID = parseInt(process.env.SHOP_ID || "7476", 10);
const SEED_USER_NAME = process.env.SEED_USER_NAME || "seed-script";
const SEED_USER_OAUTH_ID =
  process.env.SEED_USER_OAUTH_ID || "scripts/seed-concern-docs.mjs";

const CATEGORY_SLUGS = [
  "noise",
  "vibration",
  "pulling",
  "smell",
  "smoke",
  "leak",
  "warning_light",
  "performance",
  "electrical",
  "hvac",
  "brakes",
  "steering",
  "tires",
  "other",
];

const DEFAULT_OPTIONS = [
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
  { label: "Sometimes / Not sure", value: "sometimes" },
];

// ─── Parser (mirror of parseConcernCategoryMd in scheduler-admin-md.ts) ─────

function slugifyForConcernSubcategory(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function parseConcernCategoryMd(content) {
  const allLines = content.split(/\r?\n/);
  const hrIndex = allLines.findIndex((l) => /^---\s*$/.test(l.trim()));
  const bodyLines = hrIndex >= 0 ? allLines.slice(0, hrIndex) : allLines;

  let displayLabel = null;
  let i = 0;
  for (; i < bodyLines.length; i++) {
    const line = (bodyLines[i] ?? "").trim();
    if (line === "") continue;
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (!h1) {
      throw new Error(
        `expected H1 ('# Category Name') as first non-blank line, got "${line.slice(0, 80)}"`,
      );
    }
    displayLabel = h1[1].trim();
    i++;
    break;
  }
  if (!displayLabel) throw new Error("missing H1 category label");

  const SUB_HEADER = /^--\s+(.+?)\s+Checklist\s+--\s*$/;
  const NUMBERED = /^(\d+)\.\s+(.+?)\s*$/;

  const subcategories = [];
  let currentSub = null;
  let nextQuestionOrder = 1;

  for (; i < bodyLines.length; i++) {
    const raw = bodyLines[i] ?? "";
    const line = raw.trim();
    if (line === "") continue;

    const subMatch = line.match(SUB_HEADER);
    if (subMatch) {
      if (currentSub && currentSub.questions.length === 0) {
        throw new Error(
          `sub-category "${currentSub.display_label}" has no questions`,
        );
      }
      const subLabel = subMatch[1].trim();
      if (!subLabel) throw new Error(`empty sub-category name`);
      currentSub = {
        slug: slugifyForConcernSubcategory(subLabel),
        display_label: subLabel,
        display_order: subcategories.length + 1,
        questions: [],
      };
      subcategories.push(currentSub);
      nextQuestionOrder = 1;
      continue;
    }

    const numMatch = line.match(NUMBERED);
    if (numMatch) {
      if (!currentSub) {
        throw new Error(
          `numbered line before any '-- ... Checklist --' header: "${line.slice(0, 80)}"`,
        );
      }
      currentSub.questions.push({
        question_text: numMatch[2].trim(),
        display_order: nextQuestionOrder++,
      });
      continue;
    }

    // Continuation line — append to prior question
    if (currentSub && currentSub.questions.length > 0) {
      const last = currentSub.questions[currentSub.questions.length - 1];
      last.question_text = `${last.question_text} ${line}`;
    }
  }

  if (subcategories.length === 0) throw new Error("no sub-categories found");
  if (currentSub && currentSub.questions.length === 0) {
    throw new Error(`sub-category "${currentSub.display_label}" has no questions`);
  }
  return { display_label: displayLabel, subcategories };
}

// ─── Upsert (mirror of uploadConcernCategoryMd in tools/scheduler-admin.ts) ─

async function upsertConcernCategory(supabase, categorySlug, parsed) {
  const nowIso = new Date().toISOString();
  let subAdded = 0,
    subModified = 0,
    subDeactivated = 0;
  let qAdded = 0,
    qModified = 0,
    qDeactivated = 0;

  // Fetch current state
  const { data: subRows, error: subErr } = await supabase
    .from("concern_subcategories")
    .select("id, slug, display_label, display_order, active")
    .eq("shop_id", SHOP_ID)
    .eq("category", categorySlug);
  if (subErr) throw new Error(`subcategories fetch failed: ${subErr.message}`);

  const { data: qRows, error: qErr } = await supabase
    .from("concern_questions")
    .select("id, subcategory_id, question_text, display_order, active")
    .eq("shop_id", SHOP_ID)
    .eq("category", categorySlug);
  if (qErr) throw new Error(`questions fetch failed: ${qErr.message}`);

  const currentSubs = subRows ?? [];
  const currentQuestions = qRows ?? [];
  const currentSubBySlug = new Map(currentSubs.map((s) => [s.slug, s]));
  const mdSubBySlug = new Map();
  parsed.subcategories.forEach((s) => mdSubBySlug.set(s.slug, s));

  const subIdBySlug = new Map();

  // Upsert subcategories
  for (const mdSub of parsed.subcategories) {
    const existing = currentSubBySlug.get(mdSub.slug);
    if (existing) {
      const needsUpdate =
        existing.display_label !== mdSub.display_label ||
        existing.display_order !== mdSub.display_order ||
        existing.active !== true;
      if (needsUpdate) {
        const { error } = await supabase
          .from("concern_subcategories")
          .update({
            display_label: mdSub.display_label,
            display_order: mdSub.display_order,
            active: true,
            updated_at: nowIso,
            updated_by_oauth_client_id: SEED_USER_OAUTH_ID,
            updated_by_name: SEED_USER_NAME,
          })
          .eq("id", existing.id);
        if (error) throw new Error(`sub update failed: ${error.message}`);
        subModified++;
      }
      subIdBySlug.set(mdSub.slug, existing.id);
    } else {
      const { data, error } = await supabase
        .from("concern_subcategories")
        .insert({
          shop_id: SHOP_ID,
          category: categorySlug,
          slug: mdSub.slug,
          display_label: mdSub.display_label,
          display_order: mdSub.display_order,
          active: true,
          updated_by_oauth_client_id: SEED_USER_OAUTH_ID,
          updated_by_name: SEED_USER_NAME,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`sub insert failed: ${error?.message ?? "no id"}`);
      }
      subIdBySlug.set(mdSub.slug, data.id);
      subAdded++;
    }
  }

  // Soft-delete sub-categories absent from MD
  for (const existing of currentSubs) {
    if (!mdSubBySlug.has(existing.slug) && existing.active) {
      const { error } = await supabase
        .from("concern_subcategories")
        .update({
          active: false,
          updated_at: nowIso,
          updated_by_oauth_client_id: SEED_USER_OAUTH_ID,
          updated_by_name: SEED_USER_NAME,
        })
        .eq("id", existing.id);
      if (!error) subDeactivated++;
    }
  }

  // Upsert questions
  const currentByKey = new Map();
  currentQuestions.forEach((q) => {
    if (q.subcategory_id !== null) {
      currentByKey.set(`${q.subcategory_id}::${q.question_text}`, q);
    }
  });

  const seenQuestionIds = new Set();
  for (const mdSub of parsed.subcategories) {
    const subId = subIdBySlug.get(mdSub.slug);
    if (subId === undefined) continue;
    for (const q of mdSub.questions) {
      const key = `${subId}::${q.question_text}`;
      const existing = currentByKey.get(key);
      if (existing) {
        seenQuestionIds.add(existing.id);
        const needsUpdate =
          existing.display_order !== q.display_order || existing.active !== true;
        if (needsUpdate) {
          const { error } = await supabase
            .from("concern_questions")
            .update({
              display_order: q.display_order,
              active: true,
              updated_at: nowIso,
              updated_by_oauth_client_id: SEED_USER_OAUTH_ID,
              updated_by_name: SEED_USER_NAME,
            })
            .eq("id", existing.id);
          if (!error) qModified++;
        }
      } else {
        const { error } = await supabase.from("concern_questions").insert({
          shop_id: SHOP_ID,
          category: categorySlug,
          subcategory_id: subId,
          question_text: q.question_text,
          options: DEFAULT_OPTIONS,
          display_order: q.display_order,
          active: true,
          updated_by_oauth_client_id: SEED_USER_OAUTH_ID,
          updated_by_name: SEED_USER_NAME,
        });
        if (!error) qAdded++;
      }
    }
  }

  // Soft-delete questions absent from MD
  for (const q of currentQuestions) {
    if (q.subcategory_id !== null && !seenQuestionIds.has(q.id) && q.active) {
      const { error } = await supabase
        .from("concern_questions")
        .update({
          active: false,
          updated_at: nowIso,
          updated_by_oauth_client_id: SEED_USER_OAUTH_ID,
          updated_by_name: SEED_USER_NAME,
        })
        .eq("id", q.id);
      if (!error) qDeactivated++;
    }
  }

  return {
    subcategories: { added: subAdded, modified: subModified, deactivated: subDeactivated },
    questions: { added: qAdded, modified: qModified, deactivated: qDeactivated },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) env vars.",
    );
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const baseDir = join(__dirname, "..", ".claude", "work", "planning", "references", "concerns");
  console.log(`Seeding from: ${baseDir}`);
  console.log(`Shop: ${SHOP_ID}\n`);

  let totalSubcats = 0;
  let totalQuestions = 0;
  const skipped = [];
  const errors = [];

  for (const slug of CATEGORY_SLUGS) {
    const file = join(baseDir, slug, `${slug}-concerns.md`);
    if (!existsSync(file)) {
      skipped.push({ slug, reason: `file not found at ${file}` });
      continue;
    }
    const content = readFileSync(file, "utf-8");
    let parsed;
    try {
      parsed = parseConcernCategoryMd(content);
    } catch (e) {
      errors.push({ slug, stage: "parse", message: e.message });
      continue;
    }
    try {
      const result = await upsertConcernCategory(supabase, slug, parsed);
      totalSubcats += result.subcategories.added + result.subcategories.modified;
      totalQuestions += result.questions.added + result.questions.modified;
      console.log(
        `  ${slug}: sub ${result.subcategories.added}+ ${result.subcategories.modified}~ ${result.subcategories.deactivated}- | q ${result.questions.added}+ ${result.questions.modified}~ ${result.questions.deactivated}-`,
      );
    } catch (e) {
      errors.push({ slug, stage: "upsert", message: e.message });
    }
  }

  console.log("\n─── Summary ───");
  console.log(
    `Categories processed: ${CATEGORY_SLUGS.length - skipped.length}/${CATEGORY_SLUGS.length}`,
  );
  console.log(`Sub-categories touched: ${totalSubcats}`);
  console.log(`Questions touched: ${totalQuestions}`);
  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.length}`);
    skipped.forEach((s) => console.log(`  - ${s.slug}: ${s.reason}`));
  }
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    errors.forEach((e) => console.log(`  - ${e.slug} (${e.stage}): ${e.message}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});

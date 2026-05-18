/**
 * generate-catalog-migration — emits the SQL migration that rebuilds
 * `concern_subcategories` + `concern_questions` from the canonical
 * TypeScript catalog at `canonical-concern-catalog.ts`.
 *
 * Run from repo root:
 *   node --experimental-strip-types scheduler-app/scripts/generate-catalog-migration.ts > supabase/migrations/<ts>_scheduler_concern_catalog_canonical_rebuild.sql
 *
 * Migration strategy (preserves IDs for past-session lookups):
 *
 *   1. Add `multi_select` BOOLEAN column to `concern_questions` if missing.
 *   2. Soft-delete EVERY existing concern_subcategory + concern_question
 *      for shop 7476. This is the clean slate — non-canonical legacy rows
 *      stay in the table as `active=false` so historical
 *      `clarification_questions_answered[id]` lookups still resolve.
 *   3. UPSERT canonical subcategories by `(shop_id, category, slug)`. Existing
 *      matching rows get re-activated (active=TRUE) + their display_label /
 *      display_order updated; new rows get inserted. IDs preserved.
 *   4. UPSERT canonical questions by `(shop_id, subcategory_id, question_text)`.
 *      Existing matching rows get re-activated, options + multi_select set;
 *      new rows get inserted with the new shape. IDs preserved where text
 *      matches.
 *   5. Sanity-check: count canonical questions inserted ≥ 700.
 *
 * Step 2 ensures any duplicate-subcategory rows (apostrophe-stripped vs
 * not) AND any typo'd questions from earlier seed waves end up inactive
 * without losing their primary keys.
 */

import { CANONICAL_CATALOG } from "./canonical-concern-catalog.ts";

const SHOP_ID = 7476;
const NOW_PLACEHOLDER = "now()";

function sqlString(s: string): string {
  // Postgres single-quote string with doubled inner quotes
  return `'${s.replace(/'/g, "''")}'`;
}

function sqlJson(obj: unknown): string {
  return `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
}

function sqlBool(b: boolean): string {
  return b ? "TRUE" : "FALSE";
}

function emitHeader(): string {
  const subCount = CANONICAL_CATALOG.reduce(
    (n, c) => n + c.subcategories.length,
    0,
  );
  const qCount = CANONICAL_CATALOG.reduce(
    (n, c) =>
      n + c.subcategories.reduce((m, s) => m + s.questions.length, 0),
    0,
  );
  const multiCount = CANONICAL_CATALOG.reduce(
    (n, c) =>
      n +
      c.subcategories.reduce(
        (m, s) => m + s.questions.filter((q) => q.multi_select).length,
        0,
      ),
    0,
  );

  return `-- =====================================================================
-- Scheduler concern catalog — canonical rebuild (CAT-2 resolution)
-- =====================================================================
-- Date: 2026-05-18 (later)
-- Source-of-truth: scheduler-app/scripts/canonical-concern-catalog.ts
-- Generator: scheduler-app/scripts/generate-catalog-migration.ts
--
-- Background:
--
-- The original concern_subcategories + concern_questions seed wave
-- (2026-05-15) wrote heuristic-only answer options — most questions got
-- [Yes/No/Sometimes] regardless of whether the question's natural answer
-- shape was a location ("Front or rear? Left or right?"), an onset
-- ("Suddenly or gradually?"), a speed band, an enumerated alternate,
-- etc. The follow-up brakes + part1/part2 migrations (2026-05-16)
-- tried to fix this via ON CONFLICT (shop_id, subcategory_id,
-- question_text) DO NOTHING but only landed where the canonical text
-- was UNIQUE — every typo-corrected duplicate was orphaned.
--
-- Direct DB audit on 2026-05-18 found 740/913 active questions with
-- generic yes/no/sometimes options including questions like:
--   "Does the sound feel like it is coming from the front or rear?
--    Left or right side?"
-- that need [Front/Rear/Left/Right/All four/Not sure] with multi-select.
--
-- This migration:
--   1. Adds \`multi_select\` BOOLEAN column to concern_questions
--   2. Soft-deletes every existing shop=7476 subcategory + question
--   3. UPSERTs ${subCount} canonical subcategories from the TS source-of-truth
--   4. UPSERTs ${qCount} canonical questions with proper options + multi_select
--      (${multiCount} multi-select; ${qCount - multiCount} single-select)
--
-- Past sessions' \`clarification_questions_answered[id]\` JSONB still
-- resolves because legacy rows stay in the table as active=false.
-- Future wizards see only the canonical set.
--
-- Idempotent: re-running this migration UPSERTs by the natural keys
-- (shop_id, category, slug) for subcategories and
-- (shop_id, subcategory_id, question_text) for questions. The
-- soft-delete in step 2 is the reset; the UPSERTs re-activate
-- everything in the canonical set.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Add multi_select column (idempotent)
-- ---------------------------------------------------------------------

ALTER TABLE public.concern_questions
  ADD COLUMN IF NOT EXISTS multi_select BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.concern_questions.multi_select IS
  'TRUE when the customer can naturally pick multiple options simultaneously (e.g., location questions where rear + left both apply). The clarification card renders multi-select chips + a Continue button when true, otherwise single-tap-to-submit. Set per canonical-concern-catalog.ts.';

-- ---------------------------------------------------------------------
-- 2. Clean slate: soft-delete every existing shop=${SHOP_ID} row
-- ---------------------------------------------------------------------

UPDATE public.concern_questions
   SET active = FALSE, updated_at = ${NOW_PLACEHOLDER}
 WHERE shop_id = ${SHOP_ID} AND active = TRUE;

UPDATE public.concern_subcategories
   SET active = FALSE, updated_at = ${NOW_PLACEHOLDER}
 WHERE shop_id = ${SHOP_ID} AND active = TRUE;

`;
}

function emitSubcategoryUpserts(): string {
  const rows: string[] = [];
  for (const cat of CANONICAL_CATALOG) {
    for (const sub of cat.subcategories) {
      rows.push(
        `  (${SHOP_ID}, ${sqlString(cat.category)}, ${sqlString(sub.slug)}, ${sqlString(sub.display_label)}, ${sub.display_order}, TRUE)`,
      );
    }
  }
  return `-- ---------------------------------------------------------------------
-- 3. UPSERT canonical subcategories
-- ---------------------------------------------------------------------

INSERT INTO public.concern_subcategories
  (shop_id, category, slug, display_label, display_order, active)
VALUES
${rows.join(",\n")}
ON CONFLICT (shop_id, category, slug) DO UPDATE SET
  display_label = EXCLUDED.display_label,
  display_order = EXCLUDED.display_order,
  active = TRUE,
  updated_at = ${NOW_PLACEHOLDER};

`;
}

function emitQuestionUpserts(): string {
  const rows: string[] = [];
  for (const cat of CANONICAL_CATALOG) {
    for (const sub of cat.subcategories) {
      let order = 1;
      for (const q of sub.questions) {
        rows.push(
          `  (${sqlString(cat.category)}, ${sqlString(sub.slug)}, ${sqlString(q.text)}, ${sqlJson(q.options)}, ${order}, ${sqlBool(q.multi_select)})`,
        );
        order += 1;
      }
    }
  }
  return `-- ---------------------------------------------------------------------
-- 4. UPSERT canonical questions
-- ---------------------------------------------------------------------
--
-- Joins to concern_subcategories on (shop_id, category, slug) to
-- resolve the subcategory_id at insert time. The unique-key on
-- (shop_id, subcategory_id, question_text) keeps existing rows whose
-- text matches the canonical set — only options + multi_select are
-- rewritten.

WITH canonical_q (category, sub_slug, question_text, options_json, display_order, multi_select) AS (
  VALUES
${rows.join(",\n")}
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active, multi_select)
SELECT
  ${SHOP_ID},
  cq.category,
  cs.id,
  cq.question_text,
  cq.options_json::jsonb,
  cq.display_order,
  TRUE,
  cq.multi_select
FROM canonical_q cq
JOIN public.concern_subcategories cs
  ON cs.shop_id = ${SHOP_ID}
  AND cs.category = cq.category
  AND cs.slug = cq.sub_slug
ON CONFLICT (shop_id, subcategory_id, question_text) DO UPDATE SET
  options = EXCLUDED.options,
  display_order = EXCLUDED.display_order,
  multi_select = EXCLUDED.multi_select,
  active = TRUE,
  updated_at = ${NOW_PLACEHOLDER};

`;
}

function emitVerification(): string {
  const totalQ = CANONICAL_CATALOG.reduce(
    (n, c) =>
      n + c.subcategories.reduce((m, s) => m + s.questions.length, 0),
    0,
  );
  const totalSub = CANONICAL_CATALOG.reduce(
    (n, c) => n + c.subcategories.length,
    0,
  );

  return `-- ---------------------------------------------------------------------
-- 5. Sanity check — counts match the canonical TS source
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_sub_count INT;
  v_q_count INT;
  v_multi_count INT;
BEGIN
  SELECT COUNT(*) INTO v_sub_count
    FROM public.concern_subcategories
   WHERE shop_id = ${SHOP_ID} AND active = TRUE;
  IF v_sub_count < ${totalSub} THEN
    RAISE EXCEPTION 'concern_subcategories active count % is less than canonical % — rebuild incomplete', v_sub_count, ${totalSub};
  END IF;

  SELECT COUNT(*) INTO v_q_count
    FROM public.concern_questions
   WHERE shop_id = ${SHOP_ID} AND active = TRUE;
  IF v_q_count < ${totalQ} THEN
    RAISE EXCEPTION 'concern_questions active count % is less than canonical % — rebuild incomplete', v_q_count, ${totalQ};
  END IF;

  SELECT COUNT(*) INTO v_multi_count
    FROM public.concern_questions
   WHERE shop_id = ${SHOP_ID} AND active = TRUE AND multi_select = TRUE;
  IF v_multi_count = 0 THEN
    RAISE EXCEPTION 'no multi_select questions found — multi_select column not populated';
  END IF;

  RAISE NOTICE 'canonical rebuild OK: % subcategories, % questions (% multi-select)', v_sub_count, v_q_count, v_multi_count;
END $$;

COMMIT;

-- ---------------------------------------------------------------------
-- Post-deploy verification (Chris runs after \`supabase db push\`)
-- ---------------------------------------------------------------------
--
-- Count active canonical subcategories per category (expect ${totalSub} total):
--   SELECT category, COUNT(*) FROM concern_subcategories
--    WHERE shop_id = ${SHOP_ID} AND active = TRUE
--    GROUP BY category ORDER BY category;
--
-- Count active canonical questions (expect ${totalQ} total, ≥ 42 multi-select):
--   SELECT COUNT(*) FILTER (WHERE multi_select), COUNT(*)
--     FROM concern_questions
--    WHERE shop_id = ${SHOP_ID} AND active = TRUE;
--
-- Verify the two specific questions Chris reported now have proper options:
--   SELECT id, question_text, options, multi_select
--     FROM concern_questions
--    WHERE shop_id = ${SHOP_ID} AND active = TRUE
--      AND question_text ILIKE '%front or rear%';
--
-- Should return rows with options like [Front, Rear, Left side, Right side,
-- All four wheels, Not sure] and multi_select = TRUE.
`;
}

const sql =
  emitHeader() +
  emitSubcategoryUpserts() +
  emitQuestionUpserts() +
  emitVerification();

process.stdout.write(sql);

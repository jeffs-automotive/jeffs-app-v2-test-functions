# Scheduler classifier retraining — apply the automotive KB (Phase 5)

> **Feature:** `kb-retraining`. Applies the `docs/automotive-knowledge-base/` proposals to the live
> (sandbox) `diagnose-concern` classifier, **measured against the 272-case golden set**, shipping only
> what improves the metrics with no regression. Backend / data / prompt only — **no customer-facing UI**.
> Started 2026-07-19. Supersedes the optimistic sequencing in `FINDINGS-AND-RECOMMENDATIONS.md` with what
> the detailed binding docs + a live baseline actually show.

## Why

Chris asked (2026-07-18) to research every car system, build an expert KB, and **retrain the scheduler
LLM**. The KB shipped ([[automotive-knowledge-base]]). This is the apply/measure pass.

## What the live baseline actually shows (2026-07-19, this environment)

Establishing the baseline surfaced findings that **reshape the KB's advertised priorities**:

1. **The eval was dead in this environment** — `AI_GATEWAY_API_KEY` is absent and the `.env.local`
   `VERCEL_OIDC_TOKEN` was stale → every LLM call 401'd → 144/145 parse-fails. **Fixed** by injecting a
   fresh `VERCEL_OIDC_TOKEN` from `vercel env pull` (the Anthropic client is hardcoded to the Vercel AI
   Gateway baseURL with `apiKey: AI_GATEWAY_API_KEY ?? VERCEL_OIDC_TOKEN`). Every eval run in this repo
   must inject a fresh OIDC token; it expires.
2. **Stage-1 accuracy is ~56–58%** on BOTH the 145 fixture and the 272 golden set, on BOTH
   gemini-3.1-flash-lite (the current default) and haiku-4-5 — far below the §11 0.90 bar and the
   committed 2026-07-02 baseline of **88.97%**. Stage-2 (on S1-correct) is healthy at ~95–100%.
   → **The dominant problem is Stage-1 routing, not over-ask.** This is what the vocabulary enrichment
   (keywords / examples / synonyms / hedges) is designed to fix. Flag to Chris: this may also be a
   real regression (catalog grew 20→31 categories; the S1 model was switched to gemini-flash-lite on
   2026-07-03) worth diagnosing independently.
3. **The value-aware mapper is NOT the ready quick-win the FINDINGS summary implied.** The detailed
   `binding/required-facts-map.md` classifies the 79 PARTIALs and marks **almost all "leave empty"** even
   with a value-aware mapper (they are OR-logic / compound / no-slot / new-symptom-discovery probes). Only
   **2** questions are SAFE (q645 `warning_light_named`, q104 `location_axle`) and those are plain
   presence-based. So the value-aware mapper is a worthwhile **enabler** but ships with ~2 tags — the
   per-PARTIAL `slot=any_of` derivation was punted by the KB and is out of scope here.

**Consequence:** priority is **vocabulary enrichment (Stage-1/2) first**, then the fact-extraction slots
(Stage-3), with the value-aware mapper as a low-risk enabler. Over-ask is a secondary lever here.

## Locked decisions

- **Measurement target = the 272-case golden set** (`docs/automotive-knowledge-base/datasets/golden-cases.json`),
  authored against the *current* taxonomy (all 272 validate; 5 cross-attachment cases get `stage2` nulled
  in a measurement copy `scheduler-app/scripts/eval/golden-272-measure.json`). The 145 `eval-cases.json` is
  stale vs the grown catalog — kept only as a secondary regression guard.
- **Value-aware encoding = compact DSL `slot=v1|v2` inside the existing `required_facts text[]`** (report:
  mapper-slots). Bare `slot` keeps today's presence-based meaning byte-for-byte. **No migration, no column
  change, no RPC-signature change.** Parser is pure `String.split`.
- **Bulk enrichment apply = one idempotent SQL migration calling the audited SECURITY DEFINER RPCs**
  (`scheduler_admin_*`, actor `kb_retrain_2026_07`) — NOT raw UPDATEs (they skip the audit ledger +
  `updated_at`). New subcategories (gated) would use `INSERT … ON CONFLICT DO NOTHING`. The DB is the
  source of truth; the frozen `scripts/catalog/*` files are historical — do NOT touch them.
- **Ship gate = measured golden-set improvement + no regression + `/code-review` clean.** Guardrails:
  `underAsk` must not rise, Stage-3 precision must not fall (inference-trap subset), 0 confident misroutes.
- **Chris-gated — NOT applied here, prepared + handed off:** the 63 gated ops (27 new subcategories, 12
  new/reworked services, 6 concern_category reachability edits, 3 new questions, 15 slot-proposes that are
  business/label-space), the **9 conflicts with no default** (q1635/303/82/291/1185/516/468/463/600), the
  `vehicle_powertrain` make/model policy, and slot #8 `ride_damping_symptom` scalar-vs-array. New subcats
  also require regenerating the golden set (v2) — out of scope.

## Slices (each measured against the 272 golden set; keep only if it improves + no regression)

| # | Slice | Surface | Ops | Measured by |
|---|---|---|---|---|
| **1** | Value-aware mapper (enabler) + `--fixture` harness flag + golden fixture + 2 SAFE tags | code (`question-fact-mapper.ts`, `run-eval.ts`) + tests | mapper + 2 tags | deterministic unit tests + offline mapper harness ($0) |
| **2** | 11 new fact slots + Stage-3 prompt rubric + value-adds | code (`extracted-facts.ts`, `diagnose-concern.ts`) | 15 slot.value + 11 slots | live eval Stage-3 recall↑, precision guard |
| **3** | Stage-2 enrichment | DB migration via RPCs | 141 pos + 267 neg + 164 syn + 36 desc | live eval Stage-2 acc + confusable subset |
| **4** | Stage-1 keywords | DB migration via RPCs | 207 keywords | live eval Stage-1 acc + per-class F1 |
| **5** | Stage-1 hedges + router tables | Stage-1 **prompt** | 115 hedges | live eval Stage-1 macro-F1, confusables |
| — | 130 `intentionally_empty` | documentation | 130 | no behavior change (record only) |

Slices 3 + 4 are the highest-value given the 56% Stage-1 baseline. Slice 1 is a zero-behavior-change
enabler. Slices are applied + measured **one lever at a time** to isolate causality; re-run after each.

## Apply mechanism (the enrichment applier)

A Node script `scheduler-app/scripts/eval/build-enrichment-migration.mjs` (scripts/ is not phase-gated)
parses `binding/merged-proposals.yaml`, filters to the SAFE deterministically-keyed lanes, and emits an
idempotent migration `supabase/migrations/<ts>_kb_retrain_enrichment.sql` that:
- resolves `concern_subcategories.id` by `(shop_id, category, slug)` and calls
  `scheduler_admin_update_subcategory_enrichment` (append pos/neg/synonyms, revise/append description);
- calls `scheduler_admin_upsert_testing_service` for `example_keywords` append;
- resolves `concern_questions.id` and calls `scheduler_admin_update_question_required_facts` for the 83
  safe required_facts (skips the 5 `NEW:` placeholders + the 12 conflict ids);
- passes `p_expected_updated_at => NULL` (bulk writer), actor `kb_retrain_2026_07`.
Applied with `supabase db push`; verified with `mcp__supabase__list_migrations` + `get_advisors`.

## File-by-file

- `scheduler-app/src/lib/scheduler/wizard/llm/question-fact-mapper.ts` — add `parseRequiredFact` +
  `isRequirementSatisfied`; value-aware buckets; defensive unknown-enum-value warn. Signature unchanged.
- `scheduler-app/src/lib/scheduler/wizard/llm/question-fact-mapper.test.ts` — value-aware cases + parser
  units + the 11-null-slot fixture update + full backward-compat regression.
- `scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts` — +11 slots (Zod + JSON schema +
  required[] + ALL_KEYS) + 15 value-adds.
- `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` — Stage-3 prompt rubric for the new
  slots (literalness cues + worked examples); `renderExtractedFactsSlotList` array handling if slot #8 ships array.
- `scheduler-app/scripts/eval/run-eval.ts` — `--fixture <path>` flag (+ bare-array accept). **Done.**
- `scheduler-app/scripts/eval/golden-272-measure.json` — wrapped 272 fixture, 5 cross-attach nulled. **Done.**
- `scheduler-app/scripts/eval/build-enrichment-migration.mjs` — the applier (new).
- `supabase/migrations/<ts>_kb_retrain_enrichment.sql` — generated enrichment migration.
- Deno mirror (`supabase/functions/llm-testing/*`) — **intentionally NOT synced** (stale, unused by prod +
  eval); header note only.

## Verification

`npm run typecheck` · `npm test` (mapper + slots) · `npm run build` · per-slice `npm run eval:diagnose
--fixture scripts/eval/golden-272-measure.json` (fresh OIDC) diff vs baseline · `/code-review` gate.

## Deploy

Code → `git push origin main` (Vercel auto-deploy, confirm state:READY). DB → `supabase db push` to
sandbox `itzdasxobllfiuolmbxu`. Standing authorization [[always-push-to-prod]] (confirm Vercel READY).

## Baseline (2026-07-19, 272 golden set, gemini-3.1-flash-lite S1/S2 + haiku-4-5 S3)

Recorded in `scheduler-app/scripts/eval/last-run.json` at apply time — the "before" all slices diff against.

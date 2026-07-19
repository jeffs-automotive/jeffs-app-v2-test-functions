# Feature plan — `concern-triage`: establish a category when the classifier can't, + close the unsure-path safety-net holes

> Source: the 2026-07-18 describe-an-issue workflow review
> (`docs/automotive-knowledge-base/workflow-review/SYNTHESIS.md` + `R6` design + `R3`/`R4`), **revised
> 2026-07-18 after a 4-lens Fable plan review** (11 blocking must-fixes + 28 refinements folded in — see
> §9). Goal (Chris): *ask the right questions, get the correct information, and when we can't classify,
> ask MORE questions to establish a category/subcategory — never dead-end.*
>
> **Status: reviewed, ready for `/feature-start`.** The workflow's own plan phase + `/feature-cross-verify`
> still apply on top of this.

---

## 1. Problem

The pipeline asks more questions only when Stage 1 is torn between 2–3 categories (the `concern_clarify`
chip). Every other kind of uncertainty is handled badly: (a) too-vague text (0 candidates) is silently
forwarded to an advisor with **zero** questions; (b) the clarify path itself has **no confidence gate**;
(c) a "Stage 2 can't pick a subcategory" result produces an **ungated fee rec with zero questions**;
(d) small live bugs corrupt/re-book in the post-diagnosis loop. This feature makes the unsure paths do
the right thing.

## 2. Scope

**A. The vague→category triage (Chris's core ask)**
- **A1 `no_match_reason`** on Stage 1 (`non_concern_request | too_vague | no_catalog_fit | null`) — a
  machine-readable reason the candidate list is empty. Only `too_vague`/`no_catalog_fit` are triage-
  eligible; `non_concern_request` keeps today's advisor handoff. (Encoding: INV-6.)
- **A2 `concern_triage` step** — a new wizard step, sibling of `concern_clarify`:
  - **Tier A** (0 candidates, triage-eligible reason, `triage_round === 0`, `parsed_ok`): a broad
    category chip card ("What kind of trouble is it?") — the 13 non-`other` concern categories in
    customer voice + "Something else / not sure" → advisor. On tap → **constrained re-diagnosis**
    (`category_constraint` filters the Stage-1 catalog to the chip's audited service subset; singleton
    subset short-circuits Stage 1 straight to that service's Stage 2). The re-run re-enters the SAME
    downstream graph (1→direct, 2-3→clarify, 0→advisor).
  - **Hard bounds:** one Tier-A round per concern (`triage_round`); "Not sure" → advisor; post-triage
    0-candidate → advisor. Worst case: one triage chip tap, then the normal graph.
  - **Stage-2 uncertainty is NOT triaged** (Chris's decision 2026-07-19): a low-confidence or can't-pick
    Stage-2 → advisor handoff via the confidence gate on both the direct and clarify paths (B1/B2). There
    is NO Tier-B subcategory-chip step — the triage step is Tier-A (category chips) only.
- **A3 `concern_triage_chips` table** — shop-scoped, seeded with **literal, hand-audited** values (R6
  §3.2), audited against the taxonomy §5 confusable matrix (the `concern_categories[]` tags are NOT a
  complete routing partition — e.g. the "Shaking/vibration" chip's subset must explicitly include
  `brake_inspection`). Conventions: INV-9.

**B. Close the clarify-path safety-net holes** (same files as A)
- **B1** Persist per-candidate `stage2_confidence`/`stage3_confidence` into `precomputed`; gate at tap in
  `submit-concern-clarify` (missing → pass, INV-8 back-compat): **S2-low → advisor handoff** (same strip
  as none-of-these); **S3-low → over-ask** (`overAskQuestionIds`) — identical to the direct-path gate.
- **B2** Stage-2 null/unresolvable slug on a testing-service match → **advisor handoff** (Chris's decision
  2026-07-19), NOT a silent ungated fee rec; remove the dead `collectAllCategoryQuestionIds` fallback.
- **B3** Hydrate follow-up questions for a chosen `other_subcategory` clarify candidate (ids already
  persisted; resolution ignores them).
- **B4** Add the `answeredIds`/`queuedIds` guards to the clarify-tap hydration (read the answered map in
  the select).
- **B5** Step-guard `submit-clarification-answer`; make its drained branch **triage-and-clarify-aware**
  (INV-4).

**C. Entry-side no-dead-end**
- **C1** Deterministic no-signal nudge before the LLM call (vocab from the KB lexicon + `example_keywords`;
  NOT a bare min-length — do NOT raise the server to `.min(3)`, which would 400 valid short inputs like
  "AC"/"EV"). The nudge is **CLIENT-side** with a **persisted per-concern nudge-once flag** (a second
  submit of the same text proceeds); the server stays `min(1)`. One nudge, never a hard block.
- **C2** Picker "not sure → pick the closest service" copy → route to "Other Issue"; move the hard-coded
  picker copy into the card-text editor.

**D. Adjacent Tier-0 live bugs** (folded in; see §7 Q1 for the split option)
- **D1** Declined tests re-approved — present only *undecided* recs; symmetric declined write (INV-8).
- **D2** Duplicate `other_issue` summaries clobber — match by item index/identity, not `service_key`.
- **D3** Back-from-loop wipes work — **split data-merge (always) from routing (per INV-7)**.

### OUT of scope (separate passes)

Value-aware `question-fact-mapper.ts` (#16); null-alias enum sentinel fix (#8); retraining Phase 5 (the
~1,232 catalog ops) + question-quality rewrites (#18–#25); the R2-P7 situational-cue-clarify redesign
(deferred — not in-scope work, removed from open decisions); post-category card cap (default: keep
asking all).

---

## 3. Correctness invariants (from the Fable plan review — ALL are must-implement)

**INV-1 — RPC allowlist.** `apply_wizard_transition` (called at `transition.ts:115`) is a column allowlist
that **silently ignores** payload keys with no CASE arm. The migration MUST recreate the RPC from its
latest full definition (`supabase/migrations/20260703080000_scheduler_concern_clarify_column.sql`, NOT the
older `20260525000000`) adding a `concern_triage_state` arm using the explicit-JSONB-null-clears pattern,
`SECURITY INVOKER`, `SET search_path=''`. Without this, every triage write no-ops and the card never
renders. Mirror-test it.

**INV-2 — Queue carry-forward.** Today `run-diagnostics.ts:970` rebuilds `concern_clarify_candidates` from
scratch and skipped concerns yield `clarify:null` — safe only because no re-run fires while a clarify queue
is pending. Tier-A tap re-entry breaks that. Fix: on any selective re-run, **seed BOTH `clarifyEntries` and
`triageEntries` from the persisted columns for skipped concerns** (mirror the `existingPending`/
`existingRecs` seeding at `:534-539`/`:769-777`), so a re-run never wipes another concern's pending
clarify/triage entry. Clear both columns on the empty-items branch and on a genuine fresh picker submit
(`submit-service-and-concern-picker.ts` today resets pending/answered/recs but NOT the clarify column —
add clarify + triage to that reset). Decide + document whether `submit-start-over` also resets them
(today it doesn't reset clarify either — pre-existing gap).

**INV-3 — Field preservation on round-trip.** `triage_round`, `triage_answers`, `handoff_reason` must
survive every parser + write-back of `explanation_required_items`: `run-diagnostics` (`parseExplanationItems`
+ the `base` write-back), `submit-concern-clarify`, `ensure-concern-summaries`, `submit-second-routine-pass`,
and the new `submit-concern-triage`. Otherwise the re-run's own read drops `triage_answers` (constraint
never passed → constrained re-diagnosis silently degrades to a full unconstrained re-run = feature no-ops)
and drops `triage_round` (one-round cap resettable). Add a round-trip-preservation Vitest.

**INV-4 — Routing priority `triage > clarify > routeAfterDiagnostics` at ALL FIVE sites:** (1)
`run-diagnostics` fresh persist (`:908-914`); (2) `run-diagnostics` idempotent early-exit (`:466-488`) —
must check the triage queue first or a loading-card re-mount orphans it; (3) `submit-concern-triage`
(Tier-A) resets `diagnostic_processing_complete` and re-runs `run-diagnostics`, so priority is asserted by
sites (1)/(2) on the re-run — but its OWN transition (before the re-run) must still route
remaining-triage > pending-clarify so a mixed multi-concern session is not orphaned; (4)
`submit-concern-clarify` pop-route (`:507-516`); (5) `submit-clarification-answer` drained + normal routing
(the B5 rewrite must be triage-aware too).

**INV-5 — Exact trigger predicate + the Stage-2 decision (Chris confirmed 2026-07-19: advisor).**
- **T1 (Tier A) — the ONLY triage trigger:** `stage1_candidates.length === 0 && no_match_reason ∈
  {too_vague, no_catalog_fit} && (triage_round ?? 0) === 0 && parsed_ok`. Never for `non_concern_request`,
  the all-invalid-keys null-match (`diagnose-concern.ts:1683-1689`), the `desc<3` short-circuit
  (`:1628-1631`), an LLM failure, or `triage_round ≥ 1`.
- **No Tier B.** Stage-2 uncertainty routes to the advisor: on the direct path the existing confidence
  gate already does S2-low → strip → advisor; the clarify path adds it (B1); a genuinely null/unresolvable
  slug on a testing-service match → advisor (B2). **Stage-2 transport FAILURE keeps today's
  recommend-without-questions degrade** (`diagnose-concern.ts:1463-1476`) — a separate pre-existing path,
  unchanged.

**INV-6 — `no_match_reason` encoding (RESOLVED per the v2 review — nullable string, not a strict enum).**
The STAGE1 schema is sent to BOTH transports (Anthropic native for `anthropic/*` models AND `generateObject`
for the Stage-1 default `google/gemini-3.1-flash-lite`). The Anthropic-safe nullable-enum form (`enum:
[…,null]`, `type` OMITTED) can be REJECTED by the gemini/gateway JSON-schema parser. So encode
`no_match_reason` as a **constraint-light nullable string** — `type: ["string","null"]` with the three
allowed values documented in the `description` (the repo's existing philosophy for `warning_light_named`),
NOT a strict schema enum. Post-LLM **Zod** (`z.enum([...]).nullable()`) enforces it is one of the 3 or null
as defense-in-depth; an out-of-set/parse value defaults to `null` (safe handoff). In root `required`. The
two non-LLM null-match producers carry `null` reason and never triage.
**Deno mirror:** update `supabase/functions/llm-testing/stage-schemas.ts` STAGE1 schema in the same commit
(it's already drifted pre-act-or-ask) OR explicitly declare it stale + fix the `scheduler_system_architecture.md`
"mirrors 1:1" claim. **RESOLVED (plan phase): update the mirror `stage-schemas.ts` STAGE1 in the SAME
commit** (it is already drifted pre-act-or-ask — catch it up to the app schema incl. `no_match_reason`).
The app schema stays authoritative for eval; see INV-11 for the CI-runner reconciliation.

**INV-7 — D3 split merge from routing.** `applyMerge` (data preservation) applies on EVERY resubmit;
**routing** stays: `fromHub` → `summary_edit_hub` (existing bubbles); non-hub resubmit → forward
(`concern_explanation` if an unexplained item exists, else the idempotent diagnostics re-route /
`appointment_type`). A genuinely-fresh simple-only pick keeps today's path (must NOT land on
`summary_edit_hub`). Define the bubble text per path.

**INV-8 — D1 approval-card + back-compat.** Pass the **undecided** count (`recommended − approved −
declined`) to `routeAfterDiagnostics` at all three call sites (keeps §8's "routeAfterDiagnostics unchanged"
— it's an input change); skip the approval card when undecided is 0; `finalDeclined = (existingDeclined ∪
newDeclined) − finalApproved`. B1 parser default: MISSING per-candidate confidence → pass (never gate) so
in-flight sessions at deploy aren't advisor-stripped.

**INV-9 — Migration conventions (scheduler family, not the generic UUID-FK anchor).**
`concern_triage_chips`: `shop_id INTEGER NOT NULL CHECK (shop_id > 0)` (Tekmetric integer shop id, per
`concern_subcategories`/`scheduler_card_text`), UUID PK `gen_random_uuid()`, TIMESTAMPTZ
`created_at`/`updated_at`, TEXT columns, `sort` (not `display_order`), `UNIQUE (shop_id, chip_key)`, enable
RLS + revoke from public/anon/authenticated (deny-all; service-role via RLS bypass), idempotent seed
(`ON CONFLICT`), **literal audited seed values** (not `SELECT`-derived from tags). `concern_triage_state`:
match the sibling `concern_clarify_candidates` convention (nullable; parser accepts `null` AND `[]`); `ADD
COLUMN` with a constant default is metadata-only in PG11+ (safe on the live sessions table).

**INV-10 — Testability.** The T1 predicate + the triage-entry builder land in a PURE module
`wizard/triage.ts` (sibling of `confidence-gate.ts`), Vitest-covered — not inline in the 990-line
`run-diagnostics.ts` (already 2× the 500-line policy). The Tier-A triage entry persists the chip's audited
`allowed_service_keys` snapshot so the tap resolves from persisted state (the clarify idiom), not a live
table read that can drift between diagnosis and tap.

## 4. File-change list

**LLM / diagnosis:** `llm/diagnose-concern.ts` (INV-6 schema + `category_constraint` arg + constrained
Stage-1 render + follow-up-answer user line + singleton short-circuit + remove dead
`collectAllCategoryQuestionIds`); `supabase/functions/llm-testing/stage-schemas.ts` (INV-6 mirror decision).

**Actions / wizard:** NEW `wizard/triage.ts` (INV-10 pure predicate/builder); `actions/run-diagnostics.ts`
(triggers, INV-2 carry-forward, INV-3 preservation, INV-4 priority, `category_constraint` pass,
`handoff_reason`, telemetry); NEW `actions/submit-concern-triage.ts` (Tier-A tap → constrained
re-diagnosis; INV-4 self-routing; guards+audit mirror `submit-concern-clarify`);
`actions/submit-concern-clarify.ts` (B1/B3/B4 + INV-3);
`actions/submit-clarification-answer.ts` (B5 + INV-4); `actions/submit-testing-service-approval.ts` +
`get-current-card.ts` (D1/INV-8 + the `concern_triage` card arm + `concern_triage_state` in the cached
select + defensive empty-head stub); `ensure-concern-summaries.ts` (D2 via the stable `concern_id` of
INV-13 + INV-3 round-trip preservation + thread the chosen triage CATEGORY ANSWER into the advisor concern
summary); `actions/submit-service-and-concern-picker.ts` (D3/INV-7 + INV-2 fresh-reset + INV-13 concern_id mint);
`actions/submit-start-over.ts` (INV-2 full reset);
`actions/submit-second-routine-pass.ts` (INV-3); `actions/submit-explanation.ts` +
`heritage/ConcernExplanationCard.tsx` (C1); `ServiceAndConcernPicker.tsx` (C2).

**Step + card wiring:** `src/lib/scheduler/session-state.ts` (add `"concern_triage"` to `WIZARD_STEPS`;
note the `current_step` column comment); `card-payloads.ts` (`ConcernTriagePayload` + `copy:
CardCopy<"concern_triage">`); `card-text.ts` (`CARD_TEXT_DEFAULTS` entry — byte-identical to the seed);
`get-current-card.ts` (card arm, above); `WizardSurface.tsx` (union arm, key on `concern_index`);
`submit-back.ts` + `WizardBackBar.tsx` (its own step whitelist) + `WizardProgress.tsx` (phase map);
NEW `heritage/ConcernTriageCard.tsx` (Heritage chip card mirroring `ConcernClarifyCard.tsx` — needs the
**plan-phase** `frontend-design-director` spec, §6).

**DB:** NEW migration `*_concern_triage.sql` — recreate `apply_wizard_transition` (INV-1);
`customer_chat_sessions.concern_triage_state` (INV-9); `concern_triage_chips` table + literal audited seed
(INV-9); `scheduler_card_text` seed for the new card. Regenerate `src/lib/database.types.ts`.

**Docs / eval:** `.claude/memory/scheduler/scheduler_system_architecture.md` + its "Last updated" line (hard
rule, same commit); `scripts/eval` golden-set integration (INV-11 below) + `datasets/golden-cases.json`
relabel; `testing_services.concern_categories[]` tag-partition audit via /schedulerconfig (retraining).

**INV-11 — Eval is not runnable as planned:** `scripts/eval/run-eval.ts:146` hardcodes `eval-cases.json`
(145). Reconcile the two runner references first: confirm which loader CI actually drives (`run-eval.ts`
vs `run-eval-x.ts`) and make THAT one authoritative; add a dataset-path flag / golden-set loader so the
272-case `docs/automotive-knowledge-base/datasets/golden-cases.json` runs; surface `no_match_reason` in
result rows; capture the BEFORE baseline at the START of implement (before any prompt change). The relabel
covers ONLY the 37 `null_match` split (non_concern stays `null_match`; genuinely-vague → new `triage`
route). **The 4 `advisor_handoff` cases STAY `advisor_handoff`** — there is no Tier-B, so Stage-2-unsure
does not become `triage` (the earlier Tier-B relabel was removed with Chris's 2026-07-19 decision).

## 5. TDD test plan

- **Vitest (pure — against `wizard/triage.ts`):** the full trigger matrix — T1 fires ONLY on
  {too_vague, no_catalog_fit} × triage_round-0 × parsed_ok; never on non_concern_request / all-invalid-keys
  / desc<3 / LLM-failure / triage_round≥1. Stage-2 outcomes → advisor (S2-low-picked → advisor strip;
  S2-null-genuine → advisor; S2-transport-failure → today's recommend-without-questions degrade, unchanged).
  `category_constraint` filter incl. singleton short-circuit. INV-3 round-trip field preservation. INV-2 carry-forward (skipped concern's clarify/triage
  entry survives a re-run). INV-8 decline-merge symmetry. D2 index-match. C1 no-signal detector (positive
  "idk"; negatives "no heat", "HORN INOPERABLE", "under vehicle leak"). B1 gate incl. missing-confidence
  pass-through. B5 step-guard + drained-branch orphan regression (explicit unit case).
- **pgTAP:** RPC arm write/clear (INV-1), `concern_triage_chips` RLS + uniqueness + seed, column default.
- **Playwright E2E:** vague → Tier-A chip → constrained result → category attached; S2-untrustworthy →
  advisor handoff; multi-concern ordering (triage before clarify, no queue wipe); "Not sure" → advisor;
  round cap; back-button no longer wipes work; fresh simple-only pick does NOT land on edit-hub.
- **Eval:** baseline the 272-case golden set (INV-11) before, then per slice.

## 6. Build sequence

1. **Plan phase:** `frontend-design-director` spec for `ConcernTriageCard` → `.claude/work/design/`
   (BEFORE any UI code; the verify-phase design-review gate expects it). Resolve the Deno-mirror decision
   (INV-6) and §7.
2. **Implement — backend, no UI:** `wizard/triage.ts` + `no_match_reason` + `category_constraint` + the
   B/D fixes + migration (RPC arm, column, table, seeds) + Vitest/pgTAP + the eval golden-set loader +
   BEFORE baseline. Independently verifiable.
3. **Implement — functional UI:** the `concern_triage` step, card, payloads, routing, `submit-concern-triage`,
   all wiring files + E2E.
4. **Implement — design polish** (frontend-implementer) per the spec.
5. Eval per slice + `scheduler_system_architecture.md` update.

## 7. Decisions

**Resolved (Chris, 2026-07-19):**
- **Stage-2 low-confidence / can't-pick → advisor handoff** — no Tier-B subcategory-chip step (INV-5, §2 B1/B2).
- **D1–D3 folded** into this feature.

**Resolved after cross-verify (2026-07-19):**
- **Adopt category threading** (reverses the earlier default): the customer's chosen triage category IS
  threaded into the advisor-facing concern summary (`ensure-concern-summaries`), so a post-triage dead-end
  handoff shows the advisor "customer says it's the brakes," not just "car feels weird." Serves the whole
  point of asking. (GPT cross-verify.)
- **`submit-start-over` = FULL reset** of `concern_triage_state`, `concern_clarify_candidates`,
  pending/answered questions, diagnostic annotations, recommendations, and all triage/handoff metadata
  (added to the file-change list + a test). (INV-2.)
- **Deno mirror updated in the same commit** (INV-6, resolved above).

**Defaulted for v1 (say the word to change):**
- Triage chips **seed-only** (literal audited seed rows); `/schedulerconfig` editor as a follow-up.
- `handoff_reason` *code* stays observability-only in Sentry; the customer's category ANSWER is threaded to
  the advisor summary per the resolution above.

> The full cross-verify hardening (both models, un-truncated) is folded in as **§10 (INV-12…INV-19)**.

## 8. What this deliberately does NOT change

The `routeAfterDiagnostics` rule body (triage layers above it; only its `recommendation_count` input
changes per INV-8), the 3-stage architecture, the deterministic mapper contract, the escalation flow, the
Heritage UI patterns. No catalog **retraining** ops are applied here — that's the separate Phase-5 pass;
this feature adds the flow machinery + the audited chip seed + the tag-partition audit triage depends on.

## 9. Fable plan-review resolution (2026-07-18)

4 lenses; verdicts: architecture `ready_with_minor_fixes`, correctness `needs_revision`, regression
`needs_revision`, scope/TDD `ready_with_minor_fixes`. All 11 must-fixes folded in as INV-1…INV-11 above;
the 28 should-fixes folded into §3/§4/§5 (RPC recreate, carry-forward, field preservation, 5-site routing,
T2/B2 predicate, D3 merge/routing split, D1 undecided-count, plan-phase design spec, eval golden-set
loader, migration conventions, pure `triage.ts` module, card-text/WizardBackBar/database.types/doc wiring,
Deno-mirror decision, back-compat parser defaults). Full findings:
`docs/automotive-knowledge-base/workflow-review/` review + the run journal.

## 10. Cross-verify hardening (Gemini 3.5 Flash + GPT-5.6 Terra, un-truncated, 2026-07-19)

Both models validated the design and surfaced structural gaps → folded in as INV-12…INV-19 + the resolved
open items in §7. Artifacts: `.claude/work/ai-review-2026-07-19T02-22-39Z.md` (+ two earlier runs).
**One flagged item is a misread (no action):** the `no_match_reason` "omit `type` + `null`-in-enum" encoding
(INV-6) IS the repo's existing Anthropic constrained-decoding pattern (`extracted-facts.ts:704-712`) — it
works on the Anthropic path. The only real to-do: **verify it on the Stage-1 gemini/gateway transport**
(Stage 1 defaults to `google/gemini-3.1-flash-lite` via `generateObject`) at implement, since that path may
want `enum:[…,null]` WITH `type`.

**INV-12 — `concern_triage_state` JSON contract (define it explicitly).** One entry per triaged concern; the
card, parser, carry-forward, and submit action MUST agree on this shape:
```
{ concern_id: uuid,          // INV-13 stable identity (NOT array index / service_key)
  concern_index: int,        // display order only
  service_key: string,       // source picker chip
  concern_text: string,      // echoed to the customer
  chips: [{ chip_key, display_label }],          // rendered snapshot (card + tap agree even if seed edited)
  allowed_by_chip: { <chip_key>: [service_key…] }, // SERVER-resolved audited subset snapshot (INV-14)
  triage_round: 0|1,
  created_version: string }  // chip-seed version (observability + snapshot integrity)
```
Nullable OR `[]` (parser accepts both, `parseClarifyEntries`-style). Consumed/cleared on tap, empty-items
branch, fresh picker submit, and start-over (INV-2).

**INV-13 — Stable per-concern identity.** Mint an immutable `concern_id` (UUID) on each explanation item at
CREATION (`submit-service-and-concern-picker`), thread it through EVERY parser/merge/write-back, and use it
(not array index, not the non-unique `other_issue` `service_key`) as the join key for D2 summary matching,
the INV-8 approved/declined sets, carry-forward seeding (INV-2), and audit rows. This one change is the
correct fix for D2, D3, and the INV-8 decline set (both models: "index/identity is not identity"). Items
persisted before deploy lack it → mint on first read.

**INV-14 — Trust boundary + post-LLM allowlist (security).** `submit-concern-triage` accepts ONLY a
`chip_key` + the `concern_id` it targets, and MUST reject anything not matching the authenticated session's
CURRENT triage queue head + the server-persisted `allowed_by_chip` snapshot — never trust a client-sent
category/service list. The `category_constraint` is derived SERVER-side from that snapshot; every resolved
service is re-verified active + `SHOP_ID`-scoped. Since a model can still emit an out-of-set key,
`diagnoseConcern` applies a FINAL allowlist filter on Stage-1 output; empty post-filter → the defined advisor
path (never a loop). The constraint is keyed by `concern_id` so a multi-concern re-run constrains ONLY that
concern's catalog.

**INV-15 — Concurrency / idempotency.** Every submit that read-modify-writes session JSON (triage/clarify
tap, clarification answer, picker resubmit, approve/decline) guards on the queue-head identity it expected;
a tap whose `concern_id`/head no longer matches (double-tap, two tabs, stale bundle) is an idempotent
no-op, not a second consume. Put the head-match + `triage_round===0` check INSIDE the atomic
`apply_wizard_transition` step (compare-and-set), mirroring `submit-concern-clarify`'s stale-tap guard. The
empty-items clearing (INV-2) is conditioned on the concern-set read at invocation start so a slow async
`run-diagnostics` can't erase newer state.

**INV-16 — Typed diagnosis outcome.** A typed result carries `parsed_ok` (produced by the parser, NOT
inferred from `no_match_reason` — parse failures default that to null) and a typed `stage2_status`
(`picked`|`low`|`null_slug`|`failed`) persisted into `precomputed`, so "genuine null-slug → advisor" vs
"transport-failure → recommend-without-questions degrade" (INV-5) survives persistence on the clarify path.
B1 back-compat: unknown `stage2_status` → treat as `failed` (today's degrade), never a silent pass to a fee
rec; version the `precomputed` shape.

**INV-17 — Deploy order / release compatibility.** The migration (RPC arm + columns + chip seed) and ALL
step/card wiring ship BEFORE `run-diagnostics` may persist `current_step = concern_triage`.
`get-current-card` renders a safe fallback (route as today) for an unknown step so an in-flight old bundle
can't hard-fail; gate the triage TRIGGER behind a "wiring live" check so backend-first (build step 2) never
strands a client.

**INV-18 — Chip lifecycle + fallback (shop-agnostic).** Load-time validation: every seeded
`allowed_service_keys` element must resolve to an ACTIVE `testing_services` row for the shop; unknown keys
dropped + warned (fact-mapper-style), never crashed on. **Safe fallback:** a shop with no/empty/all-invalid
chip config → triage does NOT fire (advisor as today), never a broken card. Seed is idempotent `ON
CONFLICT`; document provisioning for future shops (a versioned canonical template at onboarding). A
regression test asserts enabled chips cover the canonical 14-minus-`other` taxonomy and each intended
service is in the right subset.

**INV-19 — Observability.** Structured events, dims `{shop_id, chip_seed_version, no_match_reason,
outcome}`: `no_match_reason` distribution; `nudge_shown`/`_ignored`; `triage_offered`/`_tapped`/`_not_sure`;
constrained-rerun outcome (direct/clarify/advisor); `invalid_chip_subset`; `s2_low_handoff`/`s2_null_handoff`.
Alertable rates (a spike in `too_vague`→advisor after a prompt change = a regression). Extends the existing
`run_diagnostics_v2_outcome` Sentry log.

**INV-6 addendum — the `no_match_reason` rubric is retraining, not just schema.** Add Stage-1 prompt
semantics + ≥2 golden cases PER reason (`non_concern_request` = work-order line; `too_vague` = real symptom,
no system named; `no_catalog_fit` = clear concern, no catalog home) so the model emits the CORRECT reason.

**INV-9 addendum:** `concern_triage_chips` gets the scheduler-family `updated_at` touch trigger; a Vitest
asserts `CARD_TEXT_DEFAULTS["concern_triage"]` is byte-identical to the SQL seed.

### 10.1 TDD hardening (supersedes §5 scoping)
- **Split pure vs action tests:** `wizard/triage.ts` Vitest covers ONLY the T1 predicate + entry builder +
  `category_constraint` derive/filter. D1/D2/C1/B1/B5 are tested at their own action/module level.
- **Action-level coverage the happy-path E2E misses:** forged `chip_key`/`concern_id`; wrong-shop/session;
  stale queue-head after a re-run; double-tap triage+clarify; concurrent approve/decline; start-over during
  a pending card; the INV-14 post-LLM allowlist (model returns out-of-set key → advisor).
- **RPC pgTAP** regresses the FULL recreation: existing writable fields, ignored-field behavior, `SECURITY
  INVOKER`, `search_path`, EXECUTE grants, authenticated-session RLS — not just the new arm.

### 10.2 Appendix — literal audited chip→service mapping (reviewable here; seeded verbatim)
**12 category chips + 1 escape** (14 concern categories minus `other`; steering+pulling merged). `**bold**`
= the P6 confusable-matrix additions beyond the raw `concern_categories[]` fan-out.

| chip_key | label (customer voice) | maps_to | audited allowed_service_keys |
|---|---|---|---|
| noise | A noise it shouldn't be making | noise | brake_inspection, brake_inspection_warning_light, exhaust_system_testing, suspension_steering_check |
| shaking | Shaking or vibration | vibration | suspension_steering_check, **brake_inspection** (#8) |
| warning_light | A warning light on the dash | warning_light | warning_light_general, check_engine_light_testing, abs_traction_stability_testing, brake_inspection_warning_light, airbag_srs_testing, tpms_testing, oil_pressure_light_testing, power_steering_eps_testing, battery_test, charging_starting_testing |
| leak | Leaking or a puddle under the car | leak | coolant_leak_testing, coolant_leak_testing_euro, oil_leak_testing, oil_pressure_light_testing, ac_leak_testing |
| smell | A strange smell | smell | coolant_leak_testing, oil_leak_testing, exhaust_system_testing, **ac_performance_check** (musty vents) |
| smoke | Smoke or steam | smoke | coolant_leak_testing, oil_leak_testing, **check_engine_light_testing** (blue/gray), **exhaust_system_testing** |
| brakes | The brakes | brakes | brake_inspection, brake_inspection_warning_light, abs_traction_stability_testing |
| steering | Steering, pulling, or drifting | steering+pulling | suspension_steering_check, power_steering_eps_testing |
| hvac | Heat or A/C | hvac | ac_performance_check, ac_leak_testing |
| electrical | Battery, electrical, or something won't turn on | electrical | charging_starting_testing, no_start_testing, battery_test, electrical_testing_general, window_inop_testing, windshield_inop_testing |
| performance | How it runs or drives (power, stalling, shifting) | performance | check_engine_light_testing, no_start_testing, transmission_testing, awd_4x4_testing, charging_starting_testing |
| tires | Tires or wheels | tires | tire_repair, tpms_testing, **suspension_steering_check** (#6) |
| not_sure | Something else / not sure | — | (escape → advisor) |

> These LITERAL subsets are the tag-partition audit's output (dependency in §8); the migration seeds them
> verbatim (not a `SELECT` from tags), and INV-18 validates them at load. Final subsets confirmed with the
> audit at implement.

### 10.4 v2.1 refinements (Gemini max-effort review of v2, 2026-07-19) — folded in
- **INV-15 strengthened (two concurrency clarifications):** (a) the CAS covers not just the tap transition
  but the ENTIRE `run-diagnostics` write-back — the final persist is conditioned on the session
  revision/epoch read at invocation start (a conditional UPDATE, not a naive save), so a slow (2-5s) LLM run
  can't clobber a Back / second-concern / answer change made during its window. (b) `submit-concern-triage`
  consumes/increments `triage_round` SYNCHRONOUSLY (committed) BEFORE the async re-diagnosis starts, so a
  double-tap's second request sees `triage_round=1` and no-ops (no second LLM run).
- **INV-1/INV-9 clarification (no permission clash):** `apply_wizard_transition` (SECURITY INVOKER) does NOT
  read `concern_triage_chips`. Chip resolution happens in the `submit-concern-triage` server action via the
  **service-role admin client** (RLS-bypassing), never a client-invoked RPC — so the deny-all RLS on the
  chips table is fine. Stated so the RPC recreate never adds a chips read.
- **INV-13 refinement (no read-path side effect):** mint `concern_id` at WRITE (picker creation); for a
  legacy pre-`concern_id` item, mint during the next WRITE-BACK (the persist that already rewrites items),
  NOT on a pure read — so concurrent reads can't generate divergent UUIDs.
- **INV-18 refinement (hide empty chips):** a chip whose resolved `allowed_service_keys` is EMPTY for the
  active shop is NOT rendered — a customer can't waste their one triage round on a chip that would dead-end.
- **INV-8 refinement (re-decline safety):** on ANY approve/decline transition, clear the target item from
  BOTH sets FIRST, then apply the action — so a re-decline of a previously-approved service isn't silently
  stripped by `− finalApproved`.
- **INV-14/INV-12 (constraint doesn't leak):** `category_constraint` is derived per-tap from the consumed
  triage entry and applied to that ONE concern's re-run only; never persisted session-wide; the concern's
  `triage_answers` stop constraining once it's diagnosed (annotated). No permanent session lock.
- **UI drift:** `ConcernTriageCard` renders LABELS from the DB chip rows (no drift); only the decorative
  icon is keyed by `chip_key` with an unknown-key → no-icon fallback (already in the design spec); the
  `not_sure` escape is a fixed non-DB affordance.
- **C1 nit:** server `min(1)` enforced on TRIMMED text (whitespace-only rejected).
- **Hygiene:** CI/test that Deno `stage-schemas.ts` STAGE1 matches the app schema (INV-6); prune consumed
  `concern_triage_state`/`concern_clarify_candidates` entries once a concern is finalized to cap
  session-JSON growth (INV-12).

### 10.3 Status
This is plan **v2.1** — two full cross-verify rounds (Gemini + GPT, un-truncated) + the v2 max round, all
folded in. Remaining items are implement-time verifications, NOT plan blockers: the exact per-chip
`allowed_service_keys` finalized with the tag-partition audit; and confirming the INV-6 nullable-string
encoding round-trips on both transports (a Vitest against the live Stage-1 schema).

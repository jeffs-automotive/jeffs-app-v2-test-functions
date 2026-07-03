# Summary edit hub + describe-another-issue — plan (2026-07-03)

> Chris (2026-07-03): "Edit something" must open per-section cards with edit buttons; ALL given
> information stays saved unless explicitly changed or start-over. Also: the "add anything else"
> card needs a describe-an-issue path (customers can have multiple typed symptoms).

## Root causes (research map in `.feature` artifacts; anchors verbatim)

1. `SummaryCard.tsx:151` hardcodes `edit_target:"other"` → `customer_info_edit` → forced forward
   chain (`submit-customer-info-edit.ts:196` → `submit-vehicle-pick.ts:230`) →
   `submit-service-and-concern-picker.ts:195-213` **wholesale-overwrites** `explanation_required_items`
   + `clarification_questions_answered` (+ recs/pending). `mapEditTargetToStep` already supports
   date/vehicle/services deep-jumps (`submit-summary.ts:170-190`) — dead code from the UI.
2. Edit path never releases the slot hold (only `submit-back.ts:100-123` does).
3. `second_routine_pass` accepts only routine keys (`submit-second-routine-pass.ts:106-126`),
   no concern/free-text branch.

## Locked design

**A. New step `summary_edit_hub`** (summary's "Edit something" → hub; attempts counter unchanged —
one hub entry can host many section edits, escalation at 3 stays).
Hub renders 4 section cards, each with current values + an Edit button, plus primary
"Looks good — back to summary":
  1. **Contact info** → `customer_info_edit`
  2. **Vehicle** → `vehicle_pick`
  3. **Services & concerns** → `service_concern_picker` (prefilled — see C)
  4. **Appointment time** → `date_pick` (releases the existing hold on entry, same
     mechanics as submit-back's release; fresh hold made by the normal flow)

**B. Return-to-hub semantics.** New session column `edit_return_step TEXT` (+ RPC allowlist arm).
When set to `summary_edit_hub`: `submit-customer-info-edit` and `submit-vehicle-pick` return to
the hub instead of their forced forward chain; the date→time flow clears the flag and lands on
`summary` naturally (slot edits end at summary anyway). Flag cleared on hub→summary exit and by
start-over.

**C. Smart merge in `service_concern_picker` (the actual data-loss fix).**
- Picker opens PREFILLED from session state when `edit_return_step` is set (current
  `selected_simple_services` + `approved_testing_services` + concern entries as picked chips).
- On resubmit, MERGE instead of overwrite: concern entries whose service_key survives keep their
  `explanation_text`, `unanswered_question_ids`, summaries, and their
  `clarification_questions_answered` entries; removed entries drop (that's the customer removing
  it — allowed); NEW entries get the normal empty-entry treatment.
- `diagnostic_processing_complete` set false ONLY when new/changed entries exist; unchanged-only
  resubmits skip re-diagnosis entirely and return to hub.
- Known v1 caveat: multiple `other_issue` entries share a service_key — merge by key+position;
  documented, acceptable.

**D. `second_routine_pass` gains "💬 Describe another issue".**
New submit branch appends an `other_issue` entry to `explanation_required_items` and routes
`concern_explanation` → `diagnostic_loading` → (clarify/questions/approval as normal) → loops back
to `second_routine_pass` (natural landing), where the customer can add more symptoms or continue.
This also answers "more than one symptom": the loop supports N typed concerns (downstream is
already queue-based per the map).

## File-by-file

- Migration: `edit_return_step TEXT` on customer_chat_sessions + `apply_wizard_transition` arm.
- `session-state.ts` + `card-payloads.ts` + `get-current-card.ts` + `WizardSurface.tsx`:
  `summary_edit_hub` step + payload (section summaries derived via build-summary-data) + case + arm.
- NEW `SummaryEditHubCard.tsx` (design spec: `.claude/work/design/summary-edit-hub-spec.md`).
- NEW `actions/submit-edit-hub.ts` (choose section → set edit_return_step + release hold for time
  edits + transition; "back to summary" → clear flag + summary).
- `submit-summary.ts`: edit path → `summary_edit_hub` (drop the hardcoded customer_info_edit jump).
- `submit-customer-info-edit.ts`, `submit-vehicle-pick.ts`: honor `edit_return_step`.
- `submit-service-and-concern-picker.ts`: prefill support + smart merge (C).
- `get-current-card.ts` picker case: pass prefill; `ServiceAndConcernPicker.tsx` accept prefill.
- `SecondRoutinePassCard.tsx` + `submit-second-routine-pass.ts`: describe-another-issue branch (D).
- `submit-start-over.ts`: also null `edit_return_step`.
- `submit-back.ts` + `WizardBackBar` + `WizardProgress`: hub step entries.
- Tests: merge-logic unit tests (survive/drop/new), return-to-hub routing, hold release on time
  edit, second-pass concern branch, hub card RTL; update existing picker/back tests.

## Decisions during implement (task EH1, 2026-07-04)

- **Smart-merge landing (§C / File-by-file #8).** When the services edit reached from the hub produces
  NO new-or-unexplained concern entries (pure removal, or an unchanged resubmit), we skip re-diagnosis
  entirely: `diagnostic_processing_complete` stays `true`, the pruned state is persisted, and the wizard
  returns **straight to `summary_edit_hub`**. When the edit DOES add a new concern (or leaves a survivor
  with empty `explanation_text`), we reset `diagnostic_processing_complete=false` and route to
  **`concern_explanation`** — the normal forward diagnostic chain. `edit_return_step` STAYS set through
  that chain; we do NOT reroute the mid-flow diagnostic/approval steps (concern_explanation →
  diagnostic_loading → clarify/questions → testing_service_approval → second_routine_pass →
  appointment_type → date_pick) back to the hub. The flag is cleared naturally when the slot flow lands
  on `summary` (submit-date / submit-waiter-time set `edit_return_step=null` there). Net: existing data
  always survives; a genuinely-new concern legitimately walks the question/approval flow forward and ends
  at summary via the appointment steps, which is the cleanest correct landing given the queue-based
  downstream.
- **Merge pruning rules.** Answered-map answers are kept only when their `question_id` belongs to a
  surviving concern's `unanswered_question_ids`; `recommended_testing_services` entries survive iff at
  least one `source_concern` survives; `declined_testing_services` keys survive iff they map to a
  surviving recommendation. Duplicate `other_issue` concerns are matched positionally (FIFO per key).
- **Hold-release reuse.** submit-back's hold-release (lines 100-123) was extracted to
  `release-hold.ts#releaseSessionHold` and reused by both submit-back and the hub's "edit time" path so
  the mechanics stay identical.
- **Placeholder UI.** WizardSurface renders a minimal unstyled `SummaryEditHubPlaceholder` arm; the
  designed `SummaryEditHubCard.tsx` + `SecondRoutinePassCard.tsx` "describe another issue" belong to a
  separate UI task.

## Decisions during implement (task EH2 — UI, 2026-07-04)

- **`SummaryEditHubCard` consumes the EH1 payload verbatim.** The design spec's illustrative
  `SummaryEditHubCardProps` (flat `customer`/`primary_phone`/`starts_at` ISO) predated EH1; the card was
  built against the **real** `SummaryEditHubPayload` (`contact{name,phone_last_four,email}` /
  `vehicle_label` / `services{routine,concerns,testing}` / `appointment{type,date,time}` / `hold_active`)
  so no payload/wiring change was needed. Visual intent honored: four `Card.Divider` bands, right-aligned
  ghost `size="sm"` Edit buttons with distinct aria-labels ("Edit contact info" / "Edit vehicle" / "Edit
  services and concerns" / "Edit appointment time"), the warn-token slot-release caution under the time
  value (gated on `hold_active`), +N-more cap at 4 for concern/testing rows, italic empty-ish fallbacks,
  and the single burgundy "Looks good — back to summary" primary. The placeholder `SummaryEditHubPlaceholder`
  arm + its now-unused type imports were deleted from `WizardSurface.tsx`.
- **Appointment band formats from date/time, not ISO.** The hub payload carries a `YYYY-MM-DD` `date`
  (+ `HH:MM` `time` for waiter), not a full ISO timestamp like `SummaryCard`, so the band formats the
  calendar date (parsed at local noon to avoid TZ date-rollover) and appends the waiter time when present.
- **APPROVAL-LOOP LANDING FINDING (the requirement's open question).** Verified by reading
  `route-after-diagnostics.ts` + `submit-testing-service-approval.ts`: after a `describe_issue` submit
  routes to `concern_explanation → diagnostic_loading`, `routeAfterDiagnostics` lands on ONE of three
  steps, and **all three converge back on `second_routine_pass`**:
    - `pending_count > 0` → `clarification_question` → (queue drains, same `routeAfterDiagnostics`) → …
    - `pending_count === 0` **with recs** → `testing_service_approval`, and
      `submitTestingServiceApprovalV2` **always** advances to `second_routine_pass` (line 126, no branch).
    - `pending_count === 0` **with 0 recs** → `second_routine_pass` directly.
  So the loop reaches `second_routine_pass` in BOTH tested cases (diagnostics complete with 0 pending/0
  recs AND with recs), where the customer can describe yet another symptom or continue — confirming the
  plan §D "loops back naturally" claim end-to-end. (It never lands on `appointment_type` mid-loop; that's
  only reached by pressing the second-pass "continue" CTA.)
- **No concern-count cap.** Searched the diagnostic flow — there is no existing per-concern cap or
  escalation-on-N-concerns idiom (the plan's "escalation at 3" counter is the summary-EDIT counter, a
  separate concern), so per the requirement no cap was added; N typed concerns are supported.
- **`describe_issue` is `z.literal(true).optional()`.** The card sends `{ added, describe_issue: true }`
  for the describe path and `{ added }` (no key) for the normal path; the action branches on
  `describe_issue`, persists the validated round2 adds first, then appends the empty `other_issue` entry
  (matching `submit-service-and-concern-picker`'s pseudo-chip shape) and resets
  `diagnostic_processing_complete=false`.

## Verify

typecheck + vitest + build; gate; manual E2E script for Chris's exact repro (add concern → answer
questions → summary → edit vehicle → back to summary with concern intact); deploy + Vercel READY.

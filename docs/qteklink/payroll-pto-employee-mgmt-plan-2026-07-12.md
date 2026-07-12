# PTO + employee-management enhancement — plan v2 (2026-07-12)

> Phase 2 of the qteklink-payroll module. Requirements = Chris's round-11 answers, logged as
> decisions #52–#60 in `payroll-workbook-extraction-2026-07-10.md`.
> **v2 (same day):** amended for ALL 37 confirmed findings of the 5-lens regression check
> (42-agent workflow, zero refuted) — the check's mandate was "must not break the current app."
> Where this plan and the design spec (`.claude/work/design/qteklink-payroll-pto-spec.md`)
> conflict, §10 (spec corrections) wins. Status: GREEN — Chris pre-approved the build once the
> regression findings were folded in.

---

## 1. Scope

Two intertwined pieces, shipped together:

1. **Employee management enhancement** — contact/personal fields, start/termination dates,
   grandfather option, PTO balance display + adjustment flow.
2. **PTO engine** — tenure-tiered accrual applied per completed payroll, calendar-year rollover
   cap, negative-balance warnings, per-employee activity (ledger) page.
3. **Individual pay-summary emails** on run completion (personal email, clean HTML v1) with a
   hard wrong-recipient protection design (§5 — Chris's top concern).

Out of scope (explicitly deferred): app security roles (anyone can do anything for now), PII
encryption (plaintext v1, revisit with roles), employee self-service views, retroactive accrual.

## 2. Schema

### 2a. `qteklink_payroll_employees` — new columns + the NEW profile RPC

New columns (all nullable except the flag): `work_email TEXT`, `personal_email TEXT` (pay
summaries + employee alerts, #52/#53), `personal_phone TEXT`, `work_phone TEXT`, `address TEXT`,
`start_date DATE` (tenure anchor), `termination_date DATE` (set via the ARCHIVE modal),
`pto_grandfathered BOOLEAN NOT NULL DEFAULT false` (waives the 6-full-period wait),
`pto_tenure_credit_date DATE` (overrides start_date for TIER lookup only — acquired-company
seniority).

**Regression-critical write design (amendments C2/C3/C11/C18/C24/C30):** the existing
`qteklink_payroll_upsert_employee` is **byte-untouched** — no signature change, no overload, no
pgTAP `has_function` churn, and its three pass-through callers (EmployeeManager.flipArchived,
`writeThroughEmployeePayConfig`, `scripts/payroll-seed-leave-rates.mjs`) structurally CANNOT
touch or wipe the new columns. All new-column writes go through a NEW RPC:

```
qteklink_payroll_update_employee_profile(
  p_shop int, p_employee uuid, p_patch jsonb DEFAULT '{}'::jsonb,
  p_archived boolean DEFAULT NULL, p_actor text)
```

- `p_patch` semantics: **key present = write that value (JSON null clears); key absent = leave
  unchanged.** Allowed keys = exactly the nine new columns; unknown keys RAISE. Shape-validated
  (emails look like emails, dates cast, booleans boolean).
- `p_archived` present → flips `archived_at` atomically in the same UPDATE (audited, mirroring
  the upsert's CASE idiom). **`p_archived = false` auto-clears `termination_date`**
  (C8/C23/C36 — a rehired employee must accrue again; the cleared value is preserved in the
  audit-log detail row). Re-archiving overwrites any prior termination_date via the modal.
- Archive modal = ONE call (`p_patch {"termination_date": …}, p_archived: true`); unarchive =
  ONE call (`p_archived: false`), keeping the spec's plain ConfirmDialog. Both replace
  flipArchived's upsert call; the upsert remains the form-save path.
- Full `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` + `GRANT … TO service_role` (N1 —
  applies to EVERY new function in this migration; pgTAP anon-denial list extended).
- TS read surface: `EMPLOYEE_COLS`, `EmployeeDbRow`, `employeeFromRow`, `PayrollEmployee`
  extend to carry the new columns (read-only for the legacy paths).

**Legacy pay_config keys `pto_balance_hours` / `pto_accrual_hours_per_period` (C6/C22/N5/N12):**
both keys stay **ALLOWED forever** in the SQL validator's `v_allowed` and the Zod schemas
(stored rows, void-cloned entry rows, and frozen snapshots are never backfilled), but are
**demoted from required to optional** in BOTH validators (SQL `v_required`, Zod
`payConfigCommon` → `.optional()`, still strictObject) so new employees don't need them. UI
sweep covers ALL THREE surfaces: the two inputs are REMOVED from EmployeeForm (the form's
preservation rule keeps round-tripping stored values); the roster card's PTO line AND the
dashboard `EmployeesCard`'s "PTO available" column repoint to the LEDGER balance (the
"accrues X hrs/period" sub-line is dropped — the tier engine owns rates now). §8.6 seeding is
Chris's manual initial-balance adjustments ONLY — never reads pay_config.pto_balance_hours
(auto-migration would double-count).

### 2b. New table `qteklink_payroll_pto_ledger` (RPC-write-only, the single balance truth)

```
id UUID PK, shop_id INT NOT NULL, employee_id UUID NOT NULL REFERENCES qteklink_payroll_employees(id),
run_id UUID NULL REFERENCES qteklink_payroll_runs(id),
kind TEXT NOT NULL CHECK (kind IN ('initial','accrual','usage','adjustment','rollover_forfeit','void_reversal')),
hours NUMERIC(7,2) NOT NULL,               -- signed; matches the run_employees NUMERIC-hours idiom (money never stored here, N14)
balance_after_hours NUMERIC(8,2) NOT NULL, -- running balance stamped in-RPC under the shop ledger lock
reason TEXT,                               -- REQUIRED for kind='adjustment' (CHECK)
reverses_ledger_id UUID NULL REFERENCES qteklink_payroll_pto_ledger(id),  -- void_reversal → the exact row it negates
boundary_year INT NULL,                    -- rollover_forfeit → the calendar year it applies to
created_at TIMESTAMPTZ DEFAULT now(), created_by_label TEXT NOT NULL
```

Constraints/indexes (C4/C9/C19/C29/C34 — as INDEXES, not inline constraints; partial UNIQUE
constraints don't exist in CREATE TABLE):

- `CREATE UNIQUE INDEX … ON …(run_id, employee_id, kind) WHERE kind IN ('accrual','usage')` —
  completion idempotency ONLY.
- `CHECK (kind NOT IN ('accrual','usage','void_reversal') OR run_id IS NOT NULL)` — NULLs can't
  dodge the guard; reversals keep the voided run's linkage.
- `CREATE UNIQUE INDEX … ON …(reverses_ledger_id) WHERE reverses_ledger_id IS NOT NULL` —
  per-row void idempotency (`void_reversal` rows carry the voided run's run_id, kind
  `'void_reversal'`, negated hours, and reverses_ledger_id; NEVER "kind preserved" — that
  collided with the completion-idempotency index and would have broken void-and-clone).
- `CHECK (kind <> 'adjustment' OR reason IS NOT NULL)`;
  `CHECK (kind <> 'rollover_forfeit' OR boundary_year IS NOT NULL)`;
  `CHECK (abs(hours) <= 500)` (fat-finger bound, N14);
  `CHECK (kind <> 'void_reversal' OR reverses_ledger_id IS NOT NULL)`.

**Lock discipline (C13):** every ledger-writing RPC (complete, void, adjust/initial) takes ONE
per-shop advisory lock — `pg_advisory_xact_lock(hashtextextended('qteklink_payroll_pto_ledger:'
|| shop_id, 0))` — immediately AFTER the run-row lock where one is held, as its first lock
otherwise. One lock class ⇒ deadlock cycles are unconstructible, and adjustments serialize
against completions (the running-balance stamp requires that anyway). Migration carries a
comment-level invariant next to the lock: "all payroll ledger writers: run row → shop ledger
advisory; never interleave."

Standalone ledger RPC (`qteklink_payroll_adjust_pto`) exists ONLY for kinds
`initial`/`adjustment`; run-driven kinds are written exclusively inside the two extended run
RPCs (§4). Balance = last `balance_after_hours`.

### 2c. New table `qteklink_payroll_email_log` (the §5 safety rail; RPC-write-only)

```
id UUID PK, shop_id INT NOT NULL, run_id UUID NULL, employee_id UUID NULL,
kind TEXT NOT NULL CHECK (kind IN ('pay_summary','pto_adjustment','pto_negative')),
recipient TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
status TEXT NOT NULL CHECK (status IN ('pending','sent','failed','skipped_no_email')),
sent_at TIMESTAMPTZ NULL, detail TEXT NULL, created_at TIMESTAMPTZ DEFAULT now()
```

- `CREATE UNIQUE INDEX … ON …(run_id, employee_id, kind) WHERE kind = 'pay_summary'` (partial
  INDEX, not an inline constraint — C34) + `CHECK (kind <> 'pay_summary' OR (run_id IS NOT NULL
  AND employee_id IS NOT NULL))` so no pay-summary row can dodge exactly-once via NULLs.
- **One row per (run, employee) identity, EVER** — the row is pre-inserted `status='pending'`
  (or `'skipped_no_email'`) inside the completion transaction (§4), then finalized by an atomic
  claim RPC: `pending→sent`, `pending→failed`, `failed→pending` (explicit retry) are the only
  legal transitions; **`sent` is terminal and immutable** — that transition IS the never-
  double-send guarantee, and a rate-limited `failed` row stays retryable (C27) via a "Resend
  failed summaries" affordance on the completed run page.

### 2d. Settings (`qteklink_settings.payroll` JSONB)

| Key (TOP-LEVEL — C25; the spec's nested-in-alert_emails reading is corrected in §10) | Shape |
|---|---|
| `pto_tenure_tiers` | `[{ min_years: int ≥ 0, hours_per_period: number ≥ 0 }]` — sorted, unique, must include min_years 0 **when non-empty**; sick days folded into the rates |
| `pto_rollover_cap_hours` | number ≥ 0 or null (null = unlimited) |
| `pto_adjustment_alert_emails` | string[] |
| `pto_negative_alert_admin_emails` | string[] |

**Regression-critical (C1/C10/C17/C28/C31 — the single most-found collision):** the settings
write path is a whole-object replace fed by a 3-key literal rebuild; an unextended TS chain
means ANY existing settings save (anchor, spiff, alert emails, or the AUTOMATIC
`discoverAndMergePayrollCategories` fired by the run-page "Refresh Tekmetric data") silently
DELETES the PTO configuration. Therefore, **in the same commit as the migration**, all four
keys are added as **REQUIRED (non-optional) properties** — defaults `[]`, `null`, `[]`, `[]` —
across the FULL chain: `PayrollSettings`, `DEFAULT_PAYROLL_SETTINGS`, `PayrollSettingsDbSchema`,
`normalizePayrollSettings` (payroll-shared.ts), the `next` rebuild in `updatePayrollSettings`
(payroll.ts), and the settings action's patch assembly. Required-ness makes tsc structurally
force every rebuild site; optional keys would compile and silently wipe.

SQL validator contract (C7): each new key validated ONLY when present (the existing
`p_payroll ? 'anchor_period_start'` idiom); absent/null/`[]` tiers = valid "unconfigured"; NO
top-level key whitelist; the extension stays inside the existing 10-param
`qteklink_upsert_settings` (no signature change — its pgTAP pins the 10-param form). Action
contract: each new field is an independent optional whole-replace patch; the legacy
void_clone/completed travel-together rule is untouched; tiers/rollover saves carry no email
fields. The non-admin read-only settings view gains the two new lists.

## 3. Accrual engine (pure lib — `src/lib/payroll/pto.ts`, unit-tested like calc.ts)

- **Eligibility = pure anchor-cadence calendar math (C35), independent of which run rows exist:**
  let P0 = the first cadence period_start ≥ `start_date` (cadence = anchor + 14n, the same
  arithmetic create_run validates). Eligible on a run iff `run.period_start ≥ P0 + 84 days`
  (their 7th full cadence period). Voided runs, gaps, and out-of-order backfills cannot shift
  eligibility. `pto_grandfathered` waives the wait and only matters for employees the calendar
  math has not yet cleared.
- **Unconfigured/partial states NEVER RAISE (C14 — completion must work on payday regardless
  of setup order):** tiers absent/empty ⇒ accrual 0, no rows; `start_date` NULL and not
  grandfathered ⇒ ineligible, no row; grandfathered with NULL start_date AND NULL
  tenure-credit date ⇒ no accrual + a non-blocking warning in the completion result;
  zero PTO configuration ⇒ completion behaves exactly as today (no-op is success). Negative
  alerts are suppressed until the employee has ≥ 1 ledger row (no spam off unseeded balances).
- **Tier rate:** years of service = whole years between (`pto_tenure_credit_date ??
  start_date`) and `period_start`; rate = greatest `min_years ≤ years` ⇒ the new rate lands on
  the first pay period after the anniversary (#56).
- **Usage (C37 — gates differ!):** the archived/terminated exclusion gates **ACCRUAL only**. A
  `usage` entry is written for EVERY employee with paid PTO hours in the frozen snapshot —
  archived or terminated included (roster sync deliberately keeps archived employees with
  entered hours; they are paid; the ledger must decrement to match). `termination_date <
  period_start` ⇒ no accrual (unarchive clears the date, §2a).
- **Rollover (C33 — order-independent, at-most-once; N13 — NOT derived from bonus_month, which
  is month(period_end) − 1):** forfeit is a pure function of (employee, boundary year Y):
  carryover(Y) = ledger balance from entries attributable before Jan 1 of Y (run-linked entries
  bucketed by their run's period_end year; initial/adjustment by created_at);
  forfeit = max(0, carryover(Y) − cap). Written by whichever year-Y run completes FIRST in
  wall-clock order, iff no un-reversed `rollover_forfeit` row exists for (employee, Y)
  (`boundary_year` column, checked in-transaction under the shop lock) — immune to
  out-of-order completion, and void→clone re-fires exactly once with the SAME value. No ledger
  history before Y ⇒ no forfeit (mid-year go-live seeds survive to the first real boundary).
- **Projection (dry run):** projected balance = current balance + accrual − entered PTO hours.

## 4. Completion pipeline

**Atomicity (C5/C12/C32):** the pure engine's ledger rows ride INTO the completion RPC — a
separate RPC call is a separate transaction and is NOT atomic. `qteklink_payroll_complete_run`
is extended by the repo's DROP-then-recreate idiom (drop the exact old 7-param signature —
never CREATE OR REPLACE into an overload, which breaks PostgREST named/positional resolution
for the LIVE dance) with a new trailing `p_pto_entries jsonb DEFAULT NULL`:

- The **dry-run branch ignores p_pto_entries** — the hash/token Pattern-S flow is
  byte-identical; only the confirm call passes it.
- The confirm branch, inside the ONE transaction and under the shop ledger lock, BEFORE the
  status flip: inserts accrual/usage/rollover_forfeit rows + stamps balances, and pre-inserts
  the §2c email-log rows (`pending` per emailable employee, `skipped_no_email` per skip). Any
  RAISE (incl. the UNIQUE guard) rolls back the whole completion — ledger writes must NOT use
  the post-confirm never-throw idiom (silently swallowing a failed balance write is worse than
  failing completion).
- `qteklink_payroll_void_run` is extended the same way (DROP-then-recreate): the
  `void_reversal` rows write inside ITS transaction, between status flip and clone.
- Both re-issue full REVOKE/GRANT for the new signatures; the pgTAP `has_function` type arrays
  update in the same change; existing positional 7-arg calls keep resolving via the DEFAULT.
- payroll-contract.md's "exact signatures" RPC block updates in the same commit (C11).

**Response + email dispatch (C15/C26/C27):** the server action returns `{ completed: true }`
as soon as the confirm RPC commits. The email fan-out runs post-response via **Next 15
`after()`** (first use in this codebase — deliberate): SEQUENTIAL sends (the Resend key is
shared with live money-path alerts; a parallel burst 429s them), each finalized through the
atomic claim RPC (`pending→sent/failed`). Teardown loss surfaces as stuck-`pending` rows —
visible, retryable, never silent. The existing completed-run alert and the negative-balance
alerts (employee personal email + admin list) ride the same sequential queue. Legitimate skips
NEVER reach `sendQteklinkEmail` (N11 — its empty-recipients Sentry warning stays meaningful
for genuinely unconfigured settings lists). `export const maxDuration = 120` on the run page
segment (the mirror-apply route's 120 is the in-repo precedent for this workload).

**Missing-email gate (#53.3):** the completion dialog lists employees with no personal_email —
"Go back" or a confirm relabeled "Skip emails & mark complete"; skips are recorded
(`skipped_no_email` rows + completion result).

**Negative-balance UX (#59 + N4):** the dry-run modal's PTO section (§6) is the primary
surface; the completion dialog re-states any still-projected-negative employee. Both notices
are **advisory display only** — authoritative balances are computed inside the completion
transaction under the shop lock; PTO is deliberately NOT added to the Pattern-S state hash (an
adjustment must not invalidate an in-flight completion preview). Alerts send at completion.

**Dry-run contract (C16/C21):** the PTO projection is a NEW OPTIONAL SIBLING field on
`PayrollDryRunResult` (e.g. `pto`: per-employee { employeeId, displayName,
currentBalanceHours, accrualHours, usageHours, projectedBalanceHours }), computed DAL-side
from the ledger + pto.ts + entered hours. `buildDryRunDiff`, `DryRunSnapshotView`,
`PayrollDryRunDiff`, its `changed` flag, and every existing diff key stay **byte-identical**;
the modal renders the PTO section OUTSIDE the `changed` conditional (both branches — "no
Tekmetric differences" may co-render with a deficit warning). **Nothing PTO enters RunSnapshot
(N3) — no CALC_VERSION bump**; if a provenance key is ever added later it must be `.optional()`
per the summary_totals precedent.

## 5. Pay-summary email safety (Chris: "super important")

1. **One employee → one isolated render → one message.** No batch templating, no shared render
   context, single recipient, never CC/BCC across employees. Renderer input:
   `(snapshotEmployee, recipient)` only.
2. **Single-source binding:** payload AND recipient from the SAME employee row by
   `employee_id`; the id travels inside the payload end-to-end.
3. **Send-time invariant check:** payload-embedded employee_id vs recipient-row employee_id;
   mismatch ⇒ send REFUSED, Sentry error with both ids (fail closed, loud).
4. **Exactly-once + audit:** §2c — one identity row ever; `sent` is a terminal state reached
   only through the atomic claim; every attempt logged with recipient + status; a 4xx/invalid-
   recipient outcome logs `failed` with the edge-fn response captured (N15) — the
   wrong/absent-address case is auditable.
5. **Human-verifiable content:** subject + header lead with the employee's full name and the
   period ("Pay summary for Matt Clark — Jun 28 – Jul 11").
6. **Tests as regression locks:** injected payload/recipient mismatch ⇒ throws; two employees
   rendered concurrently ⇒ zero cross-contamination; completion flow ⇒ exactly one log row per
   employee; the claim RPC refuses sent→anything.
7. **Transport (N2/N10/N15):** `qteklink-email` gains an ADDITIVE-only optional `html` field —
   `text` stays required exactly as today (the renderer ALWAYS produces both; a unit test
   asserts the payload carries non-empty text); `html` gets its own cap (100k); a contract
   test proves the legacy `{to, subject, text}` body still returns 200 after the change (the
   fn is the single transport for four LIVE alert paths).

## 6. UI surfaces (design spec + §10 corrections)

- **Employees page:** contact/personal fields in a NEW extracted `EmployeeContactPanel`
  (EmployeeForm.tsx is already at the ~500-line limit — N7; the split is named up front);
  start date; grandfather toggle (+ tenure-credit date reveal); ledger PTO balance per
  employee; **Adjust** → `PtoAdjustDialog` (signed hours + required reason + live resulting-
  balance preview with the deficit treatment); **Archive** → `ArchiveEmployeeDialog` capturing
  termination_date (one profile-RPC call); unarchive keeps its ConfirmDialog (one profile-RPC
  call; clears termination_date server-side). The legacy manual PTO inputs are removed (§2a).
- **Per-employee activity page:** the ledger, newest first (kind incl. `void_reversal`
  rendering, ± hours, resulting balance, reason, who, when), linked from the employee card.
- **Dashboard `EmployeesCard`:** "PTO available" repoints to the ledger balance; the
  "accrues X hrs/period" sub-line is dropped (C22).
- **Settings:** tiers editor (0-years row pinned, sort-on-blur), rollover cap, two new
  TOP-LEVEL alert-email lists via the chips idiom (independent patches — C25); the non-admin
  read-only view shows them.
- **Run page:** dry-run modal PTO section (both branches — C16); completion dialog
  missing-email + still-negative notices — **both new props OPTIONAL with empty-array
  defaults, each notice rendered ONLY when non-empty** (C20 — the existing five
  CompleteRunButton tests must keep compiling and passing unmodified; the dialog may now carry
  up to three role="alert" regions, so new combined tests use getAllByRole/within).
- **New files** (500-line policy, N7): `PtoAdjustDialog.tsx`, `ArchiveEmployeeDialog.tsx`,
  `PtoLedgerTable.tsx`, `EmployeeContactPanel.tsx`, `src/lib/payroll/pto.ts`,
  `src/lib/payroll/pay-summary-email.ts` (renderer + binder), `src/lib/dal/payroll-pto.ts`
  (ledger DAL + projections + email orchestration), `src/actions/payroll-pto.ts`
  (adjust/profile/archive/resend actions).

## 7. Testing

- **pto.ts:** eligibility matrix — hire mid-period, exactly 6 vs 7 full periods, grandfathered,
  grandfathered-with-no-dates, NULL start_date, terminated, REHIRED (termination cleared),
  backfilled/voided-gap cadence sequences; tier boundaries + anniversary crossing; rollover:
  out-of-order completion fires exactly once, void→clone nets exactly one un-reversed forfeit
  of the same value, mid-year go-live ⇒ zero forfeits, Dec/Jan straddle; projection math.
- **pgTAP:** ledger RPC (running balance under the shop lock, adjustment requires reason,
  double-apply UNIQUE, abs-hours bound); **full void cycle** — complete (accrual+usage rows) →
  void succeeds (reversal rows kind='void_reversal', balance restored, replayed reversal
  rejected by UNIQUE(reverses_ledger_id)) → clone completes cleanly → clone voids cleanly;
  completion RAISE ⇒ zero ledger rows; void RAISE ⇒ zero reversals; zero-PTO-config completion
  succeeds with zero rows; profile RPC patch semantics (absent=keep incl. pto_grandfathered,
  JSON-null=clear, unarchive clears termination_date, audit rows); legacy 9-arg upsert against
  a fully-populated row leaves every new column byte-identical; email-log transitions
  (pending→sent terminal, failed→pending retry, pay_summary NULL-dodge CHECK); settings: a
  production-shaped payroll write with NO PTO keys lives_ok; `pto_tenure_tiers: []` lives_ok;
  updated `has_function` signatures + anon/authenticated denial for every new/re-created fn.
- **Settings round-trip locks (C1 family):** spiff-only patch AND
  `discoverAndMergePayrollCategories` preserve all four PTO keys; normalize round-trips a
  fully-populated object.
- **§5 safety:** mismatch refusal, isolation, one-log-per-employee, text-required payload,
  legacy edge-fn contract test.
- **RTL:** adjust modal (reason required, negative preview), archive modal, missing-email
  branches + label swap ("Skip emails & mark complete" iff list non-empty), dry-run PTO
  section alongside BOTH a changed diff and the empty state, tiers editor, existing
  CompleteRunButton/DryRunButton suites unmodified-and-green.
- **Existing suites (N8):** the round-7 completion unit test's strict table-allowlist mocks
  extend for the new reads; its money-path invariants restated, not weakened.

## 8. Rollout order

1. Migration (employee columns + profile RPC + 2 tables + extended complete/void RPCs with
   DROP-then-recreate + REVOKE/GRANT + validators) — `supabase db push`; pgTAP green locally
   first.
2. `qteklink-email` edge fn `html` support (additive; legacy contract test) — deploy.
3. TS backend in the SAME commit as any consumer of the migration: pto.ts engine +
   settings-chain extension (§2d — required keys, all five layers) + DAL/actions (TDD).
4. Functional UI, then design polish per the approved spec (+ §10 corrections).
5. Verify gauntlet (typecheck/tests/build + /code-review + review agents) → deploy → Vercel
   READY check.
6. Chris: enter start dates + emails, set tiers/rollover/alert lists, seed balances via
   initial-balance adjustments (as of the LAST pay period). Accrual begins with the first run
   completed in the app — NO retroactive accrual. (Per C14, ordering is convenience, not
   load-bearing: completion is safe in every partially-configured state.)

## 9. Regression-check provenance

5-lens / 42-agent adversarial workflow, 2026-07-12: 37 confirmed findings (0 refuted), all
folded in above — the dominant clusters were the settings whole-replace wipe (found
independently by 6 reviewers), employee-RPC signature/write-semantics traps (6), the void-
reversal UNIQUE collision (4), completion atomicity across RPC calls (3), and the rollover
at-most-once rule. Raw findings: session scratchpad `regression-findings.md`.

## 10. Design-spec corrections (spec file: `.claude/work/design/qteklink-payroll-pto-spec.md`)

1. §3c: the two new alert lists are TOP-LEVEL payroll keys, NOT members of
   `PayrollAlertEmails`; `ListKey` becomes a UI-local union; "submit all four together" is at
   most a card-level behavior — the ACTION must not require it (C25).
2. PtoTiersCard "do not touch the settings DAL shape" → "the DAL shape is extended in rollout
   step 3 (backend), not by the frontend implementer" (C28).
3. Grandfather hint → "Turn on to waive the 6-period wait for a recent hire" (under calendar
   math, long-tenured employees need no flag — C35).
4. Dry-run PTO section placement: renders in BOTH `changed` branches (after the empty-state
   box when there are no Tekmetric differences) (C16).
5. EmployeeForm additions land in the extracted `EmployeeContactPanel`, not inline (N7).
6. The manual PTO balance/accrual inputs are REMOVED from EmployeeForm, not left untouched
   (§2a supersedes the spec's "leave them untouched").

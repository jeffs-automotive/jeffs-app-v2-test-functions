# PTO + employee-management enhancement — plan (2026-07-12)

> Phase 2 of the qteklink-payroll module. Requirements = Chris's round-11 answers, logged as
> decisions #52–#60 in `payroll-workbook-extraction-2026-07-10.md`. Status: PLAN — awaiting
> Chris's go-ahead before implementation.

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

### 2a. `qteklink_payroll_employees` — new columns (all nullable; RPC-write-only as today)

| Column | Type | Notes |
|---|---|---|
| `work_email` | TEXT | stored now, used later (#52) |
| `personal_email` | TEXT | pay summaries + employee alerts go here (#52/#53) |
| `personal_phone` | TEXT | |
| `work_phone` | TEXT | "if applicable" |
| `address` | TEXT | single free-form block v1 (street/city/state/zip typed as one field set — see design spec) |
| `start_date` | DATE | tenure anchor; hand-entered for current roster (#55/#10) |
| `termination_date` | DATE | set via the ARCHIVE modal (#52.8) — archiving prompts for it |
| `pto_grandfathered` | BOOLEAN NOT NULL DEFAULT false | waives the 6-full-period wait (#55) |
| `pto_tenure_credit_date` | DATE | optional: overrides `start_date` for TIER lookup only (acquired-company hires keep their seniority) |

The employee update RPC + write-through DAL (`payroll-employees.ts`) extend to carry these;
validator additions in the migration mirror the existing key-whitelist idiom.

### 2b. New table `qteklink_payroll_pto_ledger` (RPC-write-only, the single source of balance truth)

```
id UUID PK, shop_id INT NOT NULL, employee_id UUID NOT NULL REFERENCES qteklink_payroll_employees(id),
run_id UUID NULL REFERENCES qteklink_payroll_runs(id),
kind TEXT NOT NULL CHECK (kind IN ('initial','accrual','usage','adjustment','rollover_forfeit')),
hours NUMERIC(7,2) NOT NULL,             -- signed: accrual +, usage −, adjustment ±, forfeit −
balance_after_hours NUMERIC(8,2) NOT NULL, -- running balance stamped at write time
reason TEXT,                              -- REQUIRED (RPC-enforced) for kind='adjustment'
created_at TIMESTAMPTZ DEFAULT now(), created_by_label TEXT NOT NULL
```

- **Balance = last `balance_after_hours`** (ledger is append-only; RPCs compute + stamp inside
  one transaction with a per-employee advisory lock so concurrent writes can't race the running
  balance).
- The ledger IS the per-employee activity page (#58) — no separate audit table.
- `(run_id, employee_id, kind)` UNIQUE for kinds `accrual`/`usage` — a run can never
  double-apply (idempotent completion).
- Voiding a run reverses its ledger rows (compensating entries, kind preserved, negated hours,
  reason `void of run …`) — void-and-clone stays whole-record.

### 2c. New table `qteklink_payroll_email_log` (the §5 safety rail; RPC-write-only)

```
id UUID PK, shop_id INT, run_id UUID, employee_id UUID NULL, kind TEXT NOT NULL
  CHECK (kind IN ('pay_summary','pto_adjustment','pto_negative')),
recipient TEXT NOT NULL, subject TEXT NOT NULL, sent_at TIMESTAMPTZ, status TEXT NOT NULL,
UNIQUE (run_id, employee_id, kind) WHERE kind = 'pay_summary'
```

A pay summary for (run, employee) can exist exactly once — re-completing/retrying can never
double-send, and every send is auditable (who, where, when).

### 2d. Settings (`qteklink_settings.payroll` JSONB — validator extended)

| Key | Shape | Notes |
|---|---|---|
| `pto_tenure_tiers` | `[{ min_years: int ≥ 0, hours_per_period: number ≥ 0 }]` | sorted, min_years unique, must include 0 (#54); sick days folded into the rate numbers |
| `pto_rollover_cap_hours` | number ≥ 0, nullable | null = unlimited carryover (#57) |
| `pto_adjustment_alert_emails` | string[] | adjustment-accepted alerts (#58) |
| `pto_negative_alert_admin_emails` | string[] | negative-balance admin alerts (#59) |

## 3. Accrual engine (pure lib — `src/lib/payroll/pto.ts`, unit-tested like calc.ts)

All functions pure; the DAL feeds employee fields + settings + the run row.

- **Eligibility:** an employee accrues on a run iff `pto_grandfathered` OR the run is their
  ≥ 7th FULL payroll period — full = `start_date ≤ period_start` (a partial hire period never
  counts, #55/#6). Terminated (`termination_date < period_start`) or archived → no accrual.
- **Tier rate:** years of service = whole years between (`pto_tenure_credit_date ??
  start_date`) and the run's `period_start`. Rate = the tier with the greatest
  `min_years ≤ years`. Anniversary crossing therefore lands on the first pay period **after**
  the anniversary (#56 — period_start comparison gives exactly that).
- **Usage:** the run's PTO hours for the employee (w1 + w2, from the frozen snapshot at
  completion — same numbers the sheet paid).
- **Rollover (#57):** on completing the FIRST run whose `period_end` falls in a new calendar
  year (pay-date convention, same as bonus month), if the employee's balance BEFORE that run's
  accrual exceeds `pto_rollover_cap_hours`, write a `rollover_forfeit` entry down to the cap.
- **Projection (dry run, #59):** projected balance = current balance + accrual − entered PTO
  hours; negative projections surface in the dry-run modal with the exact deficit.

## 4. Completion pipeline (extends the existing completion DAL + RPC)

Order inside `completePayrollRun`:

1. Existing Pattern-S confirm + snapshot freeze (unchanged).
2. **Missing-email gate (#53.3):** BEFORE the confirm step, the completion dialog lists
   employees with no `personal_email` — "Go back" (fix on the employees page) or "Skip alert"
   (complete anyway; skipped employees recorded in the completion result and the email log with
   status `skipped_no_email`).
3. Atomically with completion (one transaction): per-employee `accrual` + `usage` ledger
   entries (+ `rollover_forfeit` when the year rolls) via the UNIQUE-guarded RPC.
4. AFTER commit (never blocking the money path, `sendQteklinkEmail` semantics): pay-summary
   emails (§5), negative-balance alerts (employee personal email + admin list), each logged.

**Negative-balance UX (#59, Chris: "it should happen with the dry run"):** the dry-run diff
modal gains a "PTO balances" section — projected per-employee balances with negatives
highlighted ("Clark will go NEGATIVE by 3.5 h"). The completion dialog re-states any employee
still projected negative (defense in depth — dry run is optional). Alerts send at completion,
the moment the balance actually moves.

## 5. Pay-summary email safety (Chris: "we do not want the wrong summary going to the wrong employee — super important")

Layered so a cross-wire is structurally impossible, not just unlikely:

1. **One employee → one isolated render → one message.** No batch templating, no shared
   mutable render context, single recipient per message (never CC/BCC across employees). The
   renderer takes `(snapshotEmployee, recipient)` and nothing else.
2. **Single-source binding:** the summary payload AND the recipient address are read from the
   SAME employee row fetched by `employee_id`; the id travels with the payload end-to-end.
3. **Send-time invariant check:** immediately before dispatch, an assertion compares the
   `employee_id` embedded in the rendered payload against the `employee_id` the recipient was
   resolved from. Mismatch → the send is REFUSED, Sentry error with both ids, run continues
   (fail closed on that one email, loud).
4. **Idempotency + audit:** the email-log UNIQUE constraint (§2c) means (run, employee,
   pay_summary) sends at most once, ever; every attempt is logged with recipient + status.
5. **Human-verifiable content:** subject + body lead with the employee's full name and the
   period ("Pay summary for Matt Clark — Jun 28 – Jul 11"), so a mis-send would be immediately
   self-evident to any recipient.
6. **Tests as regression locks:** a unit test injects a payload/recipient mismatch and asserts
   the send throws; a contract test renders two employees concurrently and asserts zero
   cross-contamination of names/amounts; the completion-flow test asserts exactly one log row
   per employee.
7. Transport: `qteklink-email` edge fn extended with an optional `html` field (plain-text
   fallback retained); one edge-fn deploy.

## 6. UI surfaces (design spec: frontend-design-director → `.claude/work/design/`)

- **Employees page:** new contact/personal fields on the per-family forms; start date;
  grandfather toggle (+ tenure-credit date, revealed only when toggled); PTO balance shown per
  employee; **Adjust** button → modal (signed hours + required reason + preview of resulting
  balance); **Archive** now opens a modal capturing `termination_date` before archiving.
- **Per-employee activity page** (#58 — "easy per-employee page is fine"): the PTO ledger,
  newest first: kind, hours ±, resulting balance, reason, who, when. Linked from the employee
  card.
- **Settings:** tenure-tiers editor (add/remove rows: min years + hours/period), rollover cap,
  the two new alert-email lists (existing email-chips idiom).
- **Run page:** dry-run modal PTO-balances section; completion dialog missing-email +
  still-negative notices.

## 7. Testing

- pto.ts pure engine: eligibility matrix (hire mid-period, exactly 6 vs 7 periods,
  grandfathered, terminated), tier boundaries + anniversary crossing, rollover cap incl. the
  Dec/Jan straddling run, projection math.
- pgTAP: ledger RPC (running balance, adjustment requires reason, UNIQUE double-apply guard,
  void reversal), email-log uniqueness, employees-RPC new-field validation.
- §5 safety tests (mismatch refusal, isolation, one-log-per-employee).
- RTL: adjust modal (reason required, negative preview), archive-termination modal,
  missing-email dialog branches, dry-run balances section, tiers editor.

## 8. Rollout order

1. Migration (employees columns + 2 tables + settings validator) — `supabase db push`.
2. `qteklink-email` edge fn `html` support — deploy.
3. Pure pto.ts engine + DAL + RPCs (TDD).
4. Functional UI, then design polish per the approved spec.
5. Verify gauntlet (typecheck/tests/build + /code-review + review agents) → deploy.
6. Chris: enter start dates + emails, set tiers/rollover/alert emails, seed balances via
   initial-balance adjustments (as of the last pay period). Accrual begins with the first run
   completed in the app — NO retroactive accrual.

# Payroll workbook extraction — source of truth for the qteklink-payroll module

> Extracted 2026-07-10 from `OneDrive - Jeff's Automotive\Work\Admin\Accounting\Pay Sheets\2026\blank.xlsx`
> (the blank bi-weekly template; per-period copies live beside it, named `M-D-YY - M-D-YY.xlsx`).
> Every formula below was read from the file with openpyxl, not inferred.

## Workbook shape

- 20 sheets: 19 employee sheets + 1 deprecated `Summary` (Chris: summary moved per-sheet; module gets a
  summary page per payroll run instead).
- Bi-weekly pay period, two week columns per sheet (`Week One` / `Week Two`).
- Pay-period label lives in `'Cantrell, Jeff'!K5`; every other sheet references it.
- Sheets are protected; **unlocked cells = the manual-entry contract** (inventory below).
- Hidden sheets: `Fazenda, Carlos (W1)`/`(W2)` — an older technician layout, kept but deprecated.
- The `Summary` sheet is stale since ~Sept 2024 (128 cached `#REF!`s) — deprecated, do not replicate.

## Role → sheet layout families (per Chris, 2026-07-10)

| Role | People today | Layout family |
|---|---|---|
| Service Advisor (incl. General Manager, Asst Manager, Service Manager; Tekmetric "service writer" role = Asst Manager) | Zane Elshinawi, Mike Denora, James Wollman | Salary + GP-tier bonus + spiff |
| Office Manager | Marie Aube | Hourly + monthly sales bonus |
| Shop Foreman | George Trilli | Technician layout + shop-hours bonus |
| Technician | Cantrell, Clark, Fuhrer, Snyder Jr, Stoneback, Vasiliou, Williams | Hourly + billed/efficiency |
| Shop Support | Bream, Cerezo, Daniele (open: McCullom?) | Plain hourly (+ optional manual incentive) |
| Office Support | DeCray | Plain hourly |

Everyone is a Tekmetric *technician* except the three Service Advisors + Office Manager (Tekmetric
*service writer* IDs). Employee records need an optional Tekmetric ID (technician or service-writer type).

## Pay math per family (exact, from formulas)

Common to all: OT paid at 1.5× hourly; PTO/Holiday/Bereavement/Training hours × hourly rate
(per week, at that week's rate); all inputs per-week.

### Technician (and Shop Foreman)
- Inputs/week: clock hours, OT hours, billed hours, PTO/Hol/Ber/Trn hours. Rates: hourly + billed (per week).
- Efficiency hours/week = `max(0, billed − (clock + OT))`, paid at the **hourly** rate.
- Billed pay = billed rate × billed hours. Incentive rollup = billed pay + efficiency pay (both weeks).
- Reg Total = hourly×clock + OT pay (both weeks). Total Pay = Reg Total + Incentive + PTO + Trn + Hol + Ber.
- Metrics shown: Pay Per Clock Hour = TotalPay/TotalHours; Cost Per Billed Hour = TotalPay/TotalBilled;
  Productivity = TotalBilled/TotalHours.
- Example rates: Cantrell 23 + 10 billed; Trilli 31.67 + 15 billed.

### Shop Foreman bonus (Trilli) — monthly, bonus-period only
- Inputs: Shop Hour Goal (D29), Hour Bonus $/hr (F29 = 0.50), Bonus Month, Shop Hours (G32).
- `Bonus $ = IF(shopHours > goal, shopHours × rate, 0)` — pays on ALL shop hours once over goal, not the excess.
- Bonus flows into his Incentive rollup.

### Service Advisor — weekly salary + monthly GP-tier bonus + spiff
- Salary/week (Denora & Elshinawi 1,153.84; Wollman 961.53; also McCullom sheet exists 104-unlocked same layout).
- Clock + OT hours still tracked (manual entry) even though salaried.
- Bonus inputs (editable **per payroll**): GP Goal One (115,000), GP Goal Two (125,000), Monthly Sales Goal
  (257,698.74), Bonus Month; Tier1/2/3 % (Denora .005/.008/.012 — Wollman .005/.01/.02 → per-employee);
  Spiff amount (5); Month Sales; 5pack/Flushes count; Month GP without fees; Month GP with fees.
- `Spiff $ = 5packFlushCount × spiffAmount`.
- `Bonus $ = IF(sales>salesGoal AND gpWithFees>gp2, gpWithoutFees×tier3, IF(sales>salesGoal AND gpWithFees>gp1,
  gpWithoutFees×tier2, IF(sales<=salesGoal AND gpWithFees>gp1, gpWithoutFees×tier1, 0)))`
  — tier selected by sales + GP-with-fees; % applied to GP-without-fees.
- Sheet note: "Must hit at least $115,000 Gross Profit as measured on the End of Day Report. Fees will be
  subtracted from total profit for bonus."
- Incentive rollup = Spiff + Bonus. Total Pay = salary×2 + Incentive. (PTO etc. tracked in hours, not paid on top.)

### Office Manager (Aube) — hourly + monthly sales bonus
- Hourly 26.13. Inputs: Month Sales Goal (160,000), % Bonus (0.01), Bonus Month, Month Sales.
- `Bonus $ = IF(monthSales > goal, (monthSales − goal) × pct, 0)` — pays on the EXCESS (unlike foreman).
- Incentive rollup = bonus. Otherwise plain hourly math.

### Shop/Office Support — plain hourly
- Hourly + OT + PTO block; Bream/Daniele have a manual Incentive field; Cerezo/DeCray show a hardcoded 0.

## New-module requirements (Chris, 2026-07-10)

1. Employee management: add/archive; role picker; optional Tekmetric ID (technician vs service-writer type);
   role assignment provisions the matching pay-sheet layout.
2. Auto from Tekmetric: technician **billed hours** per pay period (needs accuracy testing);
   **total sales + GP** for SA bonuses; **5-packs & flushes count** for the service-writer (Asst Mgr) spiff.
3. GP definition for bonuses: `sales − parts cost (Tekmetric) − technician pay (total pay incl. PTO etc.)`.
4. Bonus period slider per payroll run: ON ⇒ compute bonuses (Office Mgr + SAs + Shop Foreman) for the
   **prior calendar month** (July payroll pays June numbers). Bonuses always land in the 2nd pay period of
   the month, but the slider is still required. Goals (GP1/GP2/sales goal) editable per payroll.
5. Manual entry (office manager): clock hours per employee (incl. salaried SAs — hours still tracked),
   OT, PTO/Holiday/Bereavement/Training.
6. Per-payroll summary page — per employee, when applicable: Regular hours, OT hours, Incentive
   (bonuses for SA/foreman/office-mgr; billed-hours pay for technicians — every payroll), PTO, Training,
   Holiday, Bereavement.
7. Dashboard: employees card (hourly/salary, billed rate or n/a, average hourly pay incl. bonuses/billed/OT,
   available PTO, PTO accrual rate) + last-12-payroll-runs card (reg hours+pay, OT hours+pay, billed
   hours+pay, PTO/Ber/Hol/Trn, total bonus pay or n/a) with open-into-read-only per run (each employee
   sheet + summary).
8. Lifecycle: office manager marks run complete after entry into the payroll system ⇒ locked read-only forever.
9. PTO accrual = phase 2 (next), but dashboard already displays available PTO + accrual rate.

## Tekmetric API surface (from .claude/work/planning/references/TEKMETRIC_API_DOCS.md)

- `GET /api/v1/employees?shop=` → employees with `employeeRole` (technician vs service writer) — the ID picker.
- Repair orders / jobs carry `technicianId`, `laborHours`, `loggedHours`; labor lines carry
  `technicianId`, `hours`, `complete`; `PUT /api/v1/jobs/{id}/job-clock` exists (logged time).
- Parts carry `cost` (wholesale, cents) and `retail` → parts-cost side of GP.
- Billed-hours attribution (job-level `laborHours` vs labor-line `hours`, and posted-date bucketing)
  is THE accuracy-testing question.

## App recon (Explore agent, 2026-07-10 — verified findings)

- **Data already mirrored:** `tekmetric_ros*` tables (migration `20260703010000_tekmetric_ro_mirror.sql`)
  hold per-RO `technician_id`/`service_writer_id`/`total_sales_cents`/`posted_date`, per-job + per-labor-line
  `technician_id` + `hours`, and per-part `cost_cents`/`retail_cents` → billed hours, sales, parts cost, and
  service-writer attribution are all derivable without new Tekmetric endpoints.
- **Ingestion gap:** the mirror is populated by `scheduler-app/scripts/tekmetric/sync-ros.mjs`
  (manual run, watermark incremental, via the `tekmetric-api-testing` edge fn) — NOT scheduled, NOT part of
  qteklink's nightly cron. Payroll needs a recurring ingest (promote to cron or fold into qteklink nightly-sync).
- **No employee registry anywhere** — bare `technician_id` bigints. The module owns employees/rates/runs.
- **Roles exist in qteklink:** `viewer | approver | admin` (`src/lib/auth.ts`, enforced in actions/RPCs) —
  payroll access control can build on this.
- **Conventions to follow:** new `qteklink_*` tables = shop_id + realm_id, BIGINT cents, RPC-write-only
  (service_role SELECT-only, SECURITY DEFINER write RPCs — model: `20260607090000_qteklink_settings_ro_state.sql`);
  UI = shadcn-style primitives in `src/components/ui/`, nav tab added in `app/QtlTabs.tsx`, page idiom =
  `requireQtekUser()` → DAL → Cards (templates: `app/settings/page.tsx`, `app/mappings/page.tsx`);
  Tekmetric client = `src/lib/tekmetric/client.ts` (`GET /employees` not yet used — needed for the ID picker).

## DECISIONS — Chris, 2026-07-10 (locked; supersede anything above where they conflict)

1. **Roster:** employees added AFTER the app ships — no seeding. Roles: General Manager (Zane),
   Service Manager (James), Asst Manager (Mike), Office Manager (Marie), Shop Foreman (George),
   Technicians, Shop Support (Pat Daniele, Tyler, etc.), Office Support (John DeCray).
   **All service writers (GM + Service Mgr + Asst Mgr) receive the spiffs.**
2. **GP month bucketing:** straddling payrolls prorate by DAYS — the June days of a straddling run count
   toward June GP. "Technician pay" in GP includes Technician + **Shop Foreman + Shop Support** roles.
3. **Fees model kept:** tier qualifies on GP-WITH-fees; payout % applies to GP-WITHOUT-fees.
   Total sales is PRE-TAX. (Open: exact fee set definition — pin via backtest, below.)
4. **Foreman shop hours:** total shop billed hours for the previous month (auto).
5. **Slider:** manual per-run toggle, ON ⇒ bonuses computed from prior calendar month. Confirmed.
6. **OT:** auto-derived — clock > 40/week; OT pay = 1.5 × regular hourly pay. (No separate OT entry.)
7. **Billed-hours rule:** labor hours on ROs POSTED within the pay period, attributed by labor-line
   technician_id; validated by backtesting real filled workbooks (e.g. 6-14-26 - 6-27-26.xlsx). Confirmed.
8. **5-packs/flushes:** identified by job CATEGORY. VERIFIED in mirror: `tekmetric_ro_jobs.job_category_name`
   (indexed) — live values `5PACK`, `5 PACK SYNTHETIC REDEMPTION`, `5 PACK SYN BLEND REDEMPTION`,
   `FLUID FLUSHES`, `FLUID FLUSH 2`, `FLUID FLUSH 3`, `FLUID FLUSH ADD ON ` (trailing space).
   → make the counted-category set CONFIG (mappings-page idiom); default set needs Chris's pick
   (sales-only vs redemptions too).
9. **Avg hourly pay:** last-12-runs window, clock hours denominator. Confirmed.
10. **Access:** anyone with qteklink access (today: Chris + Marie). Everyone gets all three roles
    (viewer/approver/admin) — no extra payroll gate.
11. **PTO (phase 1):** available balance + accrual rate are manual per-employee fields; accrual engine = phase 2.
12. **Pay periods:** Sun–Sat bi-weekly anchored to 6-28-26 → 7-11-26, auto-generated. Confirmed.
13. **SAFETY NET (new requirement):** a completed payroll is IMMUTABLE — numbers frozen at completion
    (snapshot), never recomputed, even if Tekmetric data changes afterward.

### Round-2 decisions (Chris, 2026-07-10 evening)

14. **Fees = Tekmetric's RO-level `feeTotal`** (RO fees + job-line fees rolled up by Tekmetric).
    VERIFIED: present on 823/823 recent raw payloads, mirrored as `tekmetric_ros.fee_total_cents`.
    Month fees = Σ fee_total_cents over ROs posted in month (June 2026 = $13,231.45). Phase-3 backtest
    reconciles the 241/772 ROs where feeTotal ≠ job+RO fee-line sum (suspect declined-job fees).
15. **Spiff config card** (payroll settings page): all observed job categories listed in three columns,
    each with a toggle (counted in spiffs) + a NUMBER DROPDOWN = spiffs-per-job multiplier (e.g.
    FLUID FLUSH 2 = 2 spiffs = $10, because multiple flushes ride one job line). Spiff $ per SA =
    Σ(counted jobs × category multiplier) × spiff amount. **New-category catcher:** as new
    job_category_name values appear in the mirror, they surface on the card automatically (default:
    not counted, multiplier 1, flagged "new").
16. **OT threshold:** worked clock hours only (PTO/Holiday/etc. never trigger OT). Confirmed.
17. **Straddle proration (approximation, fine for now):** daily hours = week hours ÷ 5 (same for derived
    OT); month-side share = daily hours × that month's days in the straddling week (capped at 5).
    Will be superseded by the future time module.
18. **Void-and-clone IS built in** (reversal of plan open-Q5 default): voiding a completed run keeps it
    forever (status `voided`, still immutable, full record) and clones its inputs into a new open run for
    the same period. Every void is recorded (who/when/why).
19. **Email alerts** (recipients assigned on the payroll settings page, two separate lists):
    (a) void-and-clone events, (b) payroll completed. Reuse qteklink email infra.

20. **THE AUTHORIZED FILTER (verified 2026-07-10, Chris's theory confirmed 772/772):** every rollup in
    the module — billed hours, labor sales, parts sales/cost, fees, spiff counts — MUST filter jobs to
    `authorized IS TRUE` (labor lines / parts / job fees filter through their parent job). Evidence, all
    June-2026 posted ROs (n=772): `ro.fee_total_cents = Σ authorized-job fees + Σ RO fee lines` 772/772;
    `ro.labor_sales_cents = Σ authorized-job labor` 772/772; `ro.parts_sales_cents` 772/772.
    `selected` is NOT the right flag (535/772). **Stakes:** June posted ROs carry 1,176.7 authorized
    labor hours vs 1,269.6 hours on declined jobs — unfiltered billed hours would be >2× wrong.
    This closes the round-2 fee-reconciliation mystery (the 241 mismatches were declined-job fees).

21. **BACKTEST RESULTS (2026-07-10 — the phase-3 accuracy gate, run against the freshly-synced mirror):**
    - **Billed hours: EXACT.** 6-14→6-27 period, per-week per-technician labor-line rollup (authorized
      filter, posted-date bucketing) matches the workbook to the hundredth for all 6 techs paid on billed
      hours (Cantrell/Clark/Fuhrer/Trilli/Vasiliou/Williams — Δ 0.00 every week). Snyder (+15.07h) and
      Stoneback (+43.62h) show 0 in the workbook but real Tekmetric hours — they're not paid on billed
      hours (Stoneback = Shop Support per Chris; Snyder same treatment), not an attribution error.
    - **Month sales definition PINNED:** workbook "Month Sales" = Σ(totalSales − taxes − FEES) over ROs
      posted in month. Residuals: Jun $13.86, Apr $50.36, May $445.70 (May consistent with post-entry RO
      edits; mirror now more accurate than the hand-transcribed snapshot).
    - **Fees:** wb implied fees (GPwith−GPwithout) vs Σ feeTotal: Jun Δ$13.86, May Δ$40.21, Apr Δ$51.31 —
      same bucket-shift items as the sales residual (a few fee items counted as sales in the EOD report).
    - **GP semantics pinned from data:** GPwith = (sales excl. fees) − parts − laborPay;
      GPwithout = GPwith − fees. Implied June labor pay $50,764.76 vs fixture-computed tech+foreman+support
      ≈ $49,657 (crude proration; 6-28 week-2 not yet entered) — closes within 2.2%.
    - **Vendor drift caught + fixed:** Tekmetric now REQUIRES ZonedDateTime (2026-07-01T00:00:00Z) on
      start/updatedDateStart/postedDateStart|End — bare YYYY-MM-DD rejected (worked 7/3, broken by 7/10).
      Fixed in sync-ros.mjs + mirror-ingest.ts (+ tests). Live-probed all three params.
    - Spiff sanity (from fixtures): spiff $ = count × $5 exactly; SA tier3 payouts divide to each SA's
      personal tier pct exactly (Zane 3%, Wollman 2%, Denora 1.2%).

### Round-3 decisions (Chris, 2026-07-10 late — SUPERSEDE #3 tier mechanics + Quirk-B interpretation)

22. **SA tier semantics (corrected):** "sales goal" = LAST YEAR'S same-month sales (subtotal = sales −
    tax). Tier 1 = did NOT beat last year AND GP-with-fees ≥ GP goal 1 (lowest %). Tier 2 = beat last
    year AND GP-with-fees ≥ GP goal 1. Tier 3 = beat last year AND GP-with-fees ≥ GP goal 2 (highest %).
    Payout % applies to GP-WITHOUT-fees. GP comparisons are ≥ (Chris's worked example: GPwith exactly
    125,000 = goal 2 ⇒ tier 3; 123,000 × 1.2% = $1,476). "Beat" on sales stays strictly >.
    NOTE: "subtotal / sales − tax" per Chris = the backtest-pinned Σ(totalSales − taxes − fees) —
    Tekmetric's subtotal excludes fee lines; matched the workbook to ~$14/mo across 3 months.
23. **Sales goal AUTO-PREFILLED** on bonus runs from Tekmetric = prior-year same-month subtotal (mirror
    has data from 2023-11). Marie never types it. Overridable like other auto values.
24. **Leave pay for billed-hours employees (technicians + foreman) — Quirk B was POLICY, not typos:**
    PTO / Holiday / Bereavement are paid at the employee's AVERAGE HOURLY PAY; Training at the regular
    hourly rate. George's average for this purpose EXCLUDES his monthly bonus.
    Module definition (needs Chris's confirmation of the window): without-bonus average over the LAST 12
    COMPLETED runs (Σ base+OT+billed+efficiency pay ÷ Σ clock hours); fallback when no history = the
    current run's ex-bonus ex-leave rate; always displayed + overridable per entry. FORENSIC NOTE: the
    hand-typed workbook rates match NO window computable from the sheets (e.g. Williams paid $45.87 vs
    $48–62 across candidate windows) — presumed external payroll-system figure; flagged to Chris.
25. **Average hourly pay metric: TWO variants** — with-bonus and without-bonus — for bonus-receiving
    employees (SAs, office manager, foreman); everyone else shows N/A for the with-bonus column.
26. **Run-level pay-config edits WRITE THROUGH to the employee record** (GP goals, hourly/billed/salary
    rates, tier %s, etc.): change it on one payroll and every future payroll prefills the new value.
    (Interim behavior until the future employee-pages with effective-dated changes.)
27. Automate everything automatable — standing directive.

### Round-4 decisions (Chris, 2026-07-10 latest)

28. **Monthly sales INCLUDE fees** (supersedes the fee-excluded NOTE in #22 and the #21 "pinned"
    definition as a deliberate go-forward change): subtotal = Σ(totalSales − taxes) over posted ROs —
    fees stay in. Applies everywhere: current month, the prior-year auto sales goal, GP-with-fees base.
    The historical workbooks matched the fee-EXCLUDED number; the app intentionally differs.
29. **Leave-rate seeding** (Marie's payroll-system averages): entered via the Chris+Claude script
    `qteklink-app/scripts/payroll-seed-leave-rates.mjs` — NEVER in-app. Update-only (cannot create
    employees — app-live-first rule); dry-run default; entries validated against the shop's bi-weekly
    anchor cadence + no future dates; warns about open runs (they snapshotted pay_config pre-seed).
    Storage: pay_config.leave_rate_seed_history [{period_start, work_pay_cents, clock_hours}] (≤26) +
    optional leave_rate_seed_cents_per_hour single-rate fallback. Window = most recent 12 periods across
    real completed runs ∪ seeds (real run beats same-period seed; old entries age out). Write-through
    (#26) never deletes seed keys merely absent from a run edit.

30. **Module shell (Chris, 2026-07-10 evening):** qteklink-app restructures like admin-app — post-login
    landing at `/` shows the available MODULES as cards (QBO Link, Payroll); each module gets its own
    tab set. Payroll's tabs = Dashboard, Employees, Settings (runs reachable from the dashboard). QBO
    Link keeps Dashboard/Approvals/Postings/Mappings/Settings. CONSTRAINT: existing QBO URLs do not
    move (office-manager emails deep-link /approvals/[date]) — navigation-presentation restructure only.
31. **Summary shows leave-pay DOLLARS** (Chris): PTO/Training/Holiday/Bereavement pay dollars alongside
    hours, on screen and on the printed sheet.

### Remaining open items

- **Mirror ingest scheduling:** promote `sync-ros.mjs` logic to a recurring job (fold into qteklink
  nightly cron — in plan). Mirror currently fresh only to 2026-07-02.
- Phase-3 backtest: per-technician billed-hours attribution vs filled workbooks (job.technician_id vs
  labor-line technician_id; line-hours vs job labor_hours) + GP-vs-workbook diff. Fee rollup: RESOLVED (#20).

## Unlocked-cell inventory (manual-entry contract per family)

- Technician: rates E7:H8/Q7:T8; clock E10:F11/Q10:R11; OT J10:K11/V10:W11; billed E12:F13/Q12:R13;
  PTO-block C16:J17/O16:V17. Cantrell only: K5:N6 (pay-period label).
- Trilli extra: D29:I30 (goal/rate/month) + G32:H33 (shop hours).
- SA: salary F7:G8/R7:S8; clock/OT same rows; PTO-block C14:J15/O14:V15; goals C26:J27; tiers+spiff C30:J31;
  month sales + 5pack count E33:F34/J33:K34; GP w/o + w/ fees E36:F37/J36:K37.
- Office Mgr (Aube): hourly-family + D25:I26 (goal/%/month) + G28:H29 (month sales).
- Support: rate, clock, OT, PTO-block (+ Bream/Daniele manual incentive E27:F28).

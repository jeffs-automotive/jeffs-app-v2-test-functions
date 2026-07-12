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

### Round-5 decisions (Chris, 2026-07-11)

32. **Foreman (George) shop-hour goal = LAST YEAR same-month shop hours, auto from Tekmetric** (like the
    SA sales goal): bonus pays when this month's shop hours beat last year's by ≥ 0.01 (strict > at 2dp).
    pay_config.shop_hour_goal becomes legacy fallback (no prior-year data); overridable per run.
33. **Bonus month derives from the PAY DATE, not period start:** run 6/28–7/11 is paid in July ⇒ bonus
    month = June (was wrongly deriving May from period_start). Rule: bonus_month = month of period_end
    − 1 month. FALLBACK: office manager can explicitly pick the bonus month on the run (app auto-chooses;
    the picker is the escape hatch).
34. **QBO P&L GP test (2026-07-11, June live data) — WORKS:**
    - QBO June GP = **$172,863.37** (income $286,852.25 − COGS $113,988.88; COGS INCLUDES
      `6010 Technicians` $48,740.72 — the payroll expense our app-side GP lacked).
    - vs workbook GP-with-fees $171,090.87 → Δ $1,772.50 (1.0%). NOTE: QBO GP includes $577.62
      non-shop income (interest+misc).
    - June QTL-FEE (CC-processing) JEs from our ledger: **$7,101.34** (28 fee days) →
      QBO GP − CC fees = $165,762.03.
    - **FEES AMBIGUITY (needs Chris):** the workbook's "GP without fees" subtracted RO FEE-LINE REVENUE
      (~$13.2k: shop supplies 409 + hazmat 411 + TPP 413 = $12,802.82 in QBO income accounts) — NOT the
      CC-processing fees ($7,101.34) our QTL-FEE JEs carry. Candidates for the go-forward bonus base:
      (a) QBO GP − CC-fee JEs = $165,762.03; (b) QBO GP − RO-fee income = $160,060.55; (c) both = $152,959.21.
      Workbook's old number was $157,875.10 (different baseline).
    - Integration path when adopted: qteklink already holds QBO OAuth — server-side
      `GET /v3/company/{realm}/reports/ProfitAndLoss?start_date&end_date`, parse GrossProfit; fee JE
      totals from qteklink_daily_postings.

35. **GP SOURCE = QBO P&L (Chris, 2026-07-11, supersedes the fee ambiguity in #34):** NOT the CC fees.
    "Fees" = the Tekmetric RO fee lines (the `kind='fee'` constituents in our daily SALES JEs — shop
    supplies/hazmat/disposal/TPP etc.) ≡ the already-pinned `monthFeesCents` (Σ mirror feeTotal).
    Bonus GP inputs become: **GP-with-fees = QBO P&L Gross Profit for the bonus month** (COGS already
    contains technician payroll, e.g. June `6010 Technicians` $48,740.72);
    **GP-without-fees = QBO GP − monthFeesCents**.
    June proof: $172,863.37 − $13,229.63 = **$159,633.74** (workbook's manual method said $157,875.10;
    Δ ≈ 1% is the QBO-vs-EOD baseline difference, accepted).
    Implementation: server-side `GET /v3/company/{realm}/reports/ProfitAndLoss` via qteklink's existing
    QBO client; computed sales−parts−labor GP remains only as the provenance-labeled fallback when QBO
    is unreachable; overrides still win. Tier check's SALES side stays the Tekmetric subtotal (#28).

36. **Month sales displays AFTER FEES (Chris 2026-07-11 — REVERSES #28):** the bonus panel's month
    sales (current AND the auto prior-year goal) = Σ(totalSales − taxes − fees) — the original
    backtest-pinned subtotal. June = $273,061.13.
37. **PARTS COST FORMULA (pinned penny-exact vs Chris's June breakdown):**
    `Σ round(part.cost_cents × quantity)` over AUTHORIZED jobs (per-line rounding; tires + batteries live
    in the parts table) **+ Σ sublet item cost_cents** (RO-level sublets, posted ROs).
    June: 69,080.90 + 290.00 = **$69,370.90** — matches Chris's parts 53,434.56 / tires 13,191.60 /
    batteries 2,454.74 / sublet 290.00 exactly. The old Σ cost_cents (un-weighted, no sublets) was
    $51,219.36 — $18,151.54 understated. GP-before-labor proof: 286,290.76 − 69,370.90 = 216,919.86
    (with fees) ✓; − mirror fees 13,229.63 = 203,690.23 vs Chris's EOD-based 203,704.09 (Δ13.86 = the
    known #21 fee-classification quirk).

38. **TECH COST FROM QBO — final GP composition (Chris 2026-07-11, SUPERSEDES #35's direct-QBO-GP):**
    QBO supplies ONLY the technician cost (the P&L COGS row `6010 Technicians`); sales/parts stay
    Tekmetric (penny-exact per #36/#37). Confirmed via explicit A/B (double-count risk surfaced):
    **GP_with_fees = monthSales(incl fees, internal) − partsCost(#37) − QBO 6010 tech cost**;
    **GP_without_fees = GP_with_fees − monthFees**. June: 216,919.86 − 48,740.72 = **$168,179.14** with;
    − mirror fees 13,229.63 = **$154,949.51** without (Chris's EOD-fee version: $154,963.37).
    The QBO P&L fetch (#35 plumbing) stays — parse target becomes the 6010 row, not GrossProfit;
    the app-computed labor proration remains only as the labeled fallback when QBO is unreachable.

### Round-7 decisions (Chris, 2026-07-11 — live-numbers architecture)

39. **Billed-hours basis → RO COMPLETED date (shop-local)** for per-tech billed hours + the foreman's
    shop total (+ the prior-year goal, same basis for apples-to-apples). PROOF: Chris's Tekmetric report
    screenshots (6/28–7/4 + 7/5–7/11) reproduce EXACTLY under completed-date bucketing (w2: Trilli 55.05,
    Fuhrer 49.43, Vasiliou 45.90, Stoneback 11.87 — posted-basis was under by the completed-not-yet-posted
    work). Money rollups (sales, fees, parts, GP, spiffs) STAY posted-basis (accounting side,
    backtested penny-exact). Rationale: matches the report Marie reconciles against; credits work when
    performed; converges with posted once periods settle.
40. **Webhook-driven mirror + auto-recompute (Chris: "we receive webhooks with the jsonB and should use
    them... automatic, as the day goes")**: RO webhook payloads apply into the tekmetric_ros* mirror
    (single-sourced TS mappers — no duplicated mapping logic), affected OPEN runs marked stale and
    recomputed debounced into a stored LIVE SNAPSHOT. Backstops: nightly ingest, dry-run button, manual
    refresh. Completion (Pattern S) ALWAYS recomputes fresh in-transaction — the live snapshot is
    display-only and can never freeze stale money.
41. **Instant tabs:** run tabs (entry grid / pay sheets / summary) read the stored live snapshot and
    switch client-side — no per-tab recompute (was 10–20s: full derivation chain + live QBO P&L call per
    tab switch). Entry edits recompute inline for that run; QBO tech-cost cached per (realm, month) in
    the snapshot, refreshed by dry-run/nightly/manual.
42. **DRY-RUN button** (bottom of the pay sheet page): live-fetches ALL period-touched ROs from Tekmetric
    (paged list endpoint — API TESTED 2026-07-11: NO batch-by-ids param exists (unknown params silently
    ignored — returns the full 148k dataset; guard against this), no completedDate filter; page size
    hard-capped at 100 → a period = ~4 posted-range pages + updated-since pages), applies to the mirror,
    recomputes, and diffs vs the previous numbers → modal listing every difference + ACCEPT → commits the
    refreshed snapshot and navigates to the Summary tab.

43. **ONE SAVE BUTTON on the entry grid (Chris, 2026-07-11)** — not per-employee. The grid collects all
    dirty cells client-side; a single Save submits them as ONE ATOMIC batch (new
    `qteklink_payroll_update_entries(run_id, patches[])` RPC — all rows in one transaction, per the
    non-atomic-multi-write invariant; per-row validation/audit preserved) followed by ONE recompute +
    live-snapshot store. Unsaved-changes indicator + leave-guard. Implements as round-8 immediately
    after round-7 lands (the entry grid is being rebuilt in-flight there).

### Round-9 decisions (Chris, 2026-07-11 late)

44. **Efficiency pay requires clock hours > 1** (guards the inflated-efficiency case: near-zero clock +
    billed hours → huge phantom efficiency). Implemented per WEEK: week's efficiency = 0 unless that
    week's clock hours > 1. (Interpretation flagged to Chris: per-week, matching the formula's grain.)
    **Addendum (Chris): PTO/holiday/bereavement/training hours NEVER enter the efficiency calculation** —
    not in the billed−clock formula (efficiency compares against WORKED clock only) and not toward the
    >1 threshold (leave hours cannot rescue it: clock 0.5 + PTO 39.5 ⇒ zero efficiency). Test-asserted.
45. **Monthly sales = total sales − tax, FEES STAY IN (supersedes #36; restores #28's sales number):**
    the with-fees/without-fees split applies to GP ONLY (#38 unchanged). Month sales display + SA tier
    check + prior-year auto goal all use Σ(totalSales − taxes). June = $286,290.76.
46. **Payroll TOTALS card at the bottom of the Summary page** (replaces the summary table's TOTAL line):
    grand total pay; total reg-hour pay / OT pay / incentive pay; total PTO / holiday / bereavement /
    training PAY; total reg / OT / PTO / holiday / bereavement / training / billed HOURS; total cost per
    clock hour (= total pay ÷ total clock hours, n/a on zero). Server-computed (summary.ts → snapshot),
    prints with the sheet.
47. **Total cost per billed hour on the totals card** (Chris verbatim: "Include all pay in this like you
    would the cost per clock hour"): = total pay (ALL pay, same numerator as #46's clock metric) ÷ total
    billed hours; n/a when the run has no billed hours (never Infinity/$0.00). CALC_VERSION 5 → 6 so open
    runs backfill it on next view; pre-#47 snapshot blocks parse via `.default(null)`.

### Round-10 decisions (Chris, 2026-07-12)

- ~~CONFIRMED: office-manager (Marie) bonus base = monthly sales WITH fees~~ — **RETRACTED by Chris
  same day ("I made a mistake"); superseded by #49.**
48. **Per-employee TOTAL column on the summary table** (right-most, emphasized): the row's grand total
    pay so Marie can match each employee against the external payroll system. Pure display of the
    snapshot's existing `total_pay_cents` — no math, no schema/CALC_VERSION change; old frozen snapshots
    render it (the field has been in every snapshot since round 2). Never n/a ($0.00 total is real
    matching information).
49. **Office-manager (Marie) bonus base = monthly sales BEFORE fees** (Chris, correcting the earlier
    same-day confirmation): her family's effective `month_sales_cents` = sales(#45) − fees; her bonus
    stays (base − goal)⁺ × pct. HER base only — the SA tier check, the month-sales display, and the
    prior-year auto goal all stay fee-INCLUSIVE per #45. Fed at the DAL assembly layer (pass 1);
    calc engine unchanged; per-entry `month_sales_cents` override still beats it. Her bonus panel
    label reads "Month sales (less fees)". CALC_VERSION 6 → 7 rolls the corrected input into the open
    run's live snapshot on next view. June effect: base 286,290.76 → 273,061.13 (−$13,229.63).
50. **HOURS bucket by POSTED date when posted, COMPLETED date otherwise (supersedes #39's
    pure-completed basis).** Root cause of Clark's ±1.00 week swap (NOT a timezone issue — mirror
    verified identical to the live Tekmetric API): RO 153870 (Clark 1.0h) completed Fri 7/3 5:08 PM ET
    but posted Mon 7/6; the Tekmetric report shows it in the POSTED week. Round-7's exact match held
    only because no RO straddled a week boundary then — this RO revealed the report's true rule.
    Full-window sweep: exactly TWO straddlers (153870 + 152158: Snyder 0.3h completed 5/28, posted
    7/10 — no pay effect, Snyder isn't billed-paid). Hybrid basis verified against the mirror:
    Clark w1 35.35 / w2 64.60 EXACT (Chris's numbers). Applied consistently to per-tech billed hours,
    the foreman month shop total, and the prior-year hour goal; completed-but-unposted ROs still count
    when performed (#39's point survives). Money derivations unchanged (posted, penny-exact).
    CALC_VERSION 7 → 8. Chris chose posted-basis over keep-completed when offered both.
    **Superseded same day by #51 (the completed fallback is gone too).**
51. **HOURS ARE POSTED-ONLY — NO completed-date fallback (Chris verbatim: "we only count billed hours
    and sales as posted. We dont use completed status… I dont want this to be a fallback"; supersedes
    #39 AND #50's hybrid):** every derivation — hours AND money — buckets by POSTED date, shop-local;
    an unposted RO counts nowhere until it posts, then counts in whichever period the posted date
    lands. Completed status is now unused by ALL rollup logic (the mirror still stores completed_date
    as a column; `fetchHoursBasisRos`/`rosInLocalRangeHoursBasis` deleted). Verified: posted-only
    reproduces Clark w1 35.35 / w2 64.60 exactly (zero completed-but-unposted ROs in the current
    window, so #50 → #51 changes nothing today; the behavioral difference appears mid-week when work
    finishes before posting — it no longer shows until posted). CALC_VERSION 8 → 9.

### Remaining open items

- **Alert emails** (void/clone + completed notifications): the ONE settings item Chris hasn't entered
  yet (2026-07-12 — employees, anchor, spiff categories all done).
- **PTO portion = the next feature phase** (Chris, 2026-07-12: "After this is finished we should be
  set and can start working on the pto portion").
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

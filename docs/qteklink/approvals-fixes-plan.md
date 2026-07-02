# QTekLink Daily Approvals — fixes plan (`qteklink-approvals-fixes`)

**Worktree:** `~/worktrees/qteklink-fixes` (branch `qteklink-fixes`, qteklink module lock held)
**Phase:** plan · **Date:** 2026-06-24
**Research:** [`docs/qteklink/approvals-posted-state-research-2026-06-24.md`](approvals-posted-state-research-2026-06-24.md)
**Design spec:** `.claude/work/design/qteklink-approvals-fixes-spec.md` (frontend-design-director, 2026-06-24)

## Why
Two `/approvals` issues Chris flagged 2026-06-24:
1. A **fully-posted day still shows the live "Approve + post this day" button** — `page.tsx:168` gates the
   controls on `!isAcknowledged` only, ignoring `hasPosted` (9 days, 06-13…06-23, currently affected).
   It should show an **"Approved & posted to QuickBooks"** status instead.
2. The **"Mark as covered by Accounting Link" card** is retired — QTekLink now posts every day.

## Locked decisions (Chris, 2026-06-24)
- **No re-post/update button on posted days.** VERIFIED: payments/fees are immutable once swept into a QBO
  deposit (6540 `deposit_locked`); sales corrections to posted days **auto-post nightly** via
  `sweepPostedDays` regardless of `auto_post`. Only **first-time** posting is manual (the button on open
  days). So "posted" is a terminal success state, not an action surface.
- **Accounting Link: card only, keep banner.** Remove the action card so no new days can be acknowledged;
  KEEP the "Covered by Accounting Link" banner + the `isAcknowledged` gate for the ~20 historical
  acknowledged days. **Keep** the `acknowledge-day` action + DAL RPC (just unreferenced from the UI).
- **Full design spec** produced and to be followed (burgundy posted panel, distinct from the emerald
  legacy banner; calm posted-day KPIs; shared 3-state banner grammar).
- **Include** the optional staged-correction footnote ("a change was detected — it posts automatically
  tonight. No action needed.") — it directly reinforces the auto-correction model. Omittable if Chris vetoes.

## Day-state model (all derivable from data the page already fetches — no DAL/contract change)
| State | Detection (existing on page) | Surface | Approve button |
|---|---|---|---|
| Open / not posted | `!isAcknowledged && !hasPosted` | (none above table) | **Yes** — `ApproveDayControls` (unchanged) |
| Posted | `hasPosted` | NEW burgundy "Approved & posted to QuickBooks" panel | **No** |
| Acknowledged (legacy) | `isAcknowledged` | EXISTING emerald banner (lightly harmonized) | No (already) |

`hasPosted` (`page.tsx:84`) and `isAcknowledged` (`page.tsx:85`) stay **byte-identical** — we only add the
new render branch + the `&& !hasPosted` gate (behavior-parity safety).

## File-by-file change list (implement phase)
1. **`qteklink-app/src/lib/approvals/day-status.ts`** — NEW, pure + unit-testable. `deriveApprovalsDayStatus(postings)`
   → `{ jeCount, anyCorrectionStaged }`, computed via the already-exported pure `buildDailyStatusIndex`
   (`daily-postings.ts`). Presentational only; no DAL call, no contract change. (TDD: test written first.)
2. **`qteklink-app/src/lib/approvals/__tests__/day-status.test.ts`** — NEW. Vitest unit tests:
   - all-3-categories posted → `jeCount === 3`, `anyCorrectionStaged === false`
   - a staged correction over a posted category → `anyCorrectionStaged === true`
   - delete-posted / empty category not counted in `jeCount`
   - acknowledged-only / open-only inputs → `jeCount === 0`
3. **`qteklink-app/app/approvals/page.tsx`** — per spec §4/§5/§6/§15:
   - Add the **posted panel** (burgundy, `bg-primary/5` + `text-primary` + `bg-primary` icon chip,
     `CheckCircle2`) above the KPI grid, gated `!isAcknowledged && hasPosted`; reassurance line uses
     `jeCount` (fallback static text when 0); optional staged-correction footnote when `anyCorrectionStaged`;
     right slot = muted "Posted · …" meta (NOT a second breakdown button — keep the footer link).
   - Add `&& !hasPosted` to the `ApproveDayControls` render gate (the bug fix).
   - Remove the Accounting-Link `<Card>` block (`:171-181`) + the `import AcknowledgeDayButton` (`:20`).
   - Lightly harmonize the acknowledged banner (size-9 rounded-md emerald chip + bold heading) — palette
     unchanged (stays emerald).
   - Calm posted-day KPIs: pass a `posted` flag to `Kpi` → `bg-muted/30` fill (one conditional class).
   - Import `deriveApprovalsDayStatus` (+ `buildDailyStatusIndex` is used inside it).
4. **`qteklink-app/app/approvals/AcknowledgeDayButton.tsx`** — becomes **orphaned**. Do NOT delete in this
   change; flag for `dead-code-review` at verify. (The action/DAL stay.)
5. **Tests touched:** no existing `page.tsx` render test (only `__tests__/DateNav.test.tsx`). The RSC isn't
   Vitest-renderable (async server component) — coverage for the new behavior lands on the pure
   `day-status` helper (#2). E2E assertion (posted day shows the panel, not the button) noted as optional
   Playwright follow-up.

## Out of scope / NOT touched
`requireQtekUser`, `getDailySnapshot`, `listDailyPostingsForDay`, the posting state machine,
`ApproveDayControls`' dry-run/confirm/`scopeHash` wiring, `acknowledgeDayAction` + its DAL RPC, the OKLCH
token set (`globals.css`), `force-dynamic`. No new tokens.

## Phasing
Single coherent commit (or two: helper+test, then page). Small surface; no migration; no edge-fn change.

## Verification (verify phase)
- `npm run typecheck` (qteklink-app) clean.
- `npx vitest run` — new `day-status` tests pass; existing suite green.
- `npm run build` (qteklink-app) clean.
- **`/code-review`** fail-closed gate (45 atomic agents) blocker-free.
- **UI design-diff hard gate** (model opus): `design-review` + `wiring-review` + `dead-code-review`
  (the orphaned `AcknowledgeDayButton`) + `behavior-parity-review` (the `&& !hasPosted` gate + the
  removed card must change *display only*) — all blocker-free before `/feature-done`.
- Eyeball light + dark, phone width: posted panel legible/distinct from emerald; open day's approve card
  is the single final admin card with no gap; staged-correction footnote calm (not amber).

## Open questions
- None blocking. The staged-correction footnote is the one omittable piece (included by default).

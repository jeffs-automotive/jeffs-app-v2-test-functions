# frontend-redesign — implementation plan

> Feature: `frontend-redesign` (plan phase, 2026-06-11). Restyle all three apps using the
> frontend design agent suite. **Hard contract: design-and-wiring-only — everything works
> exactly the same as it does now; it only looks better.**
>
> Canonical per-file detail lives in the three director specs (research artifacts):
> - `.claude/work/design/scheduler-app-redesign-spec.md` — Heritage Editorial polish pass
> - `.claude/work/design/admin-app-redesign-spec.md` — "Workshop Brass"
> - `.claude/work/design/qteklink-app-redesign-spec.md` — converge on admin-app's system
>
> This plan consolidates: order of work, scope boundaries, verification gates, and the
> decisions Chris must make.

## Why

Chris's directive: take the current apps and transform them into professionally designed
products without changing any functional code. The three apps currently sit at three different
maturity levels: scheduler-app has a deliberate custom system needing polish; admin-app has the
right architecture shipping default-shadcn values; qteklink-app has the right tokens that no
component uses (46 hardcoded `#96003C`, a shared `btn` string, no primitives).

## Locked decisions

1. **Per-app design directions** (from the approved specs):
   - scheduler-app: EXTEND Heritage Editorial — real shadow scale, 4-phase progress ribbon
     (honest for all branches; no numeric counter), AA fixes (tertiary text 3.76:1→5.13:1,
     input borders 1.43:1→3.04:1), success-state finish, 7 latent dead-class bug fixes.
     No shadcn, no icon lib, no font change, no new deps.
   - admin-app: "Workshop Brass" — token VALUES only (warm paper neutral ramp, 8px radius,
     warm shadow scale, Geist actually applied + Geist Mono on numerics), StatusBadge
     vocabulary (color+icon), line-variant tabs, route skeletons + designed empty states.
     Architecture untouched.
   - qteklink-app: install shadcn base-nova primitives (same set admin-app owns), port
     admin-app's Button verbatim, warm token ramp, route every surface through tokens —
     zero `#96003C` / `stone-*` remaining outside `globals.css`.
2. **Both error boundaries in scheduler-app get the hand-updated hex** (`#6B6259`→`#766C61`)
   in the same commit as the token change.
3. **Action-state shapes, dialogs' logic, `window.confirm`, auth placement, and all
   Server-Action/DAL code are untouched** — flagged functional items ship only with Chris's
   explicit per-item approval (see Open questions).
4. One implementer agent per app, run in parallel (disjoint directory trees, no conflicts);
   one commit per app so each is independently revertable.

## File-by-file change list

### scheduler-app (commit 3)
| File | Change |
|---|---|
| `app/globals.css` | tokens: `--color-ink-tertiary` value; NEW `--shadow-card/-hover/-pop`, `--color-rule-input`, `--ease-editorial`, `--color-brand-gold-700`, `--animate-pop-in` + keyframes |
| `app/error.tsx`, `app/book-v2/error.tsx` | hand-update reference-line hex `#6B6259`→`#766C61` |
| NEW `src/components/scheduler/wizard/WizardProgress.tsx` | 4-phase ribbon (presentational `card.step`→phase lookup; `nav`/`ol`/`aria-current`) |
| `src/components/scheduler/wizard/WizardSurface.tsx` | mount `<WizardProgress/>` only (1 import + 1 JSX line; switch untouched) |
| `src/components/ui/Card.tsx` | shadow + `sm:rounded`; NEW `Card.Divider`; tokenized easing |
| `src/components/ui/Field.tsx` | Input/Textarea border → `--color-rule-input` |
| `src/components/ui/Button.tsx` | `active:scale-[0.98]` press transition |
| `heritage/CompletedCard.tsx` | dead-class fix; what-happens-next list; confirmed tick; trust footnote |
| `heritage/CustomerInfoEditCard.tsx` | dead-class fixes ×4 |
| `heritage/SummaryCard.tsx` | `Card.Divider`; countdown polish; privacy footnote |
| `heritage/GreetingCard.tsx` | trust row |
| `heritage/DiagnosticLoadingCard.tsx` | error-branch promotion; dots polish |
| `heritage/AppointmentTypeCard.tsx`, `ServiceAndConcernPicker.tsx` | hover elevation; dead-class fix |
| `OtpInput.tsx` | dead-class fix |
| `wizard/BookPageShell.tsx` | header gold-500 rule |
| `wizard/IdleTimer.tsx`, `wizard/OfflineBanner.tsx` | system shadow + pop-in entrance |
| tests | NEW WizardProgress test; extend (never weaken) CompletedCard/SummaryCard text assertions if present |

### admin-app (commit 1)
| File | Change |
|---|---|
| `app/globals.css` | `--radius` 0.5rem; warm OKLCH neutral ramp; `--bronze-text`; warm `--shadow-*` scale; DELETE the `-apple-system` body font block |
| `app/layout.tsx` | body → `bg-background text-foreground antialiased`; add Geist Mono (`--font-mono`) |
| `shell/AppShell.tsx` | `bg-background`; PageHeader eyebrow prop + fluid title + gold rule |
| `shell/TopNav.tsx` | sticky shadow; chip polish; active underline; mobile sign-out size |
| `ui/button.tsx` | CVA: `shadow-xs hover:shadow-sm` (loading heuristic untouched) |
| `ui/card.tsx`, `ui/dialog.tsx`, `ui/table.tsx`, `ui/input.tsx`, `ui/skeleton.tsx` | shadows; CardTitle weight; uppercase column labels; textarea/file polish; `motion-reduce` |
| NEW `ui/StatusBadge.tsx` | 5-status color+icon vocabulary |
| `keytag/LiveStateTab.tsx`, `keytag/TagBadge.tsx`, `keytag/ConfirmationDialog.tsx` | tabular-nums; StatusBadge; warm shadows; amber header re-anchor |
| `scheduler/RecentUploadsList.tsx`, `scheduler/CatalogEditorTab.tsx`, `scheduler/SchedulerConfigTabs.tsx` + `keytag/KeytagsTabs` call site | StatusBadge; tabular-nums; line-variant tabs; designed empty states |
| `app/dashboard/page.tsx` | eyebrow/description copy; motion-safe card lift |
| NEW `app/{dashboard,keytags,schedulerconfig}/loading.tsx` | route skeletons (verify they stream; if a Suspense boundary is needed → STOP, flag) |

### qteklink-app (commit 2)
| File | Change |
|---|---|
| `package.json` + NEW `src/components/ui/*` (10 primitives) | `npx shadcn@latest add button badge card table separator skeleton dialog input label tabs`; port admin-app `button.tsx` verbatim (DEPS FLAGGED — Chris approval) |
| `app/globals.css` | warm ramp; 8px radius; `--ring` lighter burgundy 5.66:1; warm shadow scale; heading wiring |
| `app/layout.tsx` | body → tokens |
| `app/QtlTabs.tsx` | active `bg-primary/10 text-primary`; token container |
| `app/dashboard/page.tsx`, `app/approvals/page.tsx` (+`DateNav`, `ApproveDayControls` restyle-in-place), `app/postings/page.tsx` (+`MoveCard`, `DateMoveControls`), `app/approvals/[date]/breakdown/page.tsx`, `app/approvals/review/*`, `app/mappings/*`, smaller buttons, `error.tsx` | full token + primitive conversion per spec; status vocabulary; designed empty states; zero `#96003C`/`stone-*` outside globals.css |
| NEW `loading.tsx` ×5 route segments | skeletons |
| `app/approvals/__tests__/DateNav.test.tsx` | aria-labels preserved — expect pass unchanged |

## Phasing

1. **Commit 1 — admin-app** (establishes the internal-tool token values + StatusBadge reference)
2. **Commit 2 — qteklink-app** (converges on admin-app's now-final values)
3. **Commit 3 — scheduler-app** (customer-facing; lands last, after the process is proven on
   internal tools)

Implementers run in parallel; commits land in this order after each app passes its gates.

## Verification (per app, before its commit)

1. `npm run typecheck` clean; `npx vitest run` green (test updates = same assertion strength,
   each listed); `npm run build` clean.
2. Review fan-out, parallel: `design-review` + `wiring-review` + `dead-code-review` +
   `behavior-parity-review` (all preload the frontend-design skill).
3. `/code-review` OpenAI atomic gate at `/feature-verify` (gate on `_summary.json.gate`).
4. Contrast: every new pair re-checked against the specs' pinned ratios.
5. `prefers-reduced-motion` spot-check (scheduler global kill-switch covers new keyframes;
   admin/qteklink rely on `motion-safe:`).
6. Eyeball pass per spec's checklist (Chris approves the look before merge/deploy).

## Decisions (Chris, 2026-06-11 — "implement everything, do not defer anything; batch if needed")

| # | Item | Decision |
|---|---|---|
| 1 | qteklink: install shadcn base-nova deps (`@base-ui/react`, CVA, `lucide-react`) | **APPROVED** |
| 2 | scheduler: surface failed-submit errors to the customer (thin additive read of the existing result union in `WizardSurface.handleResult`) | **APPROVED** — ships with commit 3 |
| 3 | admin: add `hover:bg-primary/90` to Button default variant | **APPROVED** |
| 4 | admin: fix `/keytags` "Key Tag Managemment" typo (+ test queries in lockstep) | **APPROVED** |
| 5 | admin: delete dead `src/lib/ui/*` (zero imports) | **APPROVED** |
| 6 | scheduler: numeric "Step X of N" counter | **NOT shipped** — rejected on the merits (branched flow makes any "of N" dishonest); the 4-phase ribbon ships instead. Revisit only if Chris explicitly asks for the counter + the server-side position work. |
| 7 | Dark mode | **APPROVED** — admin-app + qteklink-app (mount next-themes ThemeProvider, re-pick every `.dark` OKLCH value to warm/brand parity, fix the off-brand greyscale `--primary` + leftover blue `--sidebar-primary`, add a theme toggle in the nav, AA-verify dark pairs). scheduler-app stays light-only (single-theme by design for customers). |
| 8 | qteklink: replace the dry-run modal + `window.confirm` (3 sites) with shadcn Dialog | **APPROVED** — migrate to the base-ui Dialog with admin-app's Pattern A/S visual language + close-guard idiom (`if (isPending && !next) return;`); confirmation semantics (what is confirmed, when) unchanged. |
| 9 | admin: `<Suspense>` boundary if route skeletons don't stream under `force-dynamic` | **PRE-APPROVED** — add if verification shows skeletons don't render without it. |

Batching: commit 1 admin-app (restyle + extras + dark mode), commit 2 qteklink-app (restyle +
dialog migrations + dark mode), commit 3 scheduler-app (restyle + failed-submit banner). If an
implementer judges dark mode or the dialog migration too risky to land atomically with the
restyle, it splits into its own follow-up commit in the same feature — never silently dropped.

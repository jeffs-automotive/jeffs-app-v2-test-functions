> Generated 2026-05-31 by a 17-agent research+audit workflow (5 web-research angles, each adversarially fact-checked, + a 6-cluster codebase audit). Sources are official-vendor / standards-body / recognized-expert unless labeled otherwise. Analysis only — no code was changed.

# File-Size Audit & Modularization Strategy — jeffs-app-v2

*Prepared for Chris. Two Next.js 15 apps (`scheduler-app`, `admin-app`) + Deno edge functions under `supabase/functions/`. ~316 source files, ~85k LOC, 37 files over 500 lines.*

---

## 1. Executive summary

- **"~500 lines" is a useful guardrail, not a law.** No major published style guide (Google's TypeScript guide, Airbnb's JS guide) sets a maximum *file* length — they cap line *width* instead. Every concrete number in this space is empirically tuned, not derived: ESLint's `max-lines` default is 300 and ESLint itself states *"there is no objective maximum"* with recommendations *"typically range from 100 to 500 lines"* ([ESLint max-lines](https://eslint.org/docs/latest/rules/max-lines)). Treat ~500 as a **tripwire that prompts a human to ask "does this file do too many things?"** — not an auto-fail.
- **The measurable rules that ARE defensible:** (a) ESLint `max-lines` and `max-lines-per-function` are real, shipped, configurable core rules with documented behavior; (b) SonarSource Cognitive Complexity (S3776) is a named, published metric that measures *understandability*, the thing you actually care about; (c) Fowler's named refactorings (Extract Function, Extract Class, Move Function) are canonical, behavior-preserving transformations. Use the line count as the cheap trigger, then make the *refactor decision* with complexity + cohesion, not line arithmetic.
- **Yes — you can absolutely create reusable files and import them where needed.** This repo already proves both mechanisms: Next.js path aliases (`@/lib/...`) and the Deno `_shared/` convention (`../_shared/...`). The two halves of the repo use *different* import mechanisms, and conflating them breaks builds — Section 3 gives the exact mechanics per layer.
- **Roughly half this repo's bloat is DATA, not logic.** The single largest file (`canonical-concern-catalog.ts`, 6,082 lines) is a pure hand-authored catalog with zero logic; `database.types.ts` (~2,318 lines) is *generated* and must be excluded from any size policy entirely. These data files are the cheapest, lowest-risk early wins.
- **A scheduler refactor is mid-flight (`phase_18_edge_consolidation`).** Several of the largest files — the `scheduler-*-direct` edge functions and `WizardSurface.tsx` — are its active edit surface. Splitting those *now* would create merge conflicts. This report explicitly routes around that work (Section 6).
- **The honest payoff framing:** most splitting improves *cohesion, reuse, and reviewability* (real wins) but does **not** reduce shipped bundle bytes. Only Next.js `'use client'` leaf extraction reduces shipped JS; for Deno, splitting a file into siblings in the same function folder gives **zero** cold-start benefit (same bundled bytes). Say so honestly rather than overselling a performance win.

---

## 2. The proven strategy catalog

Each strategy below is labeled **PROVEN** (documented, shipped, citation-backed) or **OPINION/JUDGMENT** (sound engineering, but a choice not a law). Inline citations link the load-bearing source.

### 2A. Enforcement & metrics (mechanical tripwires)

| Strategy | Basis | Source |
|---|---|---|
| **ESLint `max-lines`** — built-in core rule, no plugin. Configure explicitly: `["warn", { max: 500, skipBlankLines: true, skipComments: true }]`. **The default is `max: 300` with `skipBlankLines`/`skipComments` both `false`** — you must set all three to count 500 code-only lines. | **PROVEN** rule/behavior; **OPINION** on the number 500 (top of ESLint's own cited range). | [ESLint max-lines](https://eslint.org/docs/latest/rules/max-lines) (official-vendor) |
| **ESLint `max-lines-per-function`** — catches the long *function* the file count misses. Default is `max: 50`; 80–100 is reasonable for React. **Must be glob-scoped** (off for tests/route components) or it floods UI files with noise and gets tuned out. | **PROVEN** rule/behavior; **OPINION** on 80. | [ESLint max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function) (official-vendor) |
| **SonarSource S104 (file LOC) + S3776 Cognitive Complexity** — the intellectually honest upgrade. S104 counts lines *of code*; S3776 (default threshold 15) measures *understandability*. Use S104 as the file tripwire, S3776 as the decider: a long file whose functions are all under complexity 15 is just long, not unmaintainable. **This is the only tool that can put a measurable number on the Deno edge code** (ESLint in the two apps doesn't cover `supabase/functions/`). | **PROVEN** metric (published white paper). Honest nuance: Sonar staff state the 15 threshold was reached empirically — *"bumped it up until we got results we were more comfortable with, finally landing at 15."* S104 ships at default **1000**, so you must lower it to match intent. | [Cognitive Complexity](https://www.sonarsource.com/resources/cognitive-complexity/), [S3776 default=15 thread](https://community.sonarsource.com/t/s3776-reason-for-the-current-default-value-of-15/127103), [RSPEC-104](https://rules.sonarsource.com/typescript/RSPEC-104/) (all official-vendor) |
| **Biome `noExcessiveLinesPerFile`** — equivalent if you ever move off ESLint (default `maxLines: 300`, nursery). | **PROVEN** (nursery status). | [Biome rule](https://biomejs.dev/linter/rules/no-excessive-lines-per-file/) (official-vendor) |
| **What the big style guides actually do** — Google's TS guide has **no** file-length rule; Airbnb caps line *width* (100 cols via `max-len`) and ships `max-lines` **off**. Use this to retire any "big company enforces 500-line files" myth. | **PROVEN** (absence of a file-length mandate, verified). | [Google TS Style Guide](https://google.github.io/styleguide/tsguide.html), [Airbnb JS](https://github.com/airbnb/javascript) |

### 2B. React + Next.js composition (official-vendor mechanics)

| Strategy | Basis | Source |
|---|---|---|
| **Extract leaf `'use client'` components; keep parents as Server Components.** Next.js docs verbatim: *"To reduce the size of your client JavaScript bundles, add `'use client'` to specific interactive components instead of marking large parts of your UI as Client Components."* This is **the only strategy that also reduces shipped JS**, not just source LOC. | **PROVEN** (official, worked example). *Which* subtree to extract is judgment. | [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) (official-vendor) |
| **Pass children / JSX-as-props instead of prop-drilling.** React: a component with a `children` prop *"has a hole that can be filled in by its parent"*; and when you spread props in every other component, *"it indicates that you should split your components and pass children as JSX."* Next.js documents the children-slot pattern (`<Modal>{children}</Modal>`) for interleaving server content into client shells. | **PROVEN** (official). | [Passing Props](https://react.dev/learn/passing-props-to-a-component), [Passing Data Deeply](https://react.dev/learn/passing-data-deeply-with-context) |
| **Extract reusable stateful logic into custom hooks (`use`-prefixed).** React: *"When you extract logic into custom Hooks... The code of your components expresses your intent, not the implementation."* Caveat from the same doc: *"some duplication is fine"* — don't over-extract; if a helper calls no hooks, don't `use`-prefix it. | **PROVEN** (official; threshold is judgment). | [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks), [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) |
| **Never nest component definitions; promote inline sub-components to top level.** React states this as a hard rule: *"you must never nest their definitions"* (nested defs remount every render — a perf/correctness bug, not taste). *"You can always move Profile to a separate file."* | **PROVEN — this one is law, not opinion.** | [Your First Component](https://react.dev/learn/your-first-component) |
| **Keep route/page/action files THIN; extract Server Actions + logic into lib modules.** Next.js v15: a Server Function can be defined with `'use server'` *"at the top of a separate file to mark all exports of that file"* and imported into Client Components. This is exactly this repo's "Thin Action / Fat DAL" rule — the framework sanctions the file split. | **PROVEN** for the file-split mechanic. **OPINION-adjacent** for *how* to decompose a 1,300-line non-UI lib module (that's general single-responsibility design; the framework docs are silent on it). | [Updating Data (Next.js 15)](https://nextjs.org/docs/15/app/getting-started/updating-data), [Project structure](https://nextjs.org/docs/app/getting-started/project-structure) |

> **Lint caveat (corrected):** the general "no inline nested components" case is enforced by `react/no-unstable-nested-components` (from `eslint-plugin-react`, **community-maintained**), *not* by react.dev's `component-hook-factories` lint (which specifically targets higher-order factory functions that return components/hooks — a narrower pattern).

### 2C. TypeScript module / reuse mechanics — incl. the barrel-file caveat

| Strategy | Basis | Source |
|---|---|---|
| **Extract to a module + named re-exports (`export … from`).** Cut a cohesive slice into its own file, keep **named** exports (avoid default exports — they resist clean re-export/rename), then re-export from the original path so call sites don't change. **Hard compiler rule:** under this repo's `verbatimModuleSyntax: true` + `isolatedModules: true`, re-exporting a *type* must use `export type { Foo } from './x'` (or per-specifier `export { value, type Foo }`) or the build fails (TS1205). | **PROVEN** (documented + build-enforced). | [TS Modules Reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html), [verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html) |
| **Split TYPES into their own module** (`*-types.ts`) and `import type`. Type-only imports are **guaranteed erased** from emitted JS — zero runtime/bundle cost — so a shared types module can be imported everywhere freely. The repo already proves this: `supabase/functions/_shared/orchestrator-types.ts` was split out specifically *"to avoid circular imports between orchestrator.ts ↔ orchestrator-router.ts ↔ specialists/*.ts."* | **PROVEN** (compiler behavior). | [verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html) |
| **Separate DATA / CONFIG constants out of logic files** (`*-config.ts`, `*-constants.ts`). Plain value modules — trivially reusable and unit-testable. | **OPINION** (widely-followed convention, grounded in module semantics — not a spec mandate). | [MDN JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) (standards-body) |
| **Path aliases (`@/* → ./src/*`) to keep imports clean after splitting — Next.js only.** Both apps already define `@/*` and `@/app/*`. Use `@/lib/scheduler/booking-mutations` instead of `../../../lib/...`. Removing deep-relative-import friction is what makes aggressive splitting actually happen. **Does NOT apply to Deno** (Deno doesn't read tsconfig paths). | **PROVEN** (Next.js built-in support; already configured). | [Absolute Imports & Module Path Aliases](https://nextjs.org/docs/14/app/building-your-application/configuring/absolute-imports-and-module-aliases) |
| **Barrel files (`index.ts` re-export hubs) — use SPARINGLY (the load-bearing caveat).** A barrel makes a split *feel* clean (one import line) but does **not** reduce size, and naive barrels actively hurt: Vercel's engineering writeup documents that importing one symbol through a big barrel can force evaluation of all re-exported modules (*"200~800ms"* import cost for popular packages) and barrels with side effects defeat tree-shaking. The repo's one good barrel — `scheduler-app/src/components/ui/index.ts` (small, typed, side-effect-free) — is the model. **Do NOT introduce broad `src/lib/index.ts` mega-barrels.** Split into leaf modules first; add a barrel only if ergonomics justify it. If a *node_modules* barrel package shows up heavy, wire `experimental.optimizePackageImports` (it targets packages, not your own files; flagged experimental). | **PROVEN** (load cost + tree-shaking limits). "Avoid your own barrels entirely" is a strong community stance, not a hard Next.js rule. | [Vercel: How we optimized package imports](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js), [optimizePackageImports](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports), [Package bundling](https://nextjs.org/docs/app/guides/package-bundling) |

> **Version note:** this repo is pinned at **Next 15**. `optimizePackageImports` and tsconfig-paths support both predate 15 and apply, but the `next experimental-analyze` bundle command is a v16 feature — on 15 use the `@next/bundle-analyzer` webpack plugin instead.

### 2D. Named refactorings (Fowler) — run these once a file trips the threshold

The line rule is the *trigger*; the *fix* is a behavior-preserving refactoring from Fowler's catalog, cutting along cohesion seams (SRP: *"gather together the things that change for the same reasons; separate those that change for different reasons"*).

| Refactoring | What it does | Source |
|---|---|---|
| **Extract Function** (a.k.a. Extract Method) | Lift a coherent fragment into a named function. The atomic building block; isolates code but doesn't shrink the file until you **Move** it. | [Extract Function](https://refactoring.com/catalog/extractFunction.html) (recognized-expert: Fowler) |
| **Extract Class** (→ in TS, **extract a *module***) | Split a unit doing two jobs into two, moving the cohesive cluster out. **The structural file-shrink lever** — removes whole responsibilities, not lines. | [Extract Class](https://refactoring.com/catalog/extractClass.html) |
| **Move Function / Move Field** | Relocate cohesive helpers to where they belong (in this repo: into `_shared/` or a sibling). **The actual line-removal lever** that converts Extract Function into real shrinkage. | [Move Function](https://refactoring.com/catalog/moveFunction.html), [Move Field](https://refactoring.com/catalog/moveField.html) |
| **Split Phase** | Separate sequential concerns (parse → compute, build-prompt → call → parse) into phases joined by an intermediate data shape. The cohesion-seam finder for procedural handlers and LLM pipelines. | [Split Phase](https://refactoring.com/catalog/splitPhase.html) |
| **Replace Conditional with Polymorphism** | Convert a type-coded switch into per-case handlers selected by a `Record<Kind, Handler>` map. **Use SPARINGLY** — Fowler explicitly cautions against turning *every* switch into polymorphism (that caution is in the 2nd-ed. book + community sources, *not* on the free catalog page). For a closed TS union, a discriminated-union switch with exhaustiveness checking is often clearer. | [Replace Conditional with Polymorphism](https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html) |
| **Replace Function with Command** | Turn a function into an object (or, in functional TS, a factory that closes over a context) when it needs rich shared state/sub-steps. **Over-engineering-prone** — Fowler ships the inverse for a reason; default to Extract + Move first. | [Replace Function with Command](https://refactoring.com/catalog/replaceFunctionWithCommand.html) |

> **Honesty note on Fowler's catalog:** the free pages prove the *names, intents, and worked examples* exist and are canonical; the deepest "when-not-to" nuance lives in the paywalled 2nd-ed. book. The "extract a module" move is **Move Function + Extract Class composed** — there is no separate "Extract Module" catalog entry, and this report does not invent one. Fowler's own size heuristic is deliberately small and judgment-based (*"any method longer than ten lines should make you start asking questions"*) — which *validates* using ~500 as a "start asking questions" trigger rather than a sacred limit. ([Bloaters](https://refactoring.guru/refactoring/smells/bloaters), recognized-expert.)

### 2E. Deno / Supabase edge organization

| Strategy | Basis | Source |
|---|---|---|
| **Decompose WITHIN the deploy boundary, NOT by minting new edge functions.** Each `supabase/functions/{name}/` folder (with its `deno.json`) is the deploy + isolation + cold-start unit. Keep `index.ts` a thin `Deno.serve` entrypoint and move helper clusters into sibling files (`./reconcile.ts`, `./handlers.ts`) — same ESZip, same cold start, smaller files. | **PROVEN:** *"Each function should have its own deno.json file… ensures proper isolation."* | [Managing dependencies](https://supabase.com/docs/guides/functions/dependencies) (official-vendor) |
| **Supabase prefers FEWER, LARGER functions** — *"develop few large functions, rather than many small functions."* This is opposite to a naive "split everything to 500 lines" — **reconciled** because "function" = the *deploy unit* (folder), not a source file. | **PROVEN** (verbatim quote). *Note:* the page states this with **no stated rationale** — the cold-start justification is reasonable inference, not documented proof. | [Development tips](https://supabase.com/docs/guides/functions/development-tips) (official-vendor) |
| **Keep `_shared/` as the cross-function reuse mechanism.** Supabase prescribes storing shared code in an underscore-prefixed folder, imported by relative path (`../_shared/...`). When you split a `_shared` file, the pieces **stay** in `_shared/` (or a sub-folder). Heuristic: helper used by 2+ functions → keep shared; used by exactly one → move into that function's folder. | **PROVEN** (folder convention). The single-importer heuristic is sound inference, not a verbatim rule. | [Development tips](https://supabase.com/docs/guides/functions/development-tips) |
| **`mod.ts` as a directory's default entry / barrel.** Deno documents `mod.ts` as the default directory entry point and `deno.json` `exports` to expose grouped entry points. **Hard rules:** local relative imports require the full `.ts` extension; no circular imports. | **PROVEN** for `mod.ts`-as-entry + `exports`. The barrel *re-export* idiom (`export { x } from './y.ts'`) is **community practice**, not on the cited official pages — the repo's own `scheduler-tools.ts` barrel is the best precedent. | [Deno Style Guide](https://docs.deno.com/runtime/contributing/style_guide/), [Modules](https://docs.deno.com/runtime/fundamentals/modules/) |
| **Use real economics as the guardrail.** Hard limits: **20MB** max function size after bundling, **256MB** memory, **2s** CPU. Run `deno info <entrypoint>` to read bundle size; *"break large functions into smaller focused ones,"* *"import only the specific modules you need."* Splitting a file into siblings in the same folder gives **zero** bundle/cold-start benefit (same bytes) — its payoff is readability/reviewability. Externalizing large string blobs (e.g. inline HTML/markdown) to fetched assets is the move that actually cuts bundle bytes. | **PROVEN** (limits + `deno info`). | [Limits](https://supabase.com/docs/guides/functions/limits), [Bundle-size troubleshooting](https://supabase.com/docs/guides/troubleshooting/edge-function-bundle-size-issues) |

> **Naming-convention conflict (honest):** Deno's style guide says use underscores not dashes and reserves `mod.ts` — but this repo's convention is *dashed* filenames (`scheduler-tools.ts`). That style guide governs Deno's own std library, **not** binding on app code. Recommendation: adopt `mod.ts` for **new** sub-directory barrels; do **not** mass-rename existing dashed files (high churn, low value).

---

## 3. "Can we create reusable files and import them where needed?" — YES, with exact mechanics per layer

The answer is **yes** at every layer. The repo already does it in both halves. The critical caveat: **the two halves use different import mechanisms** — Next-side path aliases vs Deno-side relative `_shared/` — and they do not interoperate (a Deno function cannot import Next.js source, and `@/*` aliases do not resolve in Deno).

### 3a. Next.js apps (`scheduler-app`, `admin-app`)

**Mechanism 1 — lib modules + path aliases.** Both `tsconfig.json` files already define `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, `isolatedModules: true`, and `paths: { "@/*": ["./src/*"], "@/app/*": ["./app/*"] }`. Extract a slice from a fat file into a sibling, then import via the alias:

```ts
// Extracted DAL slice — unit-testable plain TS, no React, no Server Action decorators
// src/lib/scheduler/wizard/service-basket.ts
export function collectAllServiceKeys(row: SessionRow): string[] { /* ... */ }

// Consumed anywhere with a clean alias (not ../../../):
import { collectAllServiceKeys } from '@/lib/scheduler/wizard/service-basket';
```

**Mechanism 2 — type-only modules (zero runtime cost).** Because `verbatimModuleSyntax` is on, type re-exports MUST carry the `type` modifier or the build fails:

```ts
// src/lib/scheduler/booking-direct/types.ts
export interface HoldAppointmentRequest { /* ... */ }

// Consumer — erased from emitted JS, importable everywhere with no bundle penalty:
import type { HoldAppointmentRequest } from '@/lib/scheduler/booking-direct/types';
// Re-export from the original path to preserve the public import surface:
export type { HoldAppointmentRequest } from './booking-direct/types';
```

**Mechanism 3 — Server/Client leaf components.** Keep the parent a Server Component; push only the interactive subtree into a `'use client'` leaf (this is the one mechanic that also shrinks shipped JS):

```tsx
// Parent stays a Server Component (no 'use client') — fetches data, passes props down.
// Leaf:
'use client';
export function PhonesFieldset({ phones, onChange }: PhonesFieldsetProps) { /* ... */ }
```

**Mechanism 4 — custom hooks for stateful logic.** Move `useState`/`useEffect`/`useRef` clusters out of a fat component into a `useXxx()` hook so the component body shrinks to JSX + intent:

```ts
// src/components/scheduler/heritage/contact/useContactDraftList.ts
export function useContactDraftList<T>(opts: { max: number }) {
  // add/remove/setPrimary draft reducer enforcing max-N + exactly-one-primary
  return { items, add, remove, setPrimary, update };
}
```

**Barrel discipline:** keep `src/components/ui/index.ts` as the model (small, typed, side-effect-free). Re-export from an original file path to preserve import surfaces — but keep that re-export a thin pass-through; do **not** build broad `src/lib/index.ts` mega-barrels.

### 3b. Deno edge functions (`supabase/functions/`)

**Mechanism — the `_shared/` convention + relative imports + (optionally) `deno.json` import maps.** The repo already reuses across functions via `../_shared/...`. Extract a cohesive slice into a sibling or a `_shared/` sub-folder; import with the **full `.ts` extension** (hard Deno requirement):

```ts
// Extracted into the function's own folder (single-importer helper):
// supabase/functions/keytag-bulk-reconcile/reconcile-forward.ts
export async function reconcileOne(/* ... */) { /* ... */ }

// supabase/functions/keytag-bulk-reconcile/index.ts — thin Deno.serve orchestrator:
import { reconcileOne } from './reconcile-forward.ts';   // NOTE the required .ts

// Extracted into _shared/ (used by 2+ functions — e.g. driftOptions/patchFailOptions
// duplicated verbatim across keytag-bulk-reconcile AND keytag-tekmetric-webhook):
// supabase/functions/_shared/keytag-review-options.ts
export function driftOptions(/* ... */) { /* ... */ }

// Both functions import the one shared copy:
import { driftOptions, patchFailOptions } from '../_shared/keytag-review-options.ts';
```

**The per-function boundary caveat (critical):**
- A Deno function **cannot** import Next.js app source — that's why `extracted-facts.ts` is hand-mirrored in both `scheduler-app` and `supabase/functions/llm-testing`. Extracting to `_shared/diagnostic/` reduces the Deno-side copies to one canonical file but does **not** cross the package boundary.
- `@/*` aliases do **not** resolve in Deno. If you ever want Deno aliasing, it must be an import-map entry in each function's `deno.json` — a different mechanism with its own per-function maintenance cost.
- Splitting a file into siblings in the **same function folder** keeps the import map and bundle graph identical → zero cold-start regression. That's the safe default.

---

## 4. Per-cluster refactoring playbook

Six audit clusters. For each: the dominant problem, the strategy that applies, and the worst files with proposed splits, risk, and effort. All paths are exact.

### Cluster 1 — Deno `_shared/` god tool-modules

**Dominant problem:** many cohesive units crammed in one file, with heavy *duplicated structure* (not distinct responsibilities). The single biggest reuse win in the repo: five near-identical MD-upload pipelines repeating the same parse-validate-fetch-diff-dryrun-apply scaffold, with the 15-field `UploadResult` literal hand-written ~30×.
**Strategy:** Extract Class/Module (split-by-table/sub-registry) + Extract a generic driver (`runMdUpload(spec)`) + dead-code triage first. Barrel re-export at the original path keeps `scheduler-tools.ts` imports unchanged.
**In-flight note:** the advisor/MCP surface (`orchestrator.ts`, both tool registries, all `_shared/tools/*`) is the **surviving** surface NOT touched by phase 18 — safe to refactor now. **Exception:** `scheduler-slots.ts` is consumed by a phase-18 merge target — mark **later**.

| File | Lines | Proposed split (target → est lines) | Risk | Effort |
|---|---|---|---|---|
| `supabase/functions/_shared/tools/scheduler-admin.ts` | 3534 | `scheduler-admin-upload-core.ts` (generic `runMdUpload` driver + types + error/dup helpers, ~420); `scheduler-admin-flat-tables.ts` (5 flat upload+export pairs as specs, ~520); `scheduler-admin-concern-category.ts` (~480); `scheduler-admin-ops.ts` (~140). **Triage testing/routine legacy uploaders — likely dead (superseded by catalog V2).** | medium | XL |
| `supabase/functions/_shared/scheduler-tools.ts` | 1812 | thin `getSchedulerTools` orchestrator (~140); `scheduler-tools/customer-slots-booking.ts` (~520); `scheduler-tools/pricing-tools.ts` (~120); `scheduler-tools/admin-tools.ts` (~1000, still large — gated admin block). Promote `recorded()` HOF to shared module. | low | L |
| `supabase/functions/_shared/tools/scheduler-slots.ts` | 1346 | `scheduler-availability.ts` (~560); `scheduler-booking.ts` (~620); `scheduler-capacity-blocks.ts` (~90); shared `tekmetric-appointments.ts` DTO (~90). **DEFER — phase-18 edit path.** | high | L |
| `supabase/functions/_shared/tools/scheduler-customer.ts` | 806 | `scheduler-customer-read.ts` (~440); `scheduler-customer-write.ts` (~360, shared phone/address builders). | low | M |
| `supabase/functions/_shared/tools/keytag-extras.ts` | 787 | `keytag-lookup-audit.ts` (~420); `keytag-ar-mutations.ts` (~260, shared confirmation gate); `keytag-reconcile-invoke.ts` (~110). | medium | M |
| `supabase/functions/_shared/orchestrator.ts` | 736 | slim `orchestrator.ts` (~360); `orchestrator-sessions.ts` (~240, collapse the 50-column list written twice); `orchestrator-run-logging.ts` (~150). | medium | M |
| `supabase/functions/_shared/tools/manual-review-tools.ts` | 727 | dispatcher (~200); `manual-review-handlers.ts` (~340); `manual-review-actions.ts` (~200). **Its `patchTekmetricKeytag` is the CORRECT 401-retrying PATCH — consolidate with the drifted `keytag-management.ts` copy.** | medium | M |
| `supabase/functions/_shared/orchestrator-tools.ts` | 585 | adopt `recorded()` HOF (removes ~135 dup lines, ~340); `tool-call-recorder.ts` (~120). | low | S |
| `supabase/functions/_shared/tools/scheduler-otp.ts` | 559 | OTP logic (~300); `sms-provider.ts` (~200); `otp-crypto.ts` (~70). | low | S |
| `supabase/functions/_shared/tools/scheduler-pricing.ts` | 556 | `scheduler-pricing-read.ts` (~200); `scheduler-catalog-admin.ts` (~320, shared patch-diff engine). | low | S |
| `supabase/functions/_shared/tools/keytag-management.ts` | 527 | slim (~360); `keytag-confirmation-gate.ts` (~90). **Replace local drifted `patchKeytag` with shared 401-retrying `patchRepairOrderKeyTag`.** | medium | S |

### Cluster 2 — Deno per-function `index.ts` monolithic entrypoints

**Dominant problem:** one `Deno.serve` handler owning data-loading + business logic + HTML/email rendering + dispatch. Two flavors: pure-DATA bloat (cheap wins) vs genuine LOGIC bloat (real correctness risk).
**Strategy:** Extract Function (one file per event-branch/op-handler) + Split Phase + Extract to `_shared/` for the three highest-value cross-function duplications (below). Keep `index.ts` a thin orchestrator. **Delete dead code** rather than extracting it.
**Highest-value cross-function extractions:** (1) **`_shared/resend-client.ts`** — the Resend `fetch` with Bearer + Idempotency-Key + "409-as-success" is hand-rolled in `transcript-dispatcher`, `keytag-daily-report`, AND `keytag-bulk-reconcile`. (2) **`_shared/keytag-review-options.ts`** — `driftOptions`/`patchFailOptions` byte-for-byte duplicated across reconcile + webhook. (3) **shared `issueDriftReviewForRo()`** — the DRF/REG drift-detection branch is near-identical in `reconcileOne` and the webhook's work_approved handler.

| File | Lines | Proposed split (target → est lines) | Risk | Effort |
|---|---|---|---|---|
| `supabase/functions/llm-testing/index.ts` | 2168 | `_shared/diagnostic/extracted-facts.ts` (700, the 29-slot mirror); `_shared/diagnostic/question-fact-mapper.ts` (110); `_shared/diagnostic/load-catalog.ts` (320); `_shared/diagnostic/stage-prompts.ts` (450); slim `index.ts` (420). | low | L |
| `supabase/functions/keytag-bulk-reconcile/index.ts` | 1460 | **DELETE legacy orphan-email subsystem (~110 lines, documented dead);** `_shared/keytag-review-options.ts` (130); `tekmetric-io.ts` (120); `reconcile-forward.ts` (540); `reconcile-reverse.ts` (240); slim `index.ts` (260). | medium | L |
| `supabase/functions/keytag-tekmetric-webhook/index.ts` | 1266 | `event-classify.ts` (70); `webhook-audit.ts` (110); `handlers.ts` (700, one fn per event branch); slim `index.ts` (280). Move duplicated option presets to `_shared/`. | medium | L |
| `supabase/functions/tekmetric-api-testing/index.ts` | 1099 | `op-catalog.ts` (200, pure data); `read-ops.ts` (380); `_shared/hmac-confirmation-token.ts` (160, reusable Pattern-A primitive); `write-ops.ts` (220); slim `index.ts` (140). | low | M |
| `supabase/functions/transcript-dispatcher/index.ts` | 972 | `activity-builder.ts` (280); `lookups.ts` (230); `_shared/resend-client.ts` (80); slim `index.ts` (380). | medium | M |
| `supabase/functions/scheduler-booking-direct/index.ts` | 941 | `parse-body.ts` (250); `availability.ts` (130); `_shared/tekmetric-error-tag.ts` (50); slim `index.ts` (460). **DEFER / fold into phase 18.** | high | M |
| `supabase/functions/keytag-daily-report/index.ts` | 881 | `report-html.ts` (300, mirrors the `transcript-html.ts` precedent); `report-data.ts` (320); slim `index.ts` (180, uses `_shared/resend-client.ts`). | low | M |
| `supabase/functions/mcp-auth/index.ts` | 729 | `routes-register.ts` (130); `routes-authorize.ts` (140); `routes-token.ts` (340); slim `index.ts` (110). Extract repeated RFC 8707 validation into `_shared/oauth.ts`. (Most-justified monolith — single deploy unit, security-sensitive.) | low | M |
| `supabase/functions/orchestrator-mcp/index.ts` | 688 | `auth.ts` (280); `rpc-handlers.ts` (280); slim `index.ts` (140). | low | M |
| `supabase/functions/scheduler-step2-direct/index.ts` | 511 | `decide.ts` (200); slim `index.ts` (320). **DEFER — only 11 lines over target AND dead-center in phase 18; leave-as-is candidate.** | high | S |

### Cluster 3 — scheduler-app wizard logic (lib): big switch + many private helpers

**Dominant problem:** one giant `switch` (24–25 step cases) with heavy async payload builders inline, plus long tails of private helpers; **two duplication clusters** (row-derivation; JSONB column coercion) that should each become ONE shared module, not be split per-file.
**Strategy:** Extract Function (per-step card builders) + Extract Module (shared row-parsers, label/date formatters, service-basket) + Split Phase for the LLM pipelines (build-prompt → call → parse → map). For `extracted-facts.ts`: single-source-of-truth + derive (the biggest structural win).
**In-flight note:** `diagnose-concern.ts`, `run-diagnostics.ts`, `submit-summary.ts`, `submit-customer-notes.ts`, `load-diagnostic-catalog.ts`, `extracted-facts.ts`, `booking-direct-client.ts` are all in phase 18's blast radius (**high-risk / later**). `get-current-card.ts` and `build-summary-data.ts` are NOT named by phase 18 (lower collision risk).

| File | Lines | Proposed split (target → est lines) | Risk | Effort |
|---|---|---|---|---|
| `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` | 1373 | `diagnose-concern/schemas.ts` (280); `diagnose-concern/prompts.ts` (430); `diagnose-concern/anthropic-stage-call.ts` (180, reusable across LLM helpers); `diagnose-concern/index.ts` (320, single `buildResult()` factory replacing 7 inline literals). **DEFER (phase 18).** | high | L |
| `scheduler-app/src/lib/scheduler/wizard/get-current-card.ts` | 1267 | dispatcher (320); `cards/service-and-availability-cards.ts` (360); `cards/summary-and-notes-cards.ts` (150); `row-parsers.ts` (230); `service-basket.ts` (140); `label-format.ts` (140). | medium | L |
| `scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts` | 1136 | `facts/slot-registry.ts` (520, ONE hand-edited source); `facts/derive-schemas.ts` (160, derive Zod + JSON Schema + key list); `facts/index.ts` (30 barrel). Consider emitting registry to a committed JSON artifact the Deno mirror reads. | medium | L |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-summary.ts` | 914 | slim orchestrator (320); `confirm/hold-claim.ts` (230); `confirm/verification-mismatch.ts` (180, a reusable Pattern-B unit); `confirm/confirm-bubbles.ts` (90). **DEFER (phase 18).** | high | L |
| `scheduler-app/src/lib/scheduler/wizard/actions/run-diagnostics.ts` | 582 | orchestrator (320); `diagnostics/parsers.ts` (200); `diagnostics/catalog-lookup.ts` (110). **DEFER (phase 18).** | high | M |
| `scheduler-app/src/lib/scheduler/booking-direct-client.ts` | 517 | `booking-direct/types.ts` (240); `booking-direct/url-guard.ts` (90); slim client (200, generic `callOp()` collapses 8 wrappers). **DEFER — phase 18 repoints this client.** | high | M |
| `scheduler-app/src/lib/scheduler/wizard/build-summary-data.ts` | 388 | slimmed builders (250); `summary-row-derivation.ts` (150, the shared `deriveCustomerName`/`deriveVehicleString`/`collectAllServiceKeys`). | low | M |
| `scheduler-app/src/lib/scheduler/wizard/actions/submit-customer-notes.ts` | 375 | minimal: `append-appointment-note.ts` (50); else near-target, leave as-is. **DEFER (phase 18).** | medium | S |
| `scheduler-app/src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts` | 384 | optional `diagnostic-catalog-types.ts` (150); loader stays intact (240). **DEFER (phase 18).** | medium | S |

> **Cross-file win:** create ONE `scheduler-row-derivation` module (`deriveCustomerName`, `deriveVehicleString`, `collectAllServiceKeys`) imported by `get-current-card.ts`, `build-summary-data.ts`, and `submit-summary.ts` — kills the drift risk where the Tekmetric-title view and customer-facing view of the same row diverge. And ONE canonical `row-parsers` module — two different defensive parsers reading the same JSONB columns (`get-current-card.ts` vs `run-diagnostics.ts`) **will** drift.

### Cluster 4 — DATA catalogs masquerading as code

**Dominant problem:** these split into TWO strategies. `canonical-concern-catalog.ts` is a **true** data catalog (pure literals, zero logic, already feeding codegen). The other two are **mis-named LOGIC** god-modules (upload pipelines + an audit engine) needing Extract-Function, not data extraction.
**Strategy:** `canonical-concern-catalog.ts` → split-by-concern-category (one file per 14 categories) + extract shared types/presets. The other two → Extract shared engine + split-by-surface/responsibility behind a thin barrel at the original path (keeps Deno import maps + bundle graph identical).

| File | Lines | Proposed split | Risk | Effort |
|---|---|---|---|---|
| `scheduler-app/scripts/canonical-concern-catalog.ts` | 6082 | `concern-catalog/types.ts` (25); `concern-catalog/option-presets.ts` (95); `concern-catalog/categories/{brakes,electrical,…}.ts` (~300 each × 14); `concern-catalog/index.ts` (30 barrel re-exporting `CANONICAL_CATALOG`). **Fix the stale header comment** — the data flow is reversed (this TS file is source-of-truth, generates the MDs). | low | M |
| `supabase/functions/_shared/tools/scheduler-admin-catalog.ts` | 2804 | `scheduler-admin-catalog/_engine.ts` (380); `services.ts` (360); `subcategory-service-map.ts` (460); `subcategory-descriptions.ts` (640); `question-required-facts.ts` (470); `revert.ts` (140); `index.ts` barrel (25). **DRY the dry-run→confirm→snapshot→apply flow that surfaces 3–5 re-implement.** | medium | L |
| `supabase/functions/_shared/scheduler-admin-md.ts` | 1915 | `md/table.ts` (300); `md/coerce.ts` (230); `md/sections.ts` (250); `md/concern-category.ts` (280); `admin-audit/canonical-state.ts` (520); `admin-audit/confirm-token.ts` (130); `admin-audit/log-entry.ts` (120); thin barrel at original path (40). | medium | L |

> **Cross-file win:** a comma-split/trim/dedupe list parser is implemented at least 3× (`parseCsvList`, `parseServiceKeyList`, `parseFactKeyList`) and copy-pasted a 4th time into a test file because it isn't exported. Collapse to ONE shared `parseDelimitedKeyList()` and export it.

### Cluster 5 — Large React components + type-only modules

**Dominant problem:** UI side — phone format/normalize/e164 helpers duplicated **verbatim across 4 components** with NO shared module, plus the "contact list with one primary" state machine implemented ~4× and the address fieldset duplicated. Type side — two admin type modules are hand-mirrors of Deno edge shapes, repeating the same `useActionState` discriminated-union ~6×.
**Strategy:** UI — extract phone-utils + `useContactDraftList` hook + Phones/Emails/Address fieldsets ONCE (under `CustomerInfoEditCard`) and consume from both cards; do NOT extract twice. Type — split-by-concern behind a barrel; separate WIRE types from REACT state-union types (different change-drivers). **`WizardSurface.tsx` must be DEFERRED** — it's the live append target of phase 18 (every phase adds a switch case).

| File | Lines | Proposed split | Risk | Effort |
|---|---|---|---|---|
| `scheduler-app/src/components/scheduler/wizard/WizardSurface.tsx` | 652 | (eventual) `steps/IdentitySteps.tsx` (200); `steps/VehicleAndServiceSteps.tsx` (210); `steps/SchedulingSteps.tsx` (200); `wizard-result-handler.ts` (40); `NotYetMigrated.tsx` (30). **DEFER the switch split; do only the low-risk leaf extractions now.** | high | L |
| `scheduler-app/src/components/scheduler/heritage/CustomerInfoEditCard.tsx` | 589 | `lib/scheduler/phone-utils.ts` (45, the 4-copy dedup — **highest-value single extraction in cluster**); `contact/useContactDraftList.ts` (90); `contact/PhonesFieldset.tsx` (90); `contact/EmailsFieldset.tsx` (80); `contact/AddressFieldset.tsx` (110); slim card (180). | medium | L |
| `scheduler-app/src/components/scheduler/heritage/NewCustomerInfoCard.tsx` | 577 | `lib/scheduler/us-states.ts` (15); slim card (190) **consuming the SAME contact/* modules** (parameterize: `lockedVerifiedIndex` prop, `required` + `stateControl='select'`). | medium | M |
| `admin-app/src/lib/scheduler/types.ts` | 563 | `types/enums.ts` (90); `types/upload-revert.ts` (110); `types/audit-and-ops.ts` (150); `types/tool-map.ts` (90); `types/action-state.ts` (110, UI glue); `types/index.ts` (10 barrel). | low | M |
| `admin-app/src/lib/orchestrator/types.ts` | 450 | mostly leave-as-is (under 500, cohesive); move the one runtime guard `isConfirmationRequired` → `guards.ts` (20) so `types.ts` is purely type-only. | low | S |

### Cluster 6 — Node scripts (.mjs) + oversized test files

**Dominant problem:** `code-review-agents.mjs` is a flat 35-entry agent catalog mirroring `INVARIANTS-CATALOG.md` row-for-row. Tests share heavily-duplicated infrastructure (a chain-recording supabase mock hand-rolled 3×; a Sentry passthrough mock copy-pasted 4×; diagnostic catalog/result builders duplicated 2×).
**Strategy:** scripts — split-by-domain behind a barrel (keep `AGENTS` export stable); extract `SHARED_PREAMBLE`. tests — extract ONE shared scheduler test-mock module + ONE `__fixtures__/diagnostic-catalog` module (the highest-leverage, lowest-risk move). **Coordinate with git: `code-review.mjs` and `code-review-agents.mjs` are currently MODIFIED (uncommitted).**

| File | Lines | Proposed split | Risk | Effort |
|---|---|---|---|---|
| `scripts/lib/code-review-agents.mjs` | 1034 | `code-review-agents/_preamble.mjs` (40); `cross-cutting.mjs` (190); `db-edge.mjs` (290); `scheduler.mjs` (330); `admin.mjs` (270); `regression.mjs` (60); `index.mjs` barrel (25, keeps `AGENTS` contract). | medium | L |
| `scripts/code-review.mjs` | 710 | `code-review/tools.mjs` (200); `code-review/validate-report.mjs` (190, pure/testable); `code-review/fs-utils.mjs` (80); slim entrypoint (260). | medium | M |
| `scheduler-app/scripts/run-llm-test-batch.mjs` | 660 | `llm-test-batch/default-concerns.json` (35, data fixture); `analyze-stages.mjs` (200); `render-report.mjs` (190); slim entrypoint (230). | low | M |
| `scripts/ai-review.mjs` | 427 | `ai-review/system-instruction.mjs` (55); `ai-review/report.mjs` (160); slim entrypoint (210). | low | S |
| `…/actions/submit-summary.test.ts` | 990 | `__support__/submit-summary.test-harness.ts` (300); `submit-summary.cas.test.ts` (260); `submit-summary.verification.test.ts` (320). **DEFER — phase-18 blast radius.** | high | L |
| `…/actions/run-diagnostics.test.ts` | 932 | `__fixtures__/diagnostic-catalog.fixture.ts` (230, **shared with diagnose-concern**); `__support__/diagnostics.test-harness.ts` (230); slim spec (380). **DEFER.** | high | L |
| `…/llm/diagnose-concern.test.ts` | 652 | `__fixtures__/diagnostic-catalog.fixture.ts` (260, shared); slim spec (380). | medium | M |
| `supabase/functions/keytag-tekmetric-webhook/index.test.ts` | 604 | `__fixtures__/webhook-payloads.ts` (140, Deno-relative); slim spec (440). Keep using `_shared/test-helpers.ts`. | low | M |

---

## 5. Enforcement & rollout plan

**Approach: warn-first → error-later, with a "ratchet" so existing files don't block CI while new bloat is prevented.** This phased sequencing is recognized engineering practice (not a vendor mandate); the underlying tooling — ESLint severities, `--max-warnings`, lint-staged, husky — is all standard and documented.

### 5a. ESLint flat-config snippet (ESLint 9 — both apps use flat config)

Land at **`warn`** first so the existing oversized files don't break CI on day one. Count code-only lines (`skipComments` + `skipBlankLines`). Scope `max-lines-per-function` away from tests and route components, and **exclude the generated types file**.

```js
// scheduler-app/eslint.config.mjs  (drop into the existing `commonRules` object)
// admin-app/eslint.config.mjs       (append as a new flat-config object AFTER the FlatCompat spread)
const sizeRules = {
  'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
};

export default [
  // ...existing config...

  // Size tripwires — warn-first
  { rules: sizeRules },

  // Long-function rule, scoped to non-UI modules (DAL/lib), error-eligible later:
  {
    files: ['src/lib/**/*.ts', 'app/api/**/*.ts'],
    rules: {
      'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true }],
    },
  },

  // Relax for tests + config + route components (legitimately long):
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**', '**/*.config.{ts,mts}', 'app/**/page.tsx'],
    rules: { 'max-lines-per-function': 'off' },
  },

  // EXCLUDE generated output from any size policy:
  {
    files: ['src/lib/database.types.ts'],
    rules: { 'max-lines': 'off' },
  },
];
```

Source for these rules + their documented defaults: [`max-lines`](https://eslint.org/docs/latest/rules/max-lines), [`max-lines-per-function`](https://eslint.org/docs/latest/rules/max-lines-per-function).

> **Two repo facts to verify before flipping anything to `error`:** (1) the audit's counts (37 files >500, 14 >1000, 6 >1500) and (2) whether `scheduler-app` carries a backlog of *tolerated* warnings (e.g. deferred `react-hooks`/refs warnings). The research flagged both as local-codebase claims it could not independently confirm — confirm against the actual repo. The second matters because `--max-warnings 0` (below) turns *all* warnings into commit blockers, not just size ones.

### 5b. The ratchet — lint-staged on changed files only (husky 9 is already installed)

New/edited files must comply immediately (the place drift actually enters); legacy files are grandfathered until deliberately split. Repo root already has husky 9 + a `prepare: husky` script.

```jsonc
// package.json (repo root)
"lint-staged": {
  "scheduler-app/**/*.{ts,tsx}": "eslint --max-warnings 0",
  "admin-app/**/*.{ts,tsx}": "eslint --max-warnings 0"
}
```

```sh
# .husky/pre-commit
npx lint-staged
```

lint-staged passes file paths; ESLint resolves the nearest `eslint.config.mjs` per app automatically. **Caveat:** `--max-warnings 0` blocks on *every* warning on touched files — clean up the existing warning backlog first, or scope the gate to size rules only (more complex `--rule` overrides).

### 5c. CI + the flip to `error`

- **Phase 1 (now):** rules at `warn`; CI runs `npm run lint` report-only. Nothing breaks.
- **Phase 2 (ratchet):** the lint-staged pre-commit hook holds new/edited files to the line.
- **Phase 3 (enforce):** once the backlog of oversized files is split, flip `'warn' → 'error'` in both flat configs and add `--max-warnings 0` to the CI lint job for the whole tree. For the handful of files you consciously accept as long (a big Zod schema, a cohesive switch dispatcher), use an inline `// eslint-disable-next-line max-lines` with a tracking comment.

### 5d. The Deno gap + the diagnostic lens

ESLint in the two apps does **not** cover `supabase/functions/` (Deno; `deno lint` has no `max-lines` rule). The realistic path for the edge code is a **SonarCloud/SonarLint scan** (S104 file-LOC + S3776 Cognitive Complexity), set S104 explicitly to ~500 (it ships at 1000), run as a non-blocking PR check first. Use Sonar's Cognitive Complexity as the *diagnostic lens* (which big files actually hurt) — **don't double-enforce two competing line-count gates**; ESLint `max-lines` is the CI gate, Sonar complexity is the decider. This dovetails with the existing OpenAI code-review gate in `scripts/` — the lint gate handles the mechanical line/complexity check, the AI gate handles semantic review; they're complementary.

---

## 6. Sequencing & risk

The single most important constraint: a scheduler refactor is **mid-flight** (`phase_18_edge_consolidation`), merging the `scheduler-*-direct` edge functions into `scheduler-server` and re-pointing `wizard/llm/*` + `actions/*` + `booking-direct-client.ts`. **Do not double-edit its files.** The advisor/MCP surface (`orchestrator.ts`, both tool registries, all `_shared/tools/*` except `scheduler-slots.ts`) is the *surviving* surface NOT touched by phase 18 — safe now.

### NOW — highest-LOC, lowest-risk, zero collision with phase 18

1. **`canonical-concern-catalog.ts` (6082)** — pure data, already feeds codegen, NOT in any refactor's path. Split-by-category. **This is the single biggest LOC reduction in the repo at the lowest risk.** (Also fix the stale reversed-data-flow header comment.)
2. **`scripts/lib/code-review-agents.mjs` (1034)** and **`scripts/code-review.mjs` (710)** — data/tooling catalog + runner; split-by-domain + extract pure helpers. **Coordinate with the uncommitted git changes on both files.**
3. **`scripts/ai-review.mjs` (427)** and **`run-llm-test-batch.mjs` (660)** — small, low-risk, no production blast radius.
4. **Keytag + MCP + llm-testing edge functions** (`keytag-bulk-reconcile`, `keytag-tekmetric-webhook`, `keytag-daily-report`, `tekmetric-api-testing`, `mcp-auth`, `orchestrator-mcp`, `llm-testing`) — NOT touched by the scheduler refactor; split independently. **Land the three cross-function `_shared/` extractions here** (`resend-client.ts`, `keytag-review-options.ts`, `issueDriftReviewForRo()`) — they remove the most duplicated correctness-sensitive logic.
5. **`phone-utils.ts` + contact fieldsets** (Cluster 5 UI) — the 4-copy phone-helper dedup is the highest-value single UI extraction; the heritage cards' *internals* are stable even though the refactor wires them.
6. **Land the ESLint `max-lines` rule at `warn` + the lint-staged ratchet** so no new bloat enters while you work the backlog.

### NEXT — safe but larger, still off the phase-18 path

7. **`_shared/tools/scheduler-admin.ts` (3534)** and **`scheduler-admin-catalog.ts` (2804)** and **`scheduler-admin-md.ts` (1915)** — the ~52%-LOC-concentration cluster; extract the shared upload engine (biggest line-count win) + split-by-surface behind barrels.
8. **`scheduler-tools.ts` (1812)**, **`scheduler-customer.ts`**, **`orchestrator.ts`**, **`manual-review-tools.ts`** — advisor/MCP surviving surface.
9. **`get-current-card.ts` (1267)** + **`build-summary-data.ts` (388)** — NOT named by phase 18; create the shared `scheduler-row-derivation` + `row-parsers` modules here.
10. **`extracted-facts.ts` (1136)** single-source-of-truth refactor — high structural value (kills a 4-copy manual mirror), but coordinate since the Deno mirror lives in `llm-testing`.
11. **Test-infra dedup** — `__fixtures__/diagnostic-catalog` + the shared supabase-chain + Sentry mocks (for the tests NOT in the phase-18 blast radius, i.e. `diagnose-concern.test.ts`, `keytag-tekmetric-webhook/index.test.ts`).

### LATER — DEFER until phase 18 settles (or fold INTO it)

12. **`WizardSurface.tsx` (652)** — the *most-churned* file in the whole refactor (a switch case added every phase). Do only the trivial leaf extractions now; defer the switch split.
13. **`scheduler-slots.ts`, `scheduler-booking-direct/index.ts`, `scheduler-step2-direct/index.ts`** — phase 18's active edit surface. Marked **high risk**; their splits should land *as part of* phase 18's consolidation, not as a competing refactor.
14. **`diagnose-concern.ts`, `run-diagnostics.ts`, `submit-summary.ts`, `submit-customer-notes.ts`, `load-diagnostic-catalog.ts`, `booking-direct-client.ts`** and their **test files** — all in phase 18's blast radius. Fixtures/harness extraction is worth doing eventually regardless, but defer heavy restructuring while the refactor is active.

**Excluded from any policy entirely:** `scheduler-app/src/lib/database.types.ts` (~2318) is **generated** — never hand-refactor; regenerate via `supabase gen types`, and exclude from `max-lines`.

---

## 7. Sources appendix (deduped, grouped by authority tier)

### Official-vendor

**ESLint / Sonar / Biome (enforcement & metrics)**
- ESLint `max-lines` — https://eslint.org/docs/latest/rules/max-lines
- ESLint `max-lines-per-function` — https://eslint.org/docs/latest/rules/max-lines-per-function
- SonarSource Cognitive Complexity (white paper) — https://www.sonarsource.com/resources/cognitive-complexity/
- Sonar S3776 default=15 (empirical-tuning thread) — https://community.sonarsource.com/t/s3776-reason-for-the-current-default-value-of-15/127103
- Sonar RSPEC-104 (file LOC) — https://rules.sonarsource.com/typescript/RSPEC-104/
- Biome `noExcessiveLinesPerFile` — https://biomejs.dev/linter/rules/no-excessive-lines-per-file/

**React / Next.js (composition)**
- Server and Client Components — https://nextjs.org/docs/app/getting-started/server-and-client-components
- Updating Data (Next.js 15) — https://nextjs.org/docs/15/app/getting-started/updating-data
- `use server` directive — https://nextjs.org/docs/app/api-reference/directives/use-server
- Project structure — https://nextjs.org/docs/app/getting-started/project-structure
- Passing Props to a Component — https://react.dev/learn/passing-props-to-a-component
- Passing Data Deeply with Context — https://react.dev/learn/passing-data-deeply-with-context
- Reusing Logic with Custom Hooks — https://react.dev/learn/reusing-logic-with-custom-hooks
- You Might Not Need an Effect — https://react.dev/learn/you-might-not-need-an-effect
- Your First Component — https://react.dev/learn/your-first-component

**TypeScript / Vercel / Next.js (module mechanics & barrels)**
- TS Modules Reference — https://www.typescriptlang.org/docs/handbook/modules/reference.html
- TS `verbatimModuleSyntax` — https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html
- TS1205 (isolatedModules type re-export) — https://github.com/microsoft/TypeScript/issues/34750
- Vercel: How we optimized package imports in Next.js — https://vercel.com/blog/how-we-optimized-package-imports-in-next-js
- Next.js `optimizePackageImports` — https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports
- Next.js Package bundling — https://nextjs.org/docs/app/guides/package-bundling
- Next.js Absolute Imports & Module Path Aliases — https://nextjs.org/docs/14/app/building-your-application/configuring/absolute-imports-and-module-aliases

**Supabase / Deno (edge organization)**
- Supabase: Managing dependencies (`_shared`, per-function `deno.json`) — https://supabase.com/docs/guides/functions/dependencies
- Supabase: Development tips ("few large functions") — https://supabase.com/docs/guides/functions/development-tips
- Supabase: Limits (20MB / 256MB / 2s) — https://supabase.com/docs/guides/functions/limits
- Supabase: Edge function bundle-size troubleshooting (`deno info`) — https://supabase.com/docs/guides/troubleshooting/edge-function-bundle-size-issues
- Deno Style Guide (`mod.ts`, no max-lines, full-extension imports, no circular imports) — https://docs.deno.com/runtime/contributing/style_guide/
- Deno Modules & dependencies (full-extension specifiers) — https://docs.deno.com/runtime/fundamentals/modules/
- Deno Importing & exporting examples — https://docs.deno.com/examples/import_export/

### Recognized-expert
- Fowler — Extract Function — https://refactoring.com/catalog/extractFunction.html
- Fowler — Extract Class — https://refactoring.com/catalog/extractClass.html
- Fowler — Move Function — https://refactoring.com/catalog/moveFunction.html
- Fowler — Move Field — https://refactoring.com/catalog/moveField.html
- Fowler — Split Phase — https://refactoring.com/catalog/splitPhase.html
- Fowler — Replace Conditional with Polymorphism — https://refactoring.com/catalog/replaceConditionalWithPolymorphism.html
- Fowler — Replace Function with Command — https://refactoring.com/catalog/replaceFunctionWithCommand.html
- Fowler — Decompose Conditional — https://refactoring.com/catalog/decomposeConditional.html
- Refactoring catalog index — https://refactoring.com/catalog/
- refactoring.guru — Bloaters (Long Method / Large Class) — https://refactoring.guru/refactoring/smells/bloaters
- Robert C. Martin — Single Responsibility Principle — https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html
- Google TypeScript Style Guide (no file-length rule) — https://google.github.io/styleguide/tsguide.html
- Airbnb JavaScript Style Guide (line-width cap, no file-length mandate) — https://github.com/airbnb/javascript

### Standards-body / reference
- MDN — JavaScript modules — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
- Wikipedia — Single-responsibility principle — https://en.wikipedia.org/wiki/Single-responsibility_principle

### Honesty notes on sources (carried from the verifiers)
- The "use sparingly" caution on **Replace Conditional with Polymorphism** is in Fowler's *book* + community sources, **not** on the free catalog page.
- The general "no inline nested components" lint is **`react/no-unstable-nested-components`** (community-maintained `eslint-plugin-react`), not react.dev's `component-hook-factories` (a narrower factory-function rule).
- The Deno **barrel re-export** idiom is community practice, not on the cited official Deno pages; the repo's own `scheduler-tools.ts` barrel is the precedent.
- Supabase's "few large functions" cold-start *rationale* is reasonable inference; the doc states the guidance without a stated reason.
- All **repo-specific counts** (37/14/6 oversized files, husky 9, the duplications, in-flight phase state) come from the supplied audit and were not independently verified against external sources — confirm against the actual repo before flipping any rule to `error` or wiring lint-staged.
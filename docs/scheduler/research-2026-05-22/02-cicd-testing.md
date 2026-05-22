---
schema_version: "2.0"
agent: research-cicd-testing
tier: "research-shared"
timestamp: "2026-05-22T16:00:00Z"
module_slug: null
module_short_code: null
module_number: null
run_id: null
parent_artifacts: []
sources_cited:
  - "https://supabase.com/docs/guides/deployment/ci/testing"
  - "https://github.com/supabase/dbdev/blob/master/.github/workflows/pgTAP.yaml"
  - "https://supabase.com/docs/guides/local-development/testing/pgtap-extended"
  - "https://supabase.com/docs/guides/local-development/testing/overview"
  - "https://github.com/usebasejump/supabase-test-helpers/blob/main/README.md"
  - "https://usebasejump.com/blog/testing-on-supabase-with-pgtap"
  - "https://chris.lu/web_development/tutorials/next-js-16-linting-setup-eslint-9-flat-config"
  - "https://nextjs.org/docs/app/api-reference/config/eslint"
  - "https://nextjs.org/docs/app/guides/upgrading/version-16"
  - "https://www.npmjs.com/package/eslint-config-next"
  - "https://github.com/microsoft/rushstack/issues/5049"
  - "https://github.com/lint-staged/lint-staged"
  - "https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026"
  - "https://typicode.github.io/husky/"
  - "https://nextjs.org/docs/app/guides/testing/vitest"
  - "https://nextjs.org/docs/app/guides/data-security"
  - "https://www.shsxnk.com/blog/vitest-nextjs-testing-infrastructure"
  - "https://micheleong.com/blog/testing-nextjs-14-and-supabase"
  - "https://github.com/vercel/next.js/discussions/69036"
  - "https://vitest.dev/guide/mocking"
  - "https://vitest.dev/guide/coverage"
  - "https://vitest.dev/config/coverage"
  - "https://supabase.com/docs/guides/functions/unit-test"
  - "https://blog.mansueli.com/testing-supabase-edge-functions-with-deno-test"
  - "https://docs.deno.com/examples/mocking_tutorial/"
  - "https://docs.deno.com/examples/stubbing_tutorial/"
  - "https://playwright.dev/docs/auth"
  - "https://playwright.dev/docs/test-configuration"
  - "https://nextjs.org/docs/pages/guides/testing/playwright"
  - "https://bug0.com/knowledge-base/playwright-visual-regression-testing"
  - "https://dev.to/subito/how-we-automate-accessibility-testing-with-playwright-and-axe-3ok5"
  - "https://supabase.com/blog/testing-for-vibe-coders-from-zero-to-production-confidence"
  - "https://ai-sdk.dev/docs/ai-sdk-core/testing"
  - "https://blog.atrera.com/post/unit-testing-streaming-ai-vercel-sdk/"
  - "https://deepwiki.com/anthropics/anthropic-sdk-typescript/4.1-beta-messages-api"
  - "https://github.com/anthropics/anthropic-sdk-typescript"
  - "https://supabase.com/docs/guides/deployment/branching/github-integration"
  - "https://supabase.com/docs/guides/troubleshooting/rls-simplified-BJTcS8"
  - "https://makerkit.dev/docs/next-supabase-turbo/development/database-tests"
status: complete
open_questions: []
next_tier_consumers:
  - "orchestrator (Chris)"
---

# CI/CD + Testing — Research Findings for jeffs-app-v2

Pure web-research findings. The orchestrator will translate into implementation plans separately. Source citations follow each section.

Scope reminder: 8 topics. Stack = Next.js 16 (App Router) on Vercel, Supabase Postgres + Deno edge functions, Vitest 4, Playwright 1.58+, pgTAP, ESLint 9 flat config, Node 24 on Vercel, AI SDK v5 + `@anthropic-ai/sdk` direct.

---

## Topic 1 — GitHub Actions workflow for Next.js + Supabase + Deno tests + pgTAP

### 2026-current best-of-class structure

The dominant pattern in solo / small-team Next.js + Supabase repos is **multiple parallel jobs gated by a fast "quick check" job**. Independent checks (lint, typecheck, unit, edge-fn-test, db-test) run in parallel; the slowest job determines wall-clock; the merge gate is the union of all jobs.

The Supabase team's own `supabase/dbdev` repo runs pgTAP in CI via the canonical pattern:

```yaml
name: pgTAP Tests
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  pgtap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: 2.75.0    # pin recent — defaults to v1.x of CLI otherwise
      - name: Start Supabase
        run: supabase start
      - name: Run pgTAP tests
        run: supabase test db
```

**Critical pin**: `supabase/setup-cli@v1` defaults to CLI v1.x. You MUST specify `version:` with a 2.x release (the project is already on a modern CLI per `supabase/.temp/cli-latest`). pgTAP runs against the locally-started Supabase stack — `supabase start` spins up Postgres + Auth + Storage in Docker on the runner. This dominates the job's wall-clock (~60-90s cold) but it's the canonical path.

### Canonical multi-job layout for our stack

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  # Fast gate — fails fast, blocks downstream parallel jobs
  quick-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: 'npm'
      - run: npm ci
      - name: Typecheck
        run: npx tsc --noEmit
      - name: Lint
        run: npm run lint

  vitest:
    runs-on: ubuntu-latest
    needs: quick-check
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: 'npm'
      - run: npm ci
      - run: npm run test -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: vitest-coverage
          path: coverage/

  deno-test:
    runs-on: ubuntu-latest
    needs: quick-check
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v1
        with:
          deno-version: v2.x
      - name: Deno tests for edge function helpers
        run: deno test --allow-all supabase/functions/

  pgtap:
    runs-on: ubuntu-latest
    needs: quick-check
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Start local Supabase stack
        run: supabase start
      - name: Apply migrations
        run: supabase db reset
      - name: Run pgTAP
        run: supabase test db

  e2e:
    runs-on: ubuntu-latest
    needs: quick-check
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

### Best-practice gotchas

- **`needs: quick-check`** keeps the cluster from spinning up `supabase start` (which costs ~60s) if typecheck fails. Saves money + minutes.
- **Run jobs in parallel after quick-check**, NOT sequentially. Total wall-clock = duration of slowest job (typically e2e or pgtap), not the sum.
- **Cache `~/.npm`** via `actions/setup-node@v4 cache: 'npm'`. Cold install ~60s → cached ~10s. Same applies to pnpm via `pnpm/action-setup`.
- **Don't run Playwright in matrix** unless you actually need cross-browser. One chromium pass is faster + cheaper. Visual snapshots specifically MUST be generated in the same Linux CI container as PR runs (font rendering differs across OS).
- **Pin actions to SHA or major version**, not branch. `supabase/dbdev` uses commit SHAs (`de0fac2e...`) — strongest supply-chain posture. `@v4` is the pragmatic middle.
- **Don't use Supabase preview branches for PR CI** unless you've already set up the integration. The local `supabase start` path is simpler and faster (no remote round-trip).

### Sources
- [Automated testing using GitHub Actions | Supabase Docs](https://supabase.com/docs/guides/deployment/ci/testing)
- [supabase/dbdev pgTAP workflow YAML](https://github.com/supabase/dbdev/blob/master/.github/workflows/pgTAP.yaml)
- [Next.js CI/CD with GitHub Actions — BetterLink](https://eastondev.com/blog/en/posts/dev/20251220-nextjs-cicd-github-actions/)
- [Testing for Vibe Coders — Supabase Blog](https://supabase.com/blog/testing-for-vibe-coders-from-zero-to-production-confidence)
- [GitHub Actions for Next.js with Tests — DEV Community](https://dev.to/whoffagents/github-actions-cicd-for-nextjs-tests-type-checking-and-auto-deploy-1kp7)

---

## Topic 2 — ESLint flat config + Next.js + the `@rushstack/eslint-patch` Node 20+ issue

### Status of `@rushstack/eslint-patch` in 2026

The `@rushstack/eslint-patch/modern-module-resolution` shim that ships inside `eslint-config-next` was incompatible with ESLint 9's flat config from day one (March 2024) and was never properly fixed. Microsoft's tracking issue ([rushstack#5049](https://github.com/microsoft/rushstack/issues/5049)) remains open. The error symptom is `"Failed to patch ESLint because the calling module was not recognized"` when ESLint 9 loads `eslint-config-next`.

**It is not formally "deprecated"** but the entire approach is being replaced. ESLint v10's flat config completion drops legacy config support, which means the rushstack patch — a workaround for legacy resolver behavior — has no role to play going forward. `@next/eslint-plugin-next` now defaults to flat-config format directly. `eslint-config-next` (the wrapper) has an open ESLint 10 compatibility issue (April 2026, unresolved).

### What Next.js 16 actually requires

Two breaking changes in Next.js 16:

1. **`next lint` is REMOVED** — no longer a command. You invoke ESLint directly.
2. **`eslint` option in `next.config.ts` is removed** — `ignoreDuringBuilds`, `dirs`, etc. are gone. `next build` no longer runs linting at all. You must call `eslint` from `package.json` scripts manually if you want lint-on-build behavior.

This means **the project's `next.config.ts` `eslint.ignoreDuringBuilds: true` setting is now dead code** in Next.js 16 — the option no longer exists. Removing it is required, not optional.

### Recommended 2026 config

The chris.lu tutorial (current as of Next.js 16) recommends bypassing `eslint-config-next` entirely and importing `@next/eslint-plugin-next` directly. This sidesteps the rushstack patch problem completely:

```javascript
// eslint.config.mjs
import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import { configs as tseslintConfigs } from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import nextPlugin from '@next/eslint-plugin-next'

export default defineConfig([
  // Global ignores MUST come first
  {
    name: 'project/ignores',
    ignores: ['.next/', 'node_modules/', 'public/', 'next-env.d.ts'],
  },
  // Core JS recommended
  {
    name: 'project/js-recommended',
    files: ['**/*.{js,mjs,ts,tsx}'],
    ...js.configs.recommended,
  },
  // TypeScript strict
  {
    name: 'project/ts-strict',
    files: ['**/*.{ts,tsx,mjs}'],
    extends: [
      ...tseslintConfigs.strictTypeChecked,
      ...tseslintConfigs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Next.js plugin (flat-config-native, no rushstack patch)
  {
    name: 'project/next',
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
])
```

### package.json scripts (Next.js 16 era)

```json
{
  "scripts": {
    "lint": "eslint --cache --cache-location .next/cache/eslint/",
    "lint:fix": "eslint --fix",
    "lint:inspect": "eslint --inspect-config",
    "build": "next build"
  }
}
```

Note: `next build` no longer runs lint. Wire lint into CI explicitly (`needs: quick-check` pattern from Topic 1).

### Gotchas
- **Configuration ORDER matters in flat config.** Global ignores must come first, otherwise files outside the ignore set still get linted.
- **Type-checked rules slow ESLint significantly.** `--cache --cache-location .next/cache/eslint/` is essential to avoid re-typechecking on every run.
- **`@eslint/js` v9.x and `typescript-eslint` v8.x** are the actual peer-dep pair. Older versions cause silent rule loss.
- **Migration codemod exists**: `npx @next/codemod@canary next-lint-to-eslint-cli .` migrates from the old `next lint` script.

### Sources
- [Next.js 16 Linting setup using ESLint 9 flat config — chris.lu](https://chris.lu/web_development/tutorials/next-js-16-linting-setup-eslint-9-flat-config)
- [Configuration: ESLint — Next.js Docs](https://nextjs.org/docs/app/api-reference/config/eslint)
- [Upgrading to Next.js 16 — Next.js Docs](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [eslint-patch fails to patch ESLint with next/core-web-vitals — rushstack#5049](https://github.com/microsoft/rushstack/issues/5049)
- [eslint-config-next on npm](https://www.npmjs.com/package/eslint-config-next)

---

## Topic 3 — Husky + lint-staged for pre-commit hooks

### Tool comparison (2026 state)

| Tool | Weekly downloads | Strengths | Weaknesses |
|---|---|---|---|
| **husky** | ~5M | Industry standard, ~2KB, transparent shell scripts | Sequential by default, JS-runtime-bound |
| **simple-git-hooks** | ~200K | Zero dependencies, transparent, no `prepare` script overhead | No file-scoping (must pair with lint-staged), small community |
| **lefthook** | ~400K | Go binary, parallel execution, YAML config, monorepo-aware | New tool to learn; runs sub-tasks in parallel by default (sometimes surprising) |
| **lint-staged** | ~8M | Staged-file scoping — orthogonal to the runner | Companion only — NOT a hook runner |

**Recommendation for solo / small-team Next.js**: `husky + lint-staged`. Most documented, smallest learning curve, fits the rest of the stack. Lefthook is the right pick for monorepos with multiple package managers or where pre-commit parallelism is a real bottleneck — neither applies here (single repo, npm).

### Canonical setup (2026)

```bash
npm i -D husky lint-staged
npx husky init    # creates .husky/pre-commit
```

`.husky/pre-commit`:
```bash
npx lint-staged
```

`package.json`:
```json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md,yml,yaml}": "prettier --write"
  }
}
```

### TypeScript type-check at commit time — CRITICAL gotcha

Do **NOT** add `tsc --noEmit` per-file in lint-staged. TypeScript with file arguments ignores `tsconfig.json`, producing nonsense errors like `TS17004: Cannot use JSX unless the '--jsx' flag is provided`.

Two correct patterns:

**Option A — function syntax (lint-staged ignores file args)**:
```javascript
// lint-staged.config.js
export default {
  '*.{ts,tsx}': () => 'tsc -p tsconfig.json --noEmit',
  '*.{js,jsx,ts,tsx}': ['eslint --fix', 'prettier --write'],
}
```
This runs `tsc` on the whole project every commit. Slow but correct. For ~1300 LoC `diagnose-concern.ts`-scale projects, this still completes in 3-8s.

**Option B — move typecheck to pre-push, not pre-commit**:
```bash
# .husky/pre-push
npx tsc --noEmit
```
Pre-commit becomes fast (lint + format only on staged files); typecheck only fires at push. Commits don't block on a 5-8s `tsc` pass, but you still catch type regressions before they leave the dev machine.

### What to gate vs warn at pre-commit time

| Check | Pre-commit | Pre-push | CI |
|---|---|---|---|
| Prettier format | gate | — | gate |
| ESLint (staged files) | gate | — | gate |
| TypeScript whole-project | warn or skip | gate | gate |
| Vitest changed-related | optional warn | optional gate | gate |
| pgTAP, Playwright | — | — | gate |
| Coverage threshold | — | — | gate |

The principle: pre-commit should be **fast (< 5s)** so devs don't disable it with `--no-verify`. Pre-push tolerates slow checks. CI is the authoritative gate (since `--no-verify` can bypass hooks).

### Sources
- [lint-staged README](https://github.com/lint-staged/lint-staged)
- [husky vs lefthook vs lint-staged 2026 comparison — PkgPulse](https://www.pkgpulse.com/guides/husky-vs-lefthook-vs-lint-staged-git-hooks-nodejs-2026)
- [Husky official docs](https://typicode.github.io/husky/)
- [Git Hooks comparison — Andy Madge 2026](https://www.andymadge.com/2026/03/10/git-hooks-comparison/)
- [Lefthook vs Husky 2026](https://www.edopedia.com/blog/lefthook-vs-husky/)

---

## Topic 4 — Vitest mocking strategies for Server Actions

### The fundamental tension

Vitest cannot invoke async React Server Components and struggles with full Server Actions because the Next.js runtime isn't in scope. The Vercel team's own position (per the official `vercel/next.js#69036` discussion) is that **Server Actions are harder to mock than route handlers** — and that with E2E coverage you may not need to mock them at all.

This is exactly why our `pattern-compliance.md` "Thin Action / Fat DAL" rule exists: the actions become 5-12 line wrappers that don't need unit tests; the DAL is pure TypeScript that does.

That said, when you DO need to unit-test a Server Action (e.g., the existing `submit-start-over.test.ts`), here are the canonical 2026 patterns.

### Pattern 1 — Mock `next/headers` and `next/navigation`

Always required for any test that touches a server-side Supabase client:

```typescript
// vitest.setup.ts
import { vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => ({ value: `mock-cookie-${name}` }),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: () => new Headers(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`)  // mirrors real redirect behavior
  }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))
```

`redirect` throwing matches real-world behavior — Next.js implements redirect via a thrown special error. Tests can `expect(action).rejects.toThrow('NEXT_REDIRECT')`.

### Pattern 2 — Shared `mock-supabase.ts` fixture

The canonical reusable mock for `createSupabaseAdminClient` (or any client) that supports chain calls:

```typescript
// src/test-helpers/mock-supabase.ts
import { vi } from 'vitest'

type ChainResult<T> = { data: T | null; error: { message: string } | null }

export function buildMockSupabase(overrides?: Partial<{
  select: ChainResult<any>
  insert: ChainResult<any>
  update: ChainResult<any>
  delete: ChainResult<any>
  rpc: ChainResult<any>
}>) {
  // Build a chain mock where every chain method returns `this` until .then() or await
  const chain: any = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.insert = vi.fn().mockReturnValue(chain)
  chain.update = vi.fn().mockReturnValue(chain)
  chain.delete = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.neq = vi.fn().mockReturnValue(chain)
  chain.in = vi.fn().mockReturnValue(chain)
  chain.order = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue(overrides?.select ?? { data: null, error: null })
  chain.maybeSingle = vi.fn().mockResolvedValue(overrides?.select ?? { data: null, error: null })
  // Make the chain itself thenable so `await sb.from('x').select('*')` works
  chain.then = vi.fn((cb) => Promise.resolve(overrides?.select ?? { data: [], error: null }).then(cb))

  return {
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue(overrides?.rpc ?? { data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'mock-uid' } }, error: null }),
    },
  }
}
```

Usage in a test:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { buildMockSupabase } from '@/test-helpers/mock-supabase'

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(),
}))

describe('submitStartOverAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a wizard session', async () => {
    const mockSb = buildMockSupabase({
      insert: { data: { id: 'session-123' }, error: null },
    })
    const { createSupabaseAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createSupabaseAdminClient).mockReturnValue(mockSb as any)

    const { submitStartOverAction } = await import('@/app/actions/start-over')
    const result = await submitStartOverAction({ /* ... */ })

    expect(mockSb.from).toHaveBeenCalledWith('wizard_sessions')
    expect(result.ok).toBe(true)
  })
})
```

### Pattern 3 — Mocking `server-only` imports

Files marked `import 'server-only'` throw at the top when imported into a non-server context (Vitest's jsdom/happy-dom environment). Two solutions:

```typescript
// vitest.setup.ts
vi.mock('server-only', () => ({}))   // no-op stub
```

This is the standard workaround. Confirmed across the Next.js community; the official `server-only` package's "client" build path is also a no-op for this reason (Next.js handles it at the bundler layer).

### Pattern 4 — Mocking AI SDK `generateObject` / `generateText`

For LLM helper functions that use `ai@^5` directly:

```typescript
import { generateObject } from 'ai'
import { MockLanguageModelV2 } from 'ai/test'

// In test:
vi.mock('@/lib/llm/anthropic', () => ({
  getModel: () => new MockLanguageModelV2({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ confidence: 0.9, /* … */ }) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    }),
  }),
}))
```

For `generateObject` with a Zod schema, the mock model just needs to return text that parses against the schema. The AI SDK does the parsing.

### Common pitfalls

- **`vi.mock` is hoisted to the top of the file.** Module-level constants in your mock factory are evaluated before everything else. Use `vi.hoisted()` for variables you want to share between the factory and the test body.
- **Mocked modules don't auto-clear between tests.** `vi.clearAllMocks()` in `beforeEach` is essential; `vi.resetModules()` if you need a fresh import.
- **Don't mock `cookies()` setter without making it `vi.fn()`** — Server Actions that set cookies (auth flows, session updates) will silently no-op and you'll spend an hour debugging why state didn't persist.
- **`revalidatePath` mocking** — assert it was called with the expected path; this is the only observable side effect of cache invalidation in unit tests.
- **`redirect` mocking** — must throw, not return. Real Next.js redirect throws a special error that the runtime catches and converts to an HTTP redirect.
- **`async` Server Components** — Vitest still can't render these. Use Playwright E2E for those paths. Next.js docs explicitly note this limitation as of v16.2.6.

### Sources
- [Testing: Vitest — Next.js Docs](https://nextjs.org/docs/app/guides/testing/vitest)
- [Vitest + Next.js 16 Testing Setup — shsxnk.com](https://www.shsxnk.com/blog/vitest-nextjs-testing-infrastructure)
- [Testing Next.js 14 and Supabase — Michele Ong](https://micheleong.com/blog/testing-nextjs-14-and-supabase)
- [How do you unit test server actions? — vercel/next.js discussions #69036](https://github.com/vercel/next.js/discussions/69036)
- [Mocking guide — Vitest](https://vitest.dev/guide/mocking)
- [Mocking Modules — Vitest](https://vitest.dev/guide/mocking/modules)

---

## Topic 5 — Deno test patterns for Supabase edge function helpers

### Layout convention

The Supabase docs prescribe this structure:

```
supabase/
├── functions/
│   ├── tekmetric-webhook/
│   │   └── index.ts
│   ├── _shared/
│   │   ├── sentry-edge.ts
│   │   └── webhook-idempotency.ts
│   └── tests/
│       ├── tekmetric-webhook-test.ts
│       └── webhook-idempotency-test.ts
├── deno.json   # optional
└── config.toml
```

Test files named `{function-name}-test.ts`. Run via `deno test --allow-all supabase/functions/tests/`.

### Pattern 1 — Stubbing `fetch` (for outbound API calls)

Deno's standard library `jsr:@std/testing/mock` provides `stub` + `returnsNext` + `using`:

```typescript
import { assertEquals } from 'jsr:@std/assert@1'
import { stub, returnsNext } from 'jsr:@std/testing/mock'

Deno.test('Tekmetric webhook fetches RO details', async () => {
  using fetchStub = stub(
    globalThis,
    'fetch',
    returnsNext([
      Promise.resolve(new Response(
        JSON.stringify({ id: 12345, status: 'In Progress' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )),
    ])
  )

  // Call the webhook handler
  const response = await handleTekmetricWebhook(/* … */)

  assertEquals(fetchStub.calls.length, 1)
  assertEquals(fetchStub.calls[0].args[0], 'https://shop.tekmetric.com/api/v1/repair-orders/12345')
  assertEquals(response.status, 200)
})
```

The `using` keyword (TC39 explicit-resource-management) auto-restores the stub when scope exits — no try/finally boilerplate. This is canonical in 2026 Deno tests.

### Pattern 2 — Mocking the Supabase client in Deno

Unlike the Node side, Deno tests typically construct a **real Supabase client pointed at the local `supabase start` stack** rather than mocking. The mansueli/Supabase docs canonical pattern:

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2'
import { assertEquals, assert } from 'jsr:@std/assert@1'
import 'jsr:@std/dotenv/load'

const sb = createClient(
  Deno.env.get('SUPABASE_URL') ?? 'http://localhost:54321',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

Deno.test('insert + idempotent webhook', async () => {
  // Clean state
  await sb.from('webhook_events').delete().eq('event_id', 'test-evt-1')

  // Simulate a webhook
  const evt = { provider: 'tekmetric', event_id: 'test-evt-1', payload: {/*…*/} }
  const { data: insert1 } = await sb.from('webhook_events').upsert(evt, { onConflict: 'provider,event_id' })

  // Re-fire same event — should be no-op (idempotency)
  const { data: insert2 } = await sb.from('webhook_events').upsert(evt, { onConflict: 'provider,event_id' })

  // Assert only one row exists
  const { data: rows } = await sb.from('webhook_events').select('*').eq('event_id', 'test-evt-1')
  assertEquals(rows?.length, 1)
})
```

This is **integration-style testing against the local Supabase stack**, which is the Supabase team's recommended primary path. Pure unit tests (stub the client) are also fine for helper functions that don't touch DB.

### Pattern 3 — Asserting Sentry capture calls

For testing the `sentry-edge.ts` wrap pattern:

```typescript
import { spy, assertSpyCalls } from 'jsr:@std/testing/mock'

Deno.test('webhook signature mismatch captures to Sentry', async () => {
  // Stub Sentry.captureMessage at the import surface
  const captureSpy = spy()
  using sentryStub = stub(
    Sentry,
    'captureMessage',
    captureSpy
  )

  const req = new Request('https://x.example/webhook', {
    method: 'POST',
    headers: { 'X-Tekmetric-Signature': 'bogus' },
    body: '{}'
  })

  const response = await tekmetricWebhookHandler(req)

  assertEquals(response.status, 401)
  assertSpyCalls(captureSpy, 1)
  assertEquals(captureSpy.calls[0].args[1], 'warning')   // severity
})
```

### Pattern 4 — Asserting Resend send calls

Stub fetch at the Resend API boundary:

```typescript
using resendStub = stub(globalThis, 'fetch', (url, init) => {
  if (typeof url === 'string' && url.includes('api.resend.com/emails')) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'mock-resend-id' }), { status: 200 }))
  }
  return Promise.reject(new Error(`Unexpected fetch to ${url}`))
})

await sendNotificationEmail(/* … */)

const resendCall = resendStub.calls.find(c => String(c.args[0]).includes('resend.com'))
assertEquals(JSON.parse(resendCall!.args[1]!.body).to, 'tech@jeffsautomotive.com')
```

### Pattern 5 — Idempotency assertion

Per the `webhook_events` keyed-on-(provider, event_id) pattern:

```typescript
Deno.test('Tekmetric webhook handles duplicate event_id idempotently', async () => {
  const event = { provider: 'tekmetric', event_id: 'dup-test', payload: {/*…*/} }

  // Fire 5 times
  for (let i = 0; i < 5; i++) {
    await handleTekmetricWebhook(buildRequest(event))
  }

  // Only ONE side effect should have occurred (e.g., RO record created)
  const { data: roRecords } = await sb.from('repair_orders').select('*').eq('tekmetric_id', event.payload.id)
  assertEquals(roRecords?.length, 1, 'webhook should be idempotent — only 1 RO created')
})
```

### Common gotchas

- **`Deno.env.get` returns undefined in test runs without `.env` loaded.** Use `jsr:@std/dotenv/load` at the top of test files OR set vars in `deno.json` task config.
- **`npm:` specifiers vs `jsr:` specifiers.** Use `npm:@supabase/supabase-js@2` (NOT the legacy `esm.sh` URL). JSR for `@std/*`. Don't mix legacy `deno.land/x` and modern JSR — pick one and stay there.
- **`--allow-all` is shorthand for `--allow-net --allow-env --allow-read --allow-write`.** Acceptable in CI; locally prefer narrower scopes when feasible.
- **Tests against local Supabase require `supabase start` first.** CI script: `supabase start && deno test ...`. Cold local start ~60s.
- **Stub cleanup is mandatory.** Without `using` or explicit `.restore()`, leaked stubs from one test contaminate the next.

### Sources
- [Testing your Edge Functions — Supabase Docs](https://supabase.com/docs/guides/functions/unit-test)
- [Testing Supabase Edge Functions with Deno Test — mansueli blog](https://blog.mansueli.com/testing-supabase-edge-functions-with-deno-test)
- [Testing in isolation with mocks — Deno docs](https://docs.deno.com/examples/mocking_tutorial/)
- [Stubbing in tests — Deno docs](https://docs.deno.com/examples/stubbing_tutorial/)

---

## Topic 6 — Playwright config + Next.js wizard E2E

### Test-environment options for our stack

We need to decide between **three database backings** for E2E:

| Strategy | Setup cost | Test data realism | Recommended for |
|---|---|---|---|
| **Local Supabase (`supabase start`)** in CI runner | High (60-90s cold) | High (real RLS, real triggers) | Default — matches `pgtap` job's stack |
| **Supabase preview branch** (per PR) | Medium (auto-creates) | High (mirrors prod schema) | When PR-isolation matters |
| **Full prod-like Vercel preview** | Low (already exists) | Mixed (real network, prod-shape) | Smoke tests only — not main E2E pass |

For the wizard happy-path test, the **local Supabase + Playwright** combo is the canonical primary path. It's the only one where you can deterministically seed test data and re-run.

### Canonical `playwright.config.ts` (2026)

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'html',

  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Auth setup project — runs once, writes storageState
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    // Main test project — depends on setup
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    // Mobile viewport
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Disable Next.js dev indicator (animates → flaky screenshots)
      NEXT_PUBLIC_DISABLE_DEV_INDICATOR: 'true',
    },
  },
})
```

**Why `npm run build && npm run start` in `webServer`** — Playwright against `npm run dev` has flaky Server Action handling (HMR + dev-mode race conditions). Build + start matches what runs on Vercel.

### OTP gate bypass strategies

The project has an OTP gate (Telnyx). Three options:

**Option A — Backend test-mode bypass (RECOMMENDED)**:
Add a server-side feature flag — when `NODE_ENV !== 'production' && TEST_MODE === 'true'`, the OTP endpoint accepts a fixed dev OTP (e.g., `000000`). This is the simplest and most stable. The Playwright `auth.setup.ts` posts the dev OTP and proceeds.

```typescript
// e2e/auth.setup.ts
import { test as setup } from '@playwright/test'
import path from 'path'

const authFile = path.join(__dirname, '../playwright/.auth/user.json')

setup('authenticate', async ({ page }) => {
  await page.goto('/wizard/start')
  await page.getByLabel(/phone/i).fill('555-555-0100')   // designated test number
  await page.getByRole('button', { name: /send code/i }).click()
  await page.getByLabel(/verification code/i).fill('000000')   // bypass OTP
  await page.getByRole('button', { name: /verify/i }).click()
  await page.waitForURL('/wizard/vehicle')
  await page.context().storageState({ path: authFile })
})
```

**Option B — TOTP generator + real OTP flow**: Use `otpauth` NPM package with a shared TOTP secret. More secure but requires generating TOTPs in tests — adds complexity.

**Option C — Real Telnyx mock via MSW interceptor**: Intercept the Telnyx send-OTP endpoint, capture the OTP from the intercepted payload, feed it back to the form. Most realistic but most fragile.

The Playwright community strongly prefers Option A for E2E. Real OTP integration testing belongs in a dedicated `telnyx-integration.test.ts` triggered manually, not on every PR.

### First test — full wizard happy-path

```typescript
// e2e/wizard-happy-path.spec.ts
import { test, expect } from '@playwright/test'

test('wizard: greeting → OTP → vehicle → service → diagnostic → date → summary → confirmation', async ({ page }) => {
  // 1. Greeting
  await page.goto('/wizard/start')
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible()

  // OTP already bypassed in auth.setup.ts → storageState

  // 2. Vehicle
  await page.goto('/wizard/vehicle')
  await page.getByLabel(/year/i).fill('2020')
  await page.getByLabel(/make/i).fill('Ford')
  await page.getByLabel(/model/i).fill('F-150')
  await page.getByRole('button', { name: /next/i }).click()
  await page.waitForURL('/wizard/service')

  // 3. Service selection
  await page.getByLabel(/oil change/i).check()
  await page.getByRole('button', { name: /next/i }).click()
  await page.waitForURL('/wizard/diagnostic')

  // 4. Diagnostic concern (this is the slow step — LLM-backed)
  await page.getByLabel(/describe the issue/i).fill('Brakes squeak when stopping')
  await page.getByRole('button', { name: /analyze/i }).click()
  // Wait for diagnostic result (LLM takes 2-8s; allow plenty of headroom)
  await page.getByText(/diagnostic complete/i).waitFor({ timeout: 30_000 })

  // 5. Date
  await page.goto('/wizard/schedule')
  await page.getByRole('button', { name: /tomorrow/i }).click()

  // 6. Summary
  await page.waitForURL('/wizard/summary')
  await expect(page.getByText(/F-150/)).toBeVisible()
  await page.getByRole('button', { name: /confirm/i }).click()

  // 7. Confirmation
  await page.waitForURL(/\/wizard\/confirmation/)
  await expect(page.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible()
})
```

### Accessibility scans with `@axe-core/playwright`

```typescript
// e2e/wizard-a11y.spec.ts
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const wizardSteps = [
  '/wizard/start',
  '/wizard/vehicle',
  '/wizard/service',
  '/wizard/diagnostic',
  '/wizard/schedule',
  '/wizard/summary',
]

for (const step of wizardSteps) {
  test(`a11y — ${step}`, async ({ page }) => {
    await page.goto(step)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })
}
```

WCAG 2.1 AA is the standard for our regulated-industry posture. Failures should block PR merge — accessibility regressions are easy to introduce and hard to spot in code review.

### Visual regression with `toHaveScreenshot()`

```typescript
test('wizard summary screen — visual baseline', async ({ page }) => {
  await page.goto('/wizard/summary')
  await expect(page).toHaveScreenshot('wizard-summary.png', {
    animations: 'disabled',
    mask: [
      page.getByTestId('appointment-time'),   // changes every run
      page.getByTestId('current-date'),
    ],
    maxDiffPixelRatio: 0.01,
  })
})
```

**Critical**: visual baselines MUST be generated in the same Linux container CI uses. Font rendering, sub-pixel anti-aliasing, scrollbar widths all differ across OS — local-generated baselines will fail in CI. Use Playwright's official Docker image (`mcr.microsoft.com/playwright`) for consistency.

### Best 2026 patterns

- **`page.getByRole`, `page.getByLabel`, `page.getByText`** — accessibility-tree-based locators. Faster + more reliable than CSS selectors. Auto-waits.
- **NEVER use `page.waitForTimeout()`**. Use `page.waitForURL()`, `expect(...).toBeVisible()`, `page.getByText(...).waitFor()`. Hard timeouts produce flaky tests.
- **Treat Server Actions as black boxes from Playwright's POV.** Test by interacting with forms + asserting the resulting UI state. Don't try to introspect the Server Action payload.
- **`toHaveScreenshot()` masking is essential.** Be aggressive about masking anything that changes between runs (timestamps, generated IDs, animated elements).
- **For LLM-backed flows (diagnostic)**: stub the LLM at the network layer for E2E tests OR use a test-mode flag that returns canned diagnostic results. Real LLM calls in CI = nondeterministic + costly.

### Common gotchas

- **`next/dynamic` + Playwright** — dynamic imports can race with Playwright's auto-wait. Use `page.waitForLoadState('networkidle')` sparingly when needed.
- **Hot-reload artifacts** — never run Playwright against `npm run dev`. Always `npm run build && npm run start`.
- **`storageState` leaks** — `playwright/.auth/` MUST be in `.gitignore`. Cookies are credentials.
- **Worker isolation** — for parallel tests that share DB state, partition by `testInfo.parallelIndex` and use unique test data per worker.

### Sources
- [Authentication — Playwright Docs](https://playwright.dev/docs/auth)
- [Test Configuration — Playwright Docs](https://playwright.dev/docs/test-configuration)
- [Testing: Playwright — Next.js Docs](https://nextjs.org/docs/pages/guides/testing/playwright)
- [Playwright Visual Regression Testing 2026 — Bug0](https://bug0.com/knowledge-base/playwright-visual-regression-testing)
- [How We Automate A11y Testing with Playwright and Axe — DEV / Subito](https://dev.to/subito/how-we-automate-accessibility-testing-with-playwright-and-axe-3ok5)
- [Playwright Authentication: 5 Patterns — TestDino](https://testdino.com/blog/playwright-authentication)
- [Playwright Storage State — TestLeaf](https://www.testleaf.com/blog/playwright-storage-state-reuse-login-multiple-users/)

---

## Topic 7 — Test coverage strategies for Server Actions + DAL refactor

### The Vercel-official "Thin Action / Fat DAL" pattern

This is now the explicit recommendation from Next.js — directly from the official `nextjs.org/docs/app/guides/data-security` page:

> "Just as we recommend a Data Access Layer for reading data, you can apply the same pattern to mutations. This keeps authentication, authorization, and database logic in a dedicated `server-only` module, while `"use server"` actions stay thin."

The canonical layout:

```
src/
├── lib/
│   └── dal/
│       ├── index.ts           # re-exports + shared helpers (requireEmployee, requireCustomer)
│       ├── customers.ts       # customer CRUD + business rules
│       ├── vehicles.ts
│       ├── repair-orders.ts
│       └── _types.ts          # DTO Zod schemas
├── app/
│   ├── actions/               # Server Actions — Thin wrappers
│   │   ├── customers.ts       # 5-12 lines each: parse input, delegate to DAL, return shape
│   │   └── ...
│   └── (wizard)/
│       └── ...
```

### Anatomy of a thin Server Action (5-12 lines)

```typescript
// app/actions/customers.ts
'use server'
import { actionClient } from '@/lib/safe-action'
import { CreateCustomerSchema } from '@/lib/dal/_types'
import { createCustomer } from '@/lib/dal/customers'
import { revalidatePath } from 'next/cache'

export const createCustomerAction = actionClient
  .inputSchema(CreateCustomerSchema)
  .action(async ({ parsedInput }) => {
    const result = await createCustomer(parsedInput)
    revalidatePath('/customers')
    return result
  })
```

That's the entire action. 5 lines of code. No tests needed — the `parsedInput` is Zod-validated automatically, the DAL handles everything else.

### Anatomy of a fat DAL function (testable)

```typescript
// lib/dal/customers.ts
import 'server-only'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireEmployee } from '@/lib/dal'

export async function createCustomer(input: CreateCustomerInput) {
  const { shop_id } = await requireEmployee()   // RBAC + tenant resolution

  // Authorization: only admin+ can create customers cross-shop
  // ... business rules ...

  const sb = createSupabaseAdminClient()
  const { data, error } = await sb
    .from('customers')
    .insert({ ...input, shop_id })
    .select()
    .single()

  if (error) {
    Sentry.captureException(error, { tags: { shop_id, operation: 'createCustomer' } })
    return { ok: false, error: 'CREATE_FAILED', timestamp: Date.now() }
  }

  return { ok: true, data: toCustomerDTO(data), timestamp: Date.now() }
}
```

This is testable with Vitest. Mock `createSupabaseAdminClient` + `requireEmployee`. Assert the insert payload includes `shop_id`. Assert error path captures Sentry. The Action itself doesn't need tests.

### Refactor strategy (high-level)

The project currently has 24/25 Server Actions with mixed business logic. Refactoring is incremental:

1. For each existing action, identify "the business logic block" — typically the bit between Zod parse and the return.
2. Extract that block into a function in `src/lib/dal/{module}.ts`.
3. The Action becomes the 5-12 line wrapper above.
4. Add unit tests against the extracted DAL function.
5. The existing Playwright E2E tests still cover the Action wrapper end-to-end.

Don't refactor all 24 at once. Do one per PR, with the DAL test landing alongside the refactor.

### Coverage thresholds

The Vitest doc recommends thresholds expressed via `coverage.thresholds`:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Exclude thin actions — they're just glue
        'src/app/actions/**',
        // Exclude generated files
        'src/lib/database.types.ts',
        // Exclude UI primitives
        'src/components/ui/**',
        '**/*.config.{js,ts,mjs}',
        '**/*.test.{ts,tsx}',
        '**/types/**',
      ],
      thresholds: {
        // Global (all included files)
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
        // Per-file overrides — DAL is the critical layer
        'src/lib/dal/**/*.ts': {
          lines: 85,
          functions: 90,
          branches: 80,
          statements: 85,
        },
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

**Key points**:
- **`coverage.exclude` for Server Actions** — they're 5-12 LoC wrappers. Trying to hit 80% on them produces nonsense tests. E2E covers them.
- **Per-file thresholds for DAL** — `src/lib/dal/**` gets stricter targets (85-90%).
- **Branches threshold lower than lines** — typical defensive `if (error)` paths are hard to cover without integration tests; 75% is realistic.
- **`reporter: ['text', 'lcov']`** — `lcov` enables Codecov / Coveralls integration. `text` for CI logs.

### CI enforcement

```yaml
- name: Run Vitest with coverage
  run: npm run test -- --coverage --reporter=verbose

- name: Upload coverage to Codecov
  if: success() || failure()
  uses: codecov/codecov-action@v4
  with:
    files: ./coverage/lcov.info
    fail_ci_if_error: false   # informational only — Vitest thresholds are the real gate
```

Vitest exits non-zero if thresholds aren't met. That's the gate — Codecov is purely visualization.

### Sources
- [Data Security — Next.js Docs](https://nextjs.org/docs/app/guides/data-security)
- [Vitest Coverage — Vitest Docs](https://vitest.dev/guide/coverage)
- [Vitest Coverage Config Reference](https://vitest.dev/config/coverage)
- [In a Next.js application, the Data Access Layer — Javad Mohammadi](https://medium.com/@javadmohammadi.career/in-a-next-js-cb8e180bf10a)
- [Structuring Your Data Access Layer in Next.js — MD Samrose](https://medium.com/@samrose.mohammed/structuring-your-data-access-layer-in-next-js-patterns-that-actually-scale-2e4c07491866)
- [Vitest Code Coverage with GitHub Actions — David Alvarado](https://medium.com/@alvarado.david/vitest-code-coverage-with-github-actions-report-compare-and-block-prs-on-low-coverage-67fceaa79a47)

---

## Topic 8 — Mocking the Anthropic SDK for `diagnose-concern` testing

### The specific shape: SDK direct path + structured outputs

`diagnose-concern.ts` uses `@anthropic-ai/sdk` directly (NOT `ai@^5`) with:

```typescript
client.beta.messages.create({
  output_format: { type: 'json_schema', json_schema: {...} },
  betas: ['structured-outputs-2025-11-13'],
  // ...
})
```

This is the Anthropic-native Beta Messages API with structured outputs. As of v0.67.0, the TS SDK exposes this via the `beta` namespace, with the `betas[]` header serialized into `anthropic-beta`. There is **no first-party mock client shipped with `@anthropic-ai/sdk`** — unlike `ai/test` for the Vercel SDK.

You have three options:

### Option A — `vi.mock` the SDK module (simplest)

```typescript
// __tests__/diagnose-concern.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn()
  return {
    default: vi.fn().mockImplementation(() => ({
      beta: {
        messages: {
          create: mockCreate,
        },
      },
    })),
    __mockCreate: mockCreate,   // exposed for assertions
  }
})

describe('diagnoseConcern', () => {
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const mod: any = await import('@anthropic-ai/sdk')
    mockCreate = mod.__mockCreate
    mockCreate.mockReset()
  })

  it('returns structured diagnostic on first attempt', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg_01',
      content: [{
        type: 'text',
        text: JSON.stringify({
          confidence: 0.92,
          primary_concern: 'brake_pad_wear',
          symptoms: ['squeak when stopping'],
          suggested_services: ['brake_inspection'],
        }),
      }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 250, output_tokens: 80 },
    })

    const { diagnoseConcern } = await import('@/lib/llm/diagnose-concern')
    const result = await diagnoseConcern({
      vehicle: { year: 2020, make: 'Ford', model: 'F-150' },
      concern_text: 'Brakes squeak when stopping',
    })

    expect(result.confidence).toBeGreaterThan(0.8)
    expect(result.primary_concern).toBe('brake_pad_wear')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        betas: ['structured-outputs-2025-11-13'],
      })
    )
  })

  it('retries on first failure and succeeds on attempt 2', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('rate_limit_error'))
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"confidence":0.85,...}' }], usage: {...} })

    const { diagnoseConcern } = await import('@/lib/llm/diagnose-concern')
    const result = await diagnoseConcern({/*…*/})

    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(result.confidence).toBe(0.85)
  })

  it('returns failSafe after 2 attempts', async () => {
    mockCreate.mockRejectedValue(new Error('overloaded'))

    const { diagnoseConcern } = await import('@/lib/llm/diagnose-concern')
    const result = await diagnoseConcern({/*…*/})

    expect(mockCreate).toHaveBeenCalledTimes(2)   // your 2-attempt cap
    expect(result.is_failsafe).toBe(true)
  })

  it('asserts token usage tracking', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"confidence":0.9,...}' }],
      usage: { input_tokens: 500, output_tokens: 150 },
    })

    const { diagnoseConcern } = await import('@/lib/llm/diagnose-concern')
    await diagnoseConcern({/*…*/})

    // Assert usage was captured to PostHog / metrics
    // (depends on your instrumentation surface)
  })
})
```

**Pros**: Simple. No network layer. Fast.
**Cons**: Tightly couples tests to SDK shape. If the SDK structure changes, all tests break.

### Option B — MSW + HTTP-layer interception

The SDK ultimately makes HTTP calls to `https://api.anthropic.com/v1/messages`. MSW intercepts at that layer:

```typescript
// test/msw/anthropic-handlers.ts
import { http, HttpResponse } from 'msw'

export const anthropicHandlers = [
  http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
    const body = await request.json() as any
    const betas = request.headers.get('anthropic-beta')

    // Inspect what was sent
    if (betas?.includes('structured-outputs-2025-11-13')) {
      return HttpResponse.json({
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{
          type: 'text',
          text: JSON.stringify({ confidence: 0.9, primary_concern: 'test', symptoms: [], suggested_services: [] }),
        }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 30 },
      })
    }

    return HttpResponse.json({/* non-structured response */})
  }),
]
```

```typescript
// vitest.setup.ts
import { setupServer } from 'msw/node'
import { anthropicHandlers } from './test/msw/anthropic-handlers'

export const server = setupServer(...anthropicHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

**Pros**: Most realistic. Tests SDK behavior end-to-end. Tests caught by HTTP-layer interception cover request serialization (headers, betas, etc.).
**Cons**: Heavier. Must keep handler in sync with API surface. Requires understanding MSW.

### Option C — Hybrid: thin SDK wrapper + mock the wrapper

The cleanest pattern long-term — abstract the Anthropic SDK behind a thin facade that your code calls:

```typescript
// lib/llm/anthropic-client.ts
import Anthropic from '@anthropic-ai/sdk'

export interface DiagnosticClient {
  generateStructured<T>(args: {
    model: string
    schema: Record<string, unknown>
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    max_tokens: number
  }): Promise<{ data: T; usage: { input_tokens: number; output_tokens: number } }>
}

export const realDiagnosticClient: DiagnosticClient = {
  async generateStructured({ model, schema, messages, max_tokens }) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.beta.messages.create({
      model,
      max_tokens,
      messages,
      output_format: { type: 'json_schema', json_schema: schema },
      betas: ['structured-outputs-2025-11-13'],
    })
    // ... parse + return ...
  },
}
```

```typescript
// Test:
const mockClient: DiagnosticClient = {
  generateStructured: vi.fn().mockResolvedValue({
    data: { confidence: 0.9, /*…*/ },
    usage: { input_tokens: 100, output_tokens: 30 },
  }),
}

const result = await diagnoseConcern({/*…*/}, { client: mockClient })
```

**Pros**: Cleanest test code, decouples from SDK surface, easy to swap providers.
**Cons**: Requires touching `diagnose-concern.ts` to accept the client as a dependency.

### Recommendation

**For `diagnose-concern.ts` specifically**: start with **Option A** (`vi.mock` the SDK). The function is 1287 LoC and the priority is getting tests in place quickly. Option C (the facade refactor) is a clean follow-up if the indirection ever becomes worth the abstraction.

**Coverage targets for `diagnose-concern.ts`**:
- 85% lines (3-stage diagnostic + retry + failSafe paths all reachable)
- 100% branches on the failSafe + retry-cap paths (these are the silent-failure surfaces)
- Mock all 3 stages independently to exercise each LLM call

### Sources
- [AI SDK Core: Testing — Vercel AI SDK Docs](https://ai-sdk.dev/docs/ai-sdk-core/testing)
- [How I Tested Streaming Responses with Vercel AI SDK — atrera.com](https://blog.atrera.com/post/unit-testing-streaming-ai-vercel-sdk/)
- [Beta Messages API — Anthropic TypeScript SDK / DeepWiki](https://deepwiki.com/anthropics/anthropic-sdk-typescript/4.1-beta-messages-api)
- [Beta Features — Anthropic TypeScript SDK / DeepWiki](https://deepwiki.com/anthropics/anthropic-sdk-typescript/4-beta-features)
- [Mocking Requests — Vitest Docs](https://vitest.dev/guide/mocking/requests)
- [Mocking Modules — Vitest Docs](https://vitest.dev/guide/mocking/modules)

---

## Appendix — `basejump-supabase_test_helpers` reference

Since multiple topics (1, 5, the existing 3 pgTAP files) depend on this helper library, the canonical API surface:

```sql
-- User management
tests.create_supabase_user(identifier, email, phone, metadata)  -- returns UUID
tests.get_supabase_user(identifier)                              -- returns JSON
tests.get_supabase_uid(identifier)                               -- returns UUID

-- Authentication context switching
tests.authenticate_as(identifier)                  -- impersonates user
tests.authenticate_as_service_role()               -- elevates to service role
tests.clear_authentication()                       -- resets to anon

-- RLS validation
tests.rls_enabled(schema)                          -- whole schema check
tests.rls_enabled(schema, table)                   -- per-table check

-- Time control
tests.freeze_time(timestamp)
tests.unfreeze_time()
```

Critical pgTAP idiom for testing blocked UPDATE/DELETE (the silent-filter pattern):

```sql
-- Negative test — user 2 cannot update user 1's row
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists "basejump-supabase_test_helpers";

select plan(2);

-- Setup
select tests.create_supabase_user('user1');
select tests.create_supabase_user('user2');
insert into todos (id, user_id, text) values
  ('00000000-0000-0000-0000-000000000001', tests.get_supabase_uid('user1'), 'hello');

-- Authenticate as user 2 and try to update user 1's row
select tests.authenticate_as('user2');
update todos set text = 'hacked' where id = '00000000-0000-0000-0000-000000000001';

-- Assert: zero rows actually modified (silent filter)
-- Must check VALUE — don't expect an exception
select tests.authenticate_as_service_role();
select results_eq(
  $$ select text from todos where id = '00000000-0000-0000-0000-000000000001' $$,
  $$ values ('hello'::text) $$,
  'user2 update should have been silently filtered — text unchanged'
);

select is_empty(
  $$ select id from todos where text = 'hacked' $$,
  'no row should have the hacked text'
);

select * from finish();
rollback;
```

**The cardinal rule**: blocked UPDATE/DELETE under RLS does NOT throw — it silently filters to zero rows. Assert row counts or unchanged data, NOT exceptions. INSERT does throw a `42501` permission error (testable via `throws_ok`).

### Sources for appendix
- [supabase-test-helpers README](https://github.com/usebasejump/supabase-test-helpers/blob/main/README.md)
- [Advanced pgTAP Testing — Supabase Docs](https://supabase.com/docs/guides/local-development/testing/pgtap-extended)
- [A Guide to testing on Supabase using pgTAP — Basejump](https://usebasejump.com/blog/testing-on-supabase-with-pgtap)
- [Database Testing with pgTAP — Makerkit](https://makerkit.dev/docs/next-supabase-turbo/development/database-tests)
- [Troubleshooting RLS Simplified — Supabase Docs](https://supabase.com/docs/guides/troubleshooting/rls-simplified-BJTcS8)

---

## Cross-topic observations

A few non-obvious patterns surfaced repeatedly across the research:

1. **The "Thin Action / Fat DAL" pattern is now Vercel's official position**, not just a community heuristic. It's documented at `nextjs.org/docs/app/guides/data-security`. This means our `pattern-compliance.md` rule was correctly anticipated. The refactor is no longer a project-specific judgment call — it's the canonical Next.js way.

2. **The Supabase team's primary testing posture is "real local stack, not mocks"** for both pgTAP (already established) and Deno edge function tests. Mocking is for unit-helper-function tests; integration runs against `supabase start`. This means the Deno test suite and the pgTAP suite share the same prerequisite — Docker + `supabase start` — and can run in the same CI job to amortize the cold-start cost.

3. **`@rushstack/eslint-patch` is on death row but not yet buried.** The Next.js 16 + ESLint 9 + flat config combination is currently "works but with friction." The clean path forward is to skip `eslint-config-next` entirely and import `@next/eslint-plugin-next` directly — sidesteps the patch problem completely.

4. **Playwright auth via storage state is universal for OTP-gated apps**, but the OTP bypass strategy itself is contested. Option A (backend test-mode flag accepting fixed dev OTP) is what the Playwright community recommends for the actual auth setup project; real OTP testing belongs in a dedicated integration test, not the main E2E flow.

5. **The Vercel AI SDK ships `MockLanguageModelV3` in `ai/test`** — for code that uses `generateObject` / `generateText`, this is a drop-in mock. The `@anthropic-ai/sdk` direct path has no equivalent first-party mock — `vi.mock` is the pragmatic answer.

6. **pgTAP silent-filter on UPDATE/DELETE is the single most underestimated testing gotcha in the Supabase ecosystem.** Multiple sources (Supabase docs, Basejump, Makerkit) all flag this; it deserves explicit verification in every RLS test we write.

End of research findings.

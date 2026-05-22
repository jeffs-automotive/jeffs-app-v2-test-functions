---
agent: research-server-action-atomicity
timestamp: 2026-05-22T16:00:00Z
scope: |
  Best-practice research, no code changes. Focused on Next.js 16 + Supabase Postgres 17
  Server-Action atomicity, race conditions, validation, cache-invalidation scoping,
  verification-mismatch handling, and Sentry tracing for multi-step actions.
constraints:
  - No Context7 MCP used; WebSearch + WebFetch only.
  - Citations from official Vercel/Next.js, Sentry, Postgres, Supabase docs +
    trusted blogs / GitHub examples.
sources_count: 32
audit_findings_addressed:
  - I-COR-1
  - I-COR-2
  - I-COR-3
  - I-COR-4
  - I-COR-5
  - I-COR-6
  - I-OTH-3
---

# Research: Server-Action atomicity, races, validation, revalidation scope

This output addresses the 8 topics asked, each with a 200-400 word synthesis, code
snippets where load-bearing, and a short source list. It does NOT recommend
implementation paths or open code changes — that is the planning agent's job.

---

## 1. Multi-step write atomicity in Next.js Server Actions

### Synthesis (~350 words)

The supabase-js client cannot start transactions because it speaks to PostgREST, and
PostgREST has no transaction primitives across separate HTTP calls. The canonical
workaround in 2026 — confirmed by Supabase Docs, the Marmelab Edge-Function
deep-dive, and the dev.to "Gotcha" article — is to wrap the multi-step write in a
**Postgres function** and invoke it via `supabase.rpc('fn_name', args)`. PostgREST
automatically surrounds the RPC call in a single Postgres transaction, so a
`RAISE EXCEPTION` (or unhandled error) inside the function rolls back every write.

```sql
CREATE OR REPLACE FUNCTION public.apply_wizard_transition(
  p_session_id uuid,
  p_to_step text,
  p_user_message jsonb,
  p_assistant_message jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_updated int;
BEGIN
  UPDATE wizard_sessions
     SET step = p_to_step, updated_at = now()
   WHERE id = p_session_id AND step <> p_to_step;  -- idempotent guard
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale_step');
  END IF;
  INSERT INTO wizard_messages (session_id, role, body) VALUES
    (p_session_id, 'user', p_user_message),
    (p_session_id, 'assistant', p_assistant_message);
  RETURN jsonb_build_object('ok', true, 'step', p_to_step);
END;
$$;
```

The supabase-js call returns `{ data, error }`; `error` is non-null iff Postgres
raised or PostgREST itself rejected. Use `RAISE EXCEPTION 'message' USING ERRCODE='P0001'`
for business errors and let the catch path in TS map error codes to envelope
shapes. RPC is preferred over an Edge Function for purely-DB multi-step writes
because (a) it removes a network hop, (b) it inherits RLS automatically when
`SECURITY INVOKER` (the default; use `DEFINER` only when you must), and (c) the
function body runs INSIDE the transaction the connection already opened.

Edge Functions are appropriate when the multi-step write must also call an
external API in the same atomic window — but they cannot use the supabase-js
client transactionally either; for cross-DB+API atomicity they connect with
`deno-postgres` and manage `BEGIN/COMMIT/ROLLBACK` themselves
(Marmelab pattern, 2025-12). For PgBouncer/Supavisor implications: RPCs from
supabase-js run inside one PostgREST connection that is bound to one Postgres
transaction, so they are safe under transaction-mode pooling. Long-running
client transactions (BEGIN ... multiple roundtrips ... COMMIT) are NOT — that
is exactly the limitation supabase-js declines to support.

### Sources
- [Use Supabase with Next.js — supabase.com/docs](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [Easy functions and transactions using Postgres + PostgREST or Supabase — dev.to/voboda](https://dev.to/voboda/gotcha-supabase-postgrest-rpc-with-transactions-45a7)
- [Transactions and RLS in Supabase Edge Functions — marmelab.com (2025-12-08)](https://marmelab.com/blog/2025/12/08/supabase-edge-function-transaction-rls.html)
- [Database Functions — supabase.com/docs](https://supabase.com/docs/guides/database/functions)
- [Client-side database transactions discussion #526 — github.com/supabase](https://github.com/orgs/supabase/discussions/526)

---

## 2. CAS (Compare-And-Swap) lock patterns in Postgres

### Synthesis (~370 words)

The canonical CAS pattern in Postgres is `UPDATE ... WHERE <guard> RETURNING ...`.
A single-row UPDATE acquires a row-level write lock and re-evaluates the WHERE
on the latest committed version after locking, so the operation is atomic at
**every** isolation level including the default READ COMMITTED. The application
treats `affected_rows = 0` as "lost the race" and either retries or surfaces a
domain-specific conflict error.

```sql
-- Idempotent step advance with CAS guard on previous step.
UPDATE wizard_sessions
   SET step = 'B', updated_at = now()
 WHERE id = $1 AND step = 'A'
RETURNING id, step;
```

`{ data, error } = await supabase.from('wizard_sessions').update(...).eq(...).select()` exposes
`data` as the array of returned rows; `data.length === 0` means the guard
didn't match. The Lawrence Jones write-up frames this as the HTTP-API CAS pattern
(client sends an ETag/version it previously read; server's UPDATE includes
`WHERE version = client_version`, returning 412 PRECONDITION FAILED on miss).
The EnterpriseDB read-modify-write piece flags the anti-pattern of doing the
check in TypeScript (read row → check version in JS → update row in second
roundtrip) — that opens a TOCTOU window the CAS UPDATE closes.

**CAS vs `pg_advisory_xact_lock` vs `SELECT FOR UPDATE`:**

- **CAS** — best when the contended state IS a column value (step, version,
  status). No lock leakage. Works through Supavisor transaction-pool mode.
  Zero rows updated = retry signal.
- **`SELECT FOR UPDATE`** — best when you must read several rows, then make
  a decision, then write. Blocks other readers that also `FOR UPDATE` the row;
  releases at COMMIT. SKIP LOCKED variant for queue-style consumers (Cybertec).
- **`pg_advisory_xact_lock`** — best when the resource to serialize is NOT
  a single row (e.g., "only one job per shop can run reconciliation"). Lock
  scope is the transaction; released at COMMIT/ROLLBACK. Critically: under
  PgBouncer/Supavisor **transaction-mode** you MUST use `xact` (not session)
  advisory locks; session-level advisory locks evaporate at the end of the
  transaction because the next query may land on a different backend (per
  Novemberde blog + Supavisor docs).

SERIALIZABLE isolation can replace application-level CAS for complex multi-row
guards but ALWAYS requires retry logic on `40001 serialization_failure`. Postgres
docs are explicit: "applications must be prepared to catch 'could not serialize
access' errors and retry the affected transaction." Most booking systems
prefer CAS + targeted `xact` advisory locks over global SERIALIZABLE because
the retry blast radius is smaller.

### Sources
- [Avoid PostgreSQL Anti-patterns: Read-Modify-Write Cycles — enterprisedb.com](https://www.enterprisedb.com/blog/postgresql-anti-patterns-read-modify-write-cycles)
- [Adding concurrency control to HTTP APIs — Lawrence Jones](https://blog.lawrencejones.dev/cas/)
- [SELECT FOR UPDATE in PostgreSQL — stormatics.tech](https://stormatics.tech/blogs/select-for-update-in-postgresql)
- [PostgreSQL Explicit Locking (current docs)](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Lock Contention: The Compare-and-Swap Approach — dashmind.com](https://dashmind.com/lock-contention-the-compare-and-swap-approach/)
- [Transaction Isolation — postgresql.org/docs/current](https://www.postgresql.org/docs/current/transaction-iso.html)
- [PostgreSQL Serialization Failures: Beyond 'Just Retry' — michal-drozd.com](https://www.michal-drozd.com/en/blog/postgresql-serialization-failure-retry/)

---

## 3. Defense-in-depth validation for Server Action writes

### Synthesis (~310 words)

Every Server Action is a public HTTP POST endpoint — Next.js compiles it into a
discoverable POST route reachable with `curl`. TypeScript types are erased at
runtime, so the only authoritative validators are Zod (or another schema parser)
at the action layer AND defense-in-depth at the storage layer (CHECK, FK, RLS).

The "user picks from server-issued list" anti-pattern — also called IDOR
(insecure direct object reference) — is the dominant failure mode for SaaS in
the Server-Action era. Both Makerkit's "5 Vulnerabilities" guide and Arcjet's
security post hammer this point. The fix is to **re-derive the allowed set
server-side and assert membership**, not to trust the client choice. Two
canonical patterns:

```ts
// Pattern A — query as filter (preferred, single roundtrip).
//   The DB returns 0 rows if the choice isn't owned. Treat 0 as "invalid".
const { data, error } = await supabase
  .from('vehicles')
  .update({ archived: true })
  .eq('id', input.vehicle_id)
  .eq('customer_id', session.customer_id)  // re-derive from session
  .select();
if (!data?.length) return { ok: false, error: 'NOT_ALLOWED' };

// Pattern B — pre-fetch + membership check (when you need the row first).
const allowed = await getVehiclesForCustomer(session.customer_id);
if (!allowed.some(v => v.id === input.vehicle_id)) {
  return { ok: false, error: 'NOT_ALLOWED' };
}
```

Pattern A is preferred because it's race-free (the row may have been deleted
between the membership check and the write). When the action consumes a
"pending candidate" set (e.g. `pending_candidates` in our codebase), the SAME
shape applies: read the set, build it server-side from the session/wizard
record, and re-assert membership on the chosen value. CHECK + FK constraints
on the column itself are the next layer: even if the action layer slips, a
FK pointing at a tenant-scoped lookup table will reject the row.

Postgres RLS is the third line, but it is NOT a primary defense — RLS
SELECT/UPDATE/DELETE failures **silently filter** rows rather than raise, so
the Server Action needs to treat row-count = 0 from the affected query as the
fail signal. This is why `pattern-compliance.md` already mandates "assert
row counts, not exceptions" for RLS-protected operations.

### Sources
- [Next.js server action security — blog.arcjet.com](https://blog.arcjet.com/next-js-server-action-security/)
- [Next.js Server Actions Security: 5 Vulnerabilities You Must Fix — makerkit.dev](https://makerkit.dev/blog/tutorials/secure-nextjs-server-actions)
- [Data Security guide — nextjs.org/docs](https://nextjs.org/docs/app/guides/data-security)
- [Type-Safe Server Actions in Next.js with Zod — yournextstore.com](https://yournextstore.com/blog/typesafe-server-actions-zod-nextjs)
- [Validate Next.js Server Actions with Zod — rabzelj.com](https://rabzelj.com/blog/nextjs-validate-server-action-zod)

---

## 4. Next.js `revalidatePath` vs `revalidateTag` scoping

### Synthesis (~400 words)

Next.js 16.2 (the version Vercel currently serves) makes `revalidateTag` the
preferred path for surgical cache invalidation; `revalidatePath` is now framed
as the broad-strokes option. The official "How Revalidation Works" page is
explicit about the under-the-hood mechanism: every route gets auto-generated
**soft tags** prefixed `_N_T_`. `revalidatePath('/blog/hello')` invalidates the
soft-tag set `{_N_T_/layout, _N_T_/blog/layout, _N_T_/blog/hello/layout,
_N_T_/blog/hello}`. The second `'layout'` parameter widens the blast radius to
all routes under that layout segment.

```ts
// Wide blast radius — invalidates ALL routes under the root layout.
revalidatePath('/', 'layout');  // worst case: caches for every URL marked stale

// Narrow blast radius — invalidates only the literal path's cache entries.
revalidatePath('/book/123');
```

Crucially, the docs note a current **temporary behavior**: when `revalidatePath`
is called from a Server Function, it ALSO causes "all previously visited pages
to refresh when navigated to again." Vercel says this will be tightened in a
future release, but today's behavior means a call to `revalidatePath('/')`
in a hot Server Action triggers an RSC re-render for every page in every
concurrent customer's router-cache window — a measurable cost at scale and a
direct match for the triple-fan-out observation in I-OTH-3.

`revalidateTag('my-tag', 'max')` is the surgical alternative. The 16.2 docs
mandate the second `profile="max"` argument (single-arg is deprecated; uses
stale-while-revalidate). Tags are scoped via either:

```ts
// Tagged fetch — for external/internal HTTP cache.
const r = await fetch(url, { next: { tags: [`session-${id}`, 'sessions-list'] } });

// Tagged 'use cache' function — for in-process cache.
async function getSession(id: string) {
  'use cache';
  cacheTag(`session-${id}`);
  return loadSession(id);
}
```

Including the session/user ID in the tag string gives per-session scoping; an
advance for session A no longer invalidates session B's RSC payload. The
multi-instance section of the docs makes clear that cache invalidations are
**local to the instance** by default and only propagate via a custom cache
handler's `updateTags`/`refreshTags` hooks — so on Vercel with rolling
deployments the blast radius is constrained AND propagation requires Vercel's
own cache handler (which they manage automatically on the platform).

For a multi-customer wizard, the well-tuned shape is: tag each session's
RSC payload with `session-${id}`, advance the wizard in a Server Action, call
`revalidateTag(\`session-${id}\`, 'max')`. Any other concurrent customer's
router-cache stays warm. No global path fan-out, no inadvertent RSC re-render
for users on other sessions.

### Sources
- [revalidatePath — nextjs.org/docs](https://nextjs.org/docs/app/api-reference/functions/revalidatePath)
- [revalidateTag — nextjs.org/docs](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)
- [How Revalidation Works — nextjs.org/docs](https://nextjs.org/docs/app/guides/how-revalidation-works)
- [Functions: cacheTag — nextjs.org/docs](https://nextjs.org/docs/app/api-reference/functions/cacheTag)
- [Deep Dive: Caching and Revalidating — github.com/vercel/next.js discussion #54075](https://github.com/vercel/next.js/discussions/54075)

---

## 5. Verification mismatch — surface vs proceed pattern

### Synthesis (~290 words)

The recurring industry pattern for "vendor write succeeded but verification
differs from our request" (I-COR-6) is a **three-state response envelope**
rather than the binary success/failure most APIs default to. Truto's
"404 Reasons" piece and the Hashnode "200 Status Code That Lied To Me"
write-up both name the failure: code conflates network-level success with
business-level acceptance.

The canonical resolution shape across hospitality, payment, and ticketing
booking systems (per Booking.com, Mews, and AppDirect's published guidance) is:

1. **Send with idempotency key.** Every external write carries a
   client-generated idempotency key so retries are safe AND the response can be
   correlated to the originating request even if the vendor's payload omits
   some echoed fields.
2. **Persist the OUR-side view first.** Write the in-progress booking row
   BEFORE the external call; mark it `status='pending_verification'`. If the
   external call drops, the row is the resumable anchor.
3. **Compare on response.** Diff our requested fields against the vendor's
   echoed fields. On match → mark `status='confirmed'`. On mismatch → mark
   `status='needs_review'` AND fall into a manual-review queue.
4. **Customer-facing copy.** The mismatch path does NOT silently proceed; it
   surfaces a "booked — but we noticed a difference; please confirm" message
   AND issues a reviewable record (per the keytag-style 6-character review
   code pattern documented in `.claude/rules/pattern-compliance.md`).

Idempotency and verification overlap: an idempotency key prevents duplicate
writes on retry; verification prevents silent acceptance of a write that
disagrees with what we asked for. Both are necessary. AppDirect's
"event-driven proactive reconciliation" framing is the longer-term shape —
re-poll the vendor on a schedule and reconcile, but the immediate-response
path must still gate on the verification diff.

### Sources
- [404 Reasons Third-Party APIs Can't Get Their Errors Straight — truto.one](https://truto.one/blog/404-reasons-third-party-apis-cant-get-their-errors-straight-and-how-to-fix-it/)
- [The 200 Status Code That Lied to Me — Hashnode crlapples](https://crlapples.hashnode.dev/the-200-status-code-that-lied-to-me-a-brutal-api-debugging-lesson)
- [Prevent Data Errors: Microservice Mismatch Guide — AppDirect](https://www.appdirect.com/blog/microservices-guide-detecting-data-mismatches)
- [Reservations API overview — developers.booking.com](https://developers.booking.com/connectivity/docs/reservations-api/reservations-overview)
- [Designing a Scalable Hotel Booking System — Rahul Garg](https://medium.com/@rahulgargblog/designing-a-scalable-hotel-booking-system-an-in-depth-technical-guide-6e9c6e7340d9)

---

## 6. `router.refresh` vs `revalidatePath` + server-state hydration

### Synthesis (~330 words)

These three calls operate on different caches; mixing them up is the source of
many "the page didn't update" bugs.

| Call | Scope | Where caller can be | Effect |
|---|---|---|---|
| `router.refresh()` | Current route, client-only | Client Component | Clears the per-browser Router Cache; re-fetches RSC payload; re-renders Server Components. Does NOT clear Data Cache / Full Route Cache. |
| `revalidatePath(path, type?)` | All caches keyed to that path | Server Action / Route Handler | Marks Data Cache + Full Route Cache stale via the path's auto-generated soft tag set. Next visit re-renders. |
| `revalidateTag(tag, profile)` | Any cache entry tagged | Server Action / Route Handler | Marks ONLY tagged entries stale; surgical. With `profile='max'` uses stale-while-revalidate. |

`router.refresh()` is the right call when the canonical state lives in the
RSC tree and the action ALREADY returned the updated row via its envelope
(react.dev pattern). In that case the Server Component re-renders against
the current DB state on the next request and the page is consistent — no
broader cache invalidation needed.

`useOptimistic` + `startTransition` is React 19's first-class way to render
the post-mutation state IMMEDIATELY in the client before the server confirms:

```tsx
const [optimisticState, addOptimistic] = useOptimistic(serverState, reducerFn);
function handle(formData) {
  startTransition(() => {
    addOptimistic(intendedNextValue);  // local render now
    advanceWizardAction(formData);     // server in flight
  });
}
```

The Epic React / sitepoint pieces are explicit about WHEN this is wrong:
destructive irreversible actions should NOT be optimistic (you cannot
"un-cancel"); rapid-fire actions where each fire depends on the last need
custom reducers because the optimistic state is recomputed from the latest
real state.

The "row-as-truth" pattern many teams use: the Server Action returns the
authoritative row in its envelope (`{ ok, data: row, timestamp }`); the
component sets local state from that row. As long as RSC payload also
reflects the same row on the NEXT navigation, no `revalidatePath` is needed
for in-tab freshness. Path/tag revalidation matters for OTHER tabs and
OTHER users.

### Sources
- [revalidatePath — nextjs.org/docs](https://nextjs.org/docs/app/api-reference/functions/revalidatePath)
- [useRouter (router.refresh) — nextjs.org/docs](https://nextjs.org/docs/app/api-reference/functions/use-router)
- [useOptimistic — react.dev](https://react.dev/reference/react/useOptimistic)
- [useOptimistic to Make Your App Feel Instant — Epic React, Kent C. Dodds](https://www.epicreact.dev/use-optimistic-to-make-your-app-feel-instant-zvyuv)
- [React useOptimistic: Production Patterns — sitepoint.com](https://www.sitepoint.com/react-useoptimistic-production-patterns-for-instant-ui-updates/)

---

## 7. Sentry tracing of multi-step Server Actions

### Synthesis (~340 words)

Sentry's official position (Sentry blog "Next.js Observability Gaps") is that
Server Actions are NOT auto-instrumented because they don't emit OpenTelemetry
spans the SDK can hook into. Without manual wrapping they appear as anonymous
server operations with no timing or context. The canonical wrap is:

```ts
'use server';
import * as Sentry from '@sentry/nextjs';
import { headers } from 'next/headers';

export async function advanceWizard(formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    'advanceWizard',
    {
      headers: await headers(),  // distributed trace continuation
      formData,
      recordResponse: true,
    },
    async () => {
      // ... action body with child spans below
    }
  );
}
```

`headers` enables distributed tracing — the client sends `sentry-trace` and
`baggage` headers; passing them in stitches the action's spans under the
client-initiated trace. `recordResponse: true` captures the envelope return
in Sentry events. `formData` captures submitted fields (be wary of PII —
use `beforeSend` to redact per `pattern-compliance.md`).

For multi-step actions, the docs recommend nested `startSpan` calls. Spans
started inside an active span automatically become children of that span,
forming a hierarchy:

```ts
await Sentry.withServerActionInstrumentation('advanceWizard', {...}, async () => {
  const session = await Sentry.startSpan(
    { name: 'load-session', op: 'db.query' },
    () => loadSession(sessionId)
  );
  const result = await Sentry.startSpan(
    { name: 'apply-transition', op: 'db.rpc',
      attributes: { session_id: sessionId, to_step: 'B' } },
    () => supabase.rpc('apply_wizard_transition', { ... })
  );
  await Sentry.startSpan(
    { name: 'tekmetric-confirm', op: 'http.client' },
    () => fetch(tekmUrl, { method: 'POST', ... })
  );
});
```

`startSpan` auto-ends on callback resolve. `startSpanManual` and
`startInactiveSpan` are for cases where the span lifetime can't fit in a
callback (e.g., an emitter pattern with no clear "done" event). The well-known
`op` values (`db.query`, `db.rpc`, `http.client`, `cache.get`, `cache.put`)
help Sentry's product surface group + filter spans correctly.

Custom-span instrumentation is necessary for: (a) every internal sub-step
worth timing in production, (b) every external API call, (c) every Postgres
RPC call distinct from auto-instrumented SDK calls. Auto-instrumentation in
the Next.js SDK covers route handlers and the React rendering phase — NOT
Server Action bodies or supabase-js calls.

### Sources
- [Set Up Tracing — sentry for Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/)
- [Custom Instrumentation — sentry for Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/instrumentation/custom-instrumentation/)
- [APIs (withServerActionInstrumentation) — sentry for Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/)
- [Next.js Observability Gaps & How to Close Them — blog.sentry.io](https://blog.sentry.io/next-js-observability-gaps-how-to-close-them/)
- [Span operations list — develop.sentry.dev](https://develop.sentry.dev/sdk/performance/span-operations/#list-of-operations)

---

## 8. RPC vs Edge Function vs Inline — decision framework

### Synthesis (~360 words)

The choice between Postgres RPC, Supabase Edge Function, and inline
supabase-js calls hinges on FOUR dimensions: atomicity guarantee, latency,
portability, and ability to call external services.

| Dimension | Inline supabase-js | Postgres RPC | Edge Function |
|---|---|---|---|
| Atomicity across multi-step writes | NONE (each call is its own tx) | STRONGEST (one tx via PostgREST) | Strong only if function opens BEGIN/COMMIT directly via deno-postgres |
| Round-trip latency on Vercel | 1 HTTP hop per call | 1 HTTP hop per RPC | 1 HTTP hop to edge runtime, then 1 to DB; ~50–200ms cold start |
| Can call external APIs | yes (from action layer above) | NO (pg_net is async-only, no sync HTTP) | YES (Deno fetch) |
| Code locality | TS in action body | SQL in migrations | TS in `supabase/functions/` |
| RLS enforcement | automatic per-call | inherited via SECURITY INVOKER (default); broken under DEFINER unless `search_path` + manual checks | manual via `SET LOCAL request.jwt.claim.sub` |
| Type safety | strong via supabase-js generated types | weak (jsonb return is opaque) | strong (TS) |
| Testability via Vitest | yes (DAL layer); see "Thin Action / Fat DAL" | only via integration tests | only via integration / Deno tests |

**Decision shortcut:**

- **Pure DB multi-step writes that must be atomic** → Postgres RPC. Lowest
  latency, strongest guarantee, easiest rollback (`RAISE EXCEPTION`).
- **DB writes + ONE external HTTP call where the external call comes AFTER
  the writes and on external failure the writes should rollback** → still
  RPC — open a Postgres function that does the writes, return rows to the
  action; the action then makes the external call; on external failure,
  call a SECOND RPC to compensate (the "saga" pattern). True
  distributed transactions across HTTP + DB are not achievable without 2PC.
- **DB writes + external HTTP call where they must be atomic AND
  external is your own service** → Edge Function with `deno-postgres`
  BEGIN/COMMIT — but accept the cold-start latency and the manual RLS
  scaffolding.
- **Single-row write or read with no atomicity concern** → inline
  supabase-js. Fastest to write, simplest to test.

The 17-line/50-line line: when an action body grows past ~30 lines of DB
calls, it's almost always cheaper to consolidate into one RPC than to keep
the logic in TS. The Marmelab piece notes the same threshold for Edge
Functions.

### Sources
- [Vercel Functions runtimes — vercel.com/docs](https://vercel.com/docs/functions/runtimes)
- [Monitoring latency: Vercel Serverless Function vs Vercel Edge Function — openstatus.dev](https://www.openstatus.dev/blog/monitoring-latency-vercel-edge-vs-serverless)
- [Database Functions — supabase.com/docs](https://supabase.com/docs/guides/database/functions)
- [Transactions and RLS in Supabase Edge Functions — marmelab.com](https://marmelab.com/blog/2025/12/08/supabase-edge-function-transaction-rls.html)
- [Edge Functions and Vercel: when and how to use them — ganeshjoshi.dev](https://ganeshjoshi.dev/blogs/edge-functions-vercel-basics)

---

## Cross-cutting addenda

### A. PgBouncer / Supavisor transaction-mode caveats (touches Topics 1, 2, 7)

Supavisor and PgBouncer in **transaction mode** unbind the application's
notion of "connection" from the Postgres backend after each transaction.
Practical implications:

- `pg_advisory_lock` (session form) is unsafe — release point is the backend,
  not the next-statement caller. Use `pg_advisory_xact_lock` only.
- Prepared statements with explicit names are forbidden in transaction
  mode (Supabase Docs / Supavisor v1.0). The supabase-js client doesn't
  use named prepared statements by default; Prisma does — `pgbouncer=true`
  in the connection string disables them.
- Multi-statement transactions started from the application layer DO work
  for the lifetime of a single connection-acquisition, but only as long as
  the pooler treats your BEGIN..COMMIT as one transaction. RPCs from
  supabase-js are safe because PostgREST opens, executes, and commits inside
  one such window.

### B. The triple-revalidate fan-out (I-OTH-3) is a real cost

Per the Next.js 16.2 docs, `revalidatePath('/')` invalidates the root layout
soft tag set, which transitively affects every route under `/`. In the current
release this also triggers refresh on previously-visited pages for each
concurrent client when they next navigate. The published soft-tag mechanism
makes the cost analytically traceable — for `revalidatePath('/'); revalidatePath('/book'); revalidatePath('/book-v2');`
the invalidation set is the UNION of three soft-tag sets, not three disjoint
events. A per-session `revalidateTag(\`session-${id}\`, 'max')` confines
the invalidation to exactly the cache entries that depend on that session's
state.

### C. Closing the I-COR-2 catch-all anti-pattern

Multiple sources (Sentry observability post, Makerkit "5 Vulnerabilities",
arcjet) call out catch-all `try { ... } catch {}` blocks as the dominant cause
of silent failures in Server Actions. A reset-flow that runs four sequential
writes followed by a single bare catch will swallow ALL four failures
identically. The 2026-current pattern is: wrap the multi-step in one RPC so
the catch-all has nothing to catch (Postgres rolls back atomically), OR use
typed error envelopes per step and surface each via Sentry's
`captureException` with `level: 'error'` plus distinguishing tags.

---

## Master source list (deduplicated)

### Next.js / Vercel (official)
- https://nextjs.org/docs/app/api-reference/functions/revalidatePath
- https://nextjs.org/docs/app/api-reference/functions/revalidateTag
- https://nextjs.org/docs/app/api-reference/functions/cacheTag
- https://nextjs.org/docs/app/api-reference/functions/use-router
- https://nextjs.org/docs/app/guides/how-revalidation-works
- https://nextjs.org/docs/app/getting-started/revalidating
- https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
- https://nextjs.org/docs/app/guides/data-security
- https://vercel.com/docs/functions/runtimes
- https://github.com/vercel/next.js/discussions/54075
- https://github.com/vercel/next.js/discussions/81385

### Supabase / Postgres (official)
- https://supabase.com/docs/reference/javascript/rpc
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/blog/supavisor-postgres-connection-pooler
- https://www.postgresql.org/docs/current/explicit-locking.html
- https://www.postgresql.org/docs/current/transaction-iso.html

### React (official)
- https://react.dev/reference/react/useOptimistic
- https://react.dev/reference/react/useActionState
- https://react.dev/blog/2024/12/05/react-19

### Sentry (official)
- https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/
- https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/instrumentation/
- https://docs.sentry.io/platforms/javascript/guides/nextjs/tracing/instrumentation/custom-instrumentation/
- https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/apis/
- https://blog.sentry.io/next-js-observability-gaps-how-to-close-them/
- https://develop.sentry.dev/sdk/performance/span-operations/

### Trusted blogs / GitHub
- https://blog.lawrencejones.dev/cas/
- https://blog.arcjet.com/next-js-server-action-security/
- https://makerkit.dev/blog/tutorials/secure-nextjs-server-actions
- https://makerkit.dev/blog/tutorials/nextjs-server-actions
- https://marmelab.com/blog/2025/12/08/supabase-edge-function-transaction-rls.html
- https://dev.to/voboda/gotcha-supabase-postgrest-rpc-with-transactions-45a7
- https://www.enterprisedb.com/blog/postgresql-anti-patterns-read-modify-write-cycles
- https://stormatics.tech/blogs/select-for-update-in-postgresql
- https://dashmind.com/lock-contention-the-compare-and-swap-approach/
- https://github.com/orgs/supabase/discussions/526
- https://github.com/orgs/supabase/discussions/30334
- https://truto.one/blog/404-reasons-third-party-apis-cant-get-their-errors-straight-and-how-to-fix-it/
- https://www.appdirect.com/blog/microservices-guide-detecting-data-mismatches
- https://www.openstatus.dev/blog/monitoring-latency-vercel-edge-vs-serverless
- https://www.epicreact.dev/use-optimistic-to-make-your-app-feel-instant-zvyuv
- https://www.sitepoint.com/react-useoptimistic-production-patterns-for-instant-ui-updates/
- https://medium.com/@rahulgargblog/designing-a-scalable-hotel-booking-system-an-in-depth-technical-guide-6e9c6e7340d9
- https://www.michal-drozd.com/en/blog/postgresql-serialization-failure-retry/
- https://yournextstore.com/blog/typesafe-server-actions-zod-nextjs
- https://rabzelj.com/blog/nextjs-validate-server-action-zod
- https://crlapples.hashnode.dev/the-200-status-code-that-lied-to-me-a-brutal-api-debugging-lesson

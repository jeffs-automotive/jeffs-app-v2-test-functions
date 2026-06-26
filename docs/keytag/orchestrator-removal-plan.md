# Removing the orchestrator-mcp passthrough from the keytag module — plan

**Status:** proposed (2026-06-26) · awaiting Chris's decision on the open questions in §11
**Author:** Claude (Opus 4.8), from a multi-agent research workflow (8 mappers → 4 candidate
architectures → 4 adversarial critiques → lead-architect synthesis; 17 agents, ~2.4M tokens)
**Related:** [`AUDIT-2026-06-25.md`](AUDIT-2026-06-25.md) (B1 = the dashboard-timeout this addresses),
[`keytag-audit-fixes-plan.md`](keytag-audit-fixes-plan.md) (the fixes just shipped), the keytag
architecture memory.

---

## TL;DR

Chris's directive: *"orchestrator-mcp is a passthrough adding latency + [caused] the 45s failure;
board/dashboard READS should be direct backend code."*

**Recommendation — a read-first hybrid:**

1. Move the **pure-DB reads** the admin-app makes (dashboard, board, manual-reviews, audit history)
   to **direct-from-Node** code in the admin-app, eliminating the whole gateway tax on exactly the
   paths Chris named. These reads touch **zero defense surface** (no writes, no RPCs, no Tekmetric, no
   confirmation tokens), so this is the highest-value, lowest-risk cut.
2. Single-source the read logic via a small **shared TypeScript package** so the admin-app, the Deno
   daily-report, and Claude Desktop can't drift — rather than copy-pasting ~427 LOC of query bodies.
3. **Leave every mutation byte-for-byte on the gateway.** The 4 Pattern-A confirmation mutations,
   Pattern-B review resolution, and bulk-reconcile keep their proven path. Whether to remove their hop
   too is a **separate, explicitly-gated decision (Phase 4)** — not started until the reads are stable
   in prod **and** the open B1 orphaned-token bug is independently closed.

This satisfies Chris's literal ask now, de-risks the rest, and never interleaves a transport change
with the unfixed, timing-sensitive confirmation bug.

---

## 1. Why this exists

The admin-app `/keytags` surface reaches **every** keytag operation by HTTP POST to the
`orchestrator-mcp` edge function (the MCP gateway), which — per request — rebuilds a 66-tool MCP
registry, parses a JSON-RPC 2.0 envelope, dispatches to the keytag tool's `execute()`, and double
JSON-encodes the result. For a latency-sensitive **read** on the dashboard render + 60s poll path,
that gateway tax is pure overhead. It was the structural cause of the B1 dashboard spin/timeout (a 45s
Tekmetric walk on the dashboard read path, since reduced to a pure DB read with a 10s seatbelt — but
still behind the full gateway hop).

Chris wants the read paths converted to **direct backend code**. This plan scopes that precisely and
sequences it so the live keytag system (4-layer defense + Pattern-A/B + Claude Desktop + the shared
scheduler transport) is never put at risk.

---

## 2. Current architecture (the coupling to remove)

### 2.1 One transport chokepoint

Every keytag call funnels through **one** function:

```
Server Component / Server Action
  → callKeytagTool<N>(toolName, args, actorEmail)        admin-app/src/lib/orchestrator/client.ts:305
  → callOrchestratorRpc(toolName, args, actorEmail)      client.ts:147   ← SHARED with scheduler
  → POST {SUPABASE_URL}/functions/v1/orchestrator-mcp
        JSON-RPC: {jsonrpc:'2.0', id, method:'tools/call', params:{name, arguments}}
        headers: Authorization: Bearer <service-role>, apikey, X-Actor-Email, Content-Type
  → orchestrator-mcp: buildMcpToolRegistry (66 tool() objects rebuilt PER CALL,
        mcp-tool-registry.ts:105) → getOrchestratorTools → keytag tool execute()
  → result wrapped {result:{content:[{type:'text', text:<JSON-string>}]}}  index.ts:585
  → callOrchestratorRpc unwraps content[0].text → JSON.parse → typed result  client.ts:275
```

- `callOrchestratorRpc` is **shared** with `/schedulerconfig`'s 11 `callSchedulerTool` actions — it
  **must not be edited** by this work.
- `buildOrchestratorUrl()` fail-closes on two host gates (`.supabase.co` suffix + must equal
  `NEXT_PUBLIC_SUPABASE_URL` host) and has a `KEYTAG_E2E_MOCK` localhost branch (client.ts:62-108).
- **Response contract:** tool-level `{ok:false}` (not-found / validation / the Pattern-A
  `needs_confirmation` envelope) is returned **as data**; only transport/protocol failures + `isError`
  throw `OrchestratorClientError`. Every action's `try/catch` branches on
  `e instanceof OrchestratorClientError`.

### 2.2 The operation inventory (11 live tools)

| # | Tool | Kind | admin-app caller | Latency-critical? |
|---|---|---|---|---|
| 1 | `getKeytagDashboard` | read (pure DB) | `dashboard-cache.ts:28` (unstable_cache 60s, 10s seatbelt) | **yes** (B1) |
| 2 | `listWipKeyTags` | read (pure DB) | `load-board-state.ts:54` | **yes** |
| 3 | `listManualReviews` (board) | read (pure DB) | `load-board-state.ts:55` | **yes** |
| 4 | `listManualReviews` (tab) | read (pure DB) | `ManualReviewsTab.tsx` | no |
| 5 | `getKeytagAuditHistory` | read (pure DB) | `AuditHistoryTab.tsx:102` | no |
| 6 | `assignKeytagToRo` (force) | **mutation + Pattern-A** | `assign-keytag.ts:106` | no |
| 7 | `releaseKeytagFromRo` | **mutation + Pattern-A** | `release-keytag.ts:69` | no |
| 8 | `revertKeytagToAssigned` | **mutation + Pattern-A** | `revert-keytag.ts:68` | no |
| 9 | `markKeytagPosted` | **mutation + Pattern-A** | `mark-keytag-posted.ts:71` | no |
| 10 | `resolveManualReview` | **mutation + Pattern-B** | `resolve-manual-review.ts:69` | no |
| 11 | `runBulkReconcile` | **mutation**, 60s | `run-bulk-reconcile.ts:57` | no |
| (12) | `whoIsOnTag` | read (3 **Tekmetric** GETs) | `who-is-on-tag.ts:42` | no (on-demand only) |
| — | `lookupManualReview` | dead | `types.ts:533` — **zero callers** | — |

Reads 1–5 are verified **pure `.from().select()`** with no Tekmetric and no RPC (since the 2026-06-25
dashboard fix). `whoIsOnTag` is *not* a render-path read (3 serial Tekmetric GETs) — it must stay off
any Suspense boundary regardless of where it lives.

### 2.3 The constraints any removal must respect

- **Deno ↔ Node wall.** The keytag tools live in `supabase/functions/_shared/**` as Deno code
  (`npm:`/`jsr:` specifiers, `Deno.env`, `Deno.serve`). The admin-app is Node/Next 15 and **cannot
  import them** — which is *why* `orchestrator/types.ts` hand-redeclares all 12 tool arg/result shapes
  today (`KeytagToolMap`). "Direct backend code" therefore requires choosing how the logic crosses
  that wall.
- **Pattern-A is a two-call round-trip through the same tool.** Call 1 (no token) → the gateway returns
  `{ok:false, needs_confirmation:true, confirmation:{token_id, expires_at, scope_summary}}`; the UI
  opens `ConfirmationDialog`; on Confirm the form re-dispatches the **same** action with
  `confirmation_token` → call 2 atomically consumes + applies. The token is issued + consumed **inside**
  the Deno tool, and the open **B1** bug (tokens orphaned by a `<Suspense>` remount on the
  `force-dynamic` route) is sensitive to anything that changes *when* the action re-renders.
- **Revalidation asymmetry (load-bearing for the spin fix).** `assign`/`release` deliberately **skip**
  `revalidatePath('/keytags')` (the board splices optimistically); `revert`/`markPosted`/
  `runBulkReconcile`/`resolveManualReview` **do** revalidate. Any change to call latency/timing must
  preserve this asymmetry or risk re-introducing the post-success spin.
- **Auth + audit-source.** Actions call `requireAdmin()` (Entra → `getUser()` + `@jeffsautomotive.com`)
  first, then pass `email` → `X-Actor-Email`, which the gateway turns into the audit `source='admin_app'`
  + `user_label`. Server-side resolved, never client-supplied.
- **Defense lives in the DB, not the gateway.** L2/L4/Pattern-B/audit-source are enforced inside the
  `SECURITY DEFINER` RPCs and the `ar_lockdown` trigger (the GUC is `set_config(...,true)` *inside* the
  RPCs — migration `20260511210000:92,149,205`). This is what makes a direct-from-Node path *possible*
  without a migration: call the same RPCs and every layer is preserved.

---

## 3. Decision — recommended approach

**Approach D (hybrid) as the spine, implemented with Approach C's shared-source mechanism for the
reads, and the mutation hop deferred behind an explicit C-vs-A decision gate.**

- **D's spine:** reads move direct-from-Node; **all** mutations + confirmation stay byte-for-byte on
  the gateway (so L1–L4, Pattern-A/B, audit-source, and the in-flight B1 investigation are untouched).
- **C's mechanism for the reads:** one shared TS source so the admin-app read DAL and the Deno
  daily-report / Claude-Desktop reads cannot drift — instead of copying ~427 LOC of query bodies.
- **Deferred mutation decision (Phase 4):** if Chris wants the mutation hop gone too, choose then
  between extending the shared package to mutations (zero hop) or a thin keytag mutation edge fn (one
  thin hop, no registry). **Not** started until the reads are stable **and** B1 is independently closed.

This is the decisive call: **ship the reads direct-from-Node via a shared source package now; defer
mutations behind an explicit gate.**

---

## 4. Alternatives considered

| Approach | Score | Verdict | Why not the lead |
|---|---:|---|---|
| **A** — thin per-domain keytag edge fns (drop the registry, keep one HTTP hop) | 6.0 | with-changes | Keeps the hop Chris called the latency source, and risks a **cold-start regression**: `orchestrator-mcp` is continuously warm (serves Claude Desktop + 11 SC actions); a new low-traffic `keytag-*` isolate cold-starts *more often* between the 60s/15s polls — worse P95 on the exact read it claims to fix. **Good candidate for *mutations* later.** |
| **B** — full Node DAL re-implementation (zero hop) | 5.0 | with-changes | Forking `computeScopeHash` (SHA-256, Pattern-A) risks silent token-consume **desync** vs the Deno/Claude-Desktop path; its "swap only the transport" claim is false (removing the transport removes `OrchestratorClientError`, forcing a rewrite of every action's catch branch — the timing-sensitive B1 surface); and it mis-scoped the inventory. |
| **C** — shared `@jeffs/keytag-core` package, one source/two runtimes | 7.5 | with-changes | **Right mechanism, wrong first move.** Its Phase 1 re-points the *deployed gateway's* `getOrchestratorTools` imports first — touching Claude Desktop's only keytag entry point before delivering any admin-app value. We adopt C's package but consume it **admin-app-side first**. |
| **D** — hybrid: direct-Node reads, mutations on the gateway | 7.0 | with-changes | The chosen spine. Critique corrected two scope items (include `getKeytagAuditHistory` + the `ManualReviewsTab` caller of `listManualReviews`; hoist `listWipKeyTags`/`findRoByKeyTag` off the Deno HTTP client) — both folded in below. |

The synthesis grafts **C's sharing mechanism onto D's read-first slicing**, with the riskiest C step
(re-pointing the deployed gateway imports) dropped from the read phase entirely.

---

## 5. What moves where (per-operation)

**Direct-Node** = new `admin-app/src/lib/keytag/read-dal.ts` (`import "server-only"`) via
`createSupabaseAdminClient()`. **Gateway** = unchanged `callKeytagTool → orchestrator-mcp`.

| Operation | Kind | Today | New home | Phase |
|---|---|---|---|---|
| `getKeytagDashboard` | read, latency-critical | `dashboard-cache.ts:28` | **Direct-Node** (`buildKeytagDashboardData`) | 1 |
| `listWipKeyTags` | read, latency-critical | `load-board-state.ts:54` | **Direct-Node** (hoisted `keytag-reads.ts`) | 2 |
| `listManualReviews` (board) | read, latency-critical | `load-board-state.ts:55` | **Direct-Node** (`manual-review-list.ts:139`) | 2 |
| `listManualReviews` (tab) | read | `ManualReviewsTab.tsx` | **Direct-Node** (same DAL fn) | 2 |
| `getKeytagAuditHistory` | read | `AuditHistoryTab.tsx:102` | **Direct-Node** (`keytag-extras.ts:694`) | 2 |
| `assignKeytagToRo` (force) | Pattern-A | `assign-keytag.ts:106` | **Gateway** (unchanged) | Deferred |
| `releaseKeytagFromRo` | Pattern-A | `release-keytag.ts:69` | **Gateway** | Deferred |
| `revertKeytagToAssigned` | Pattern-A | `revert-keytag.ts:68` | **Gateway** | Deferred |
| `markKeytagPosted` | Pattern-A | `mark-keytag-posted.ts:71` | **Gateway** | Deferred |
| `resolveManualReview` | Pattern-B | `resolve-manual-review.ts:69` | **Gateway** | Deferred |
| `runBulkReconcile` | mutation, 60s | `run-bulk-reconcile.ts:57` | **Gateway** | Deferred (low priority) |
| `whoIsOnTag` | read (3 Tekmetric GETs) | `who-is-on-tag.ts:42` | **Gateway** (keep off Suspense) | Deferred |
| `lookupManualReview` | dead | `types.ts:533` | delete the dead entry | Cleanup |

**Boundary rule:** every operation that writes audit, calls an RPC, touches Tekmetric, or
issues/consumes a confirmation token **stays on the gateway** in this scope. Only pure
`.from().select()` reads move — which is what keeps Phases 1–2 a non-security-review change.

---

## 6. The Deno/Node decision

**Reads are single-sourced into a small shared package (`packages/keytag-core`, read slice only);
mutations are NOT ported and stay Deno-only behind the gateway.**

The sharing research verified the read closure is ~95% runtime-portable:

- Every `@supabase/supabase-js` reference in the read files is `import type { SupabaseClient }` —
  **type-only, erased at compile**; the package is isomorphic and already in `admin-app/package.json`.
  Read fns are parameterized `(sb, shopId, args)`, so a Node caller constructs a Node client and passes
  it in.
- `crypto` / `fetch` / `TextEncoder` are Node 20+ globals (admin-app runs Node 24). The read files have
  **no `Deno.env`, no `Deno.serve`, no `jsr:`**.

Two bounded reconciliations:

1. **`.ts`-extension relative imports** (Deno requires them; Node ESM forbids at runtime). Consume the
   package through Next's bundler via `transpilePackages: ['@jeffs/keytag-core']` (Turbopack
   auto-transpiles workspace packages). admin-app tsconfig already uses `moduleResolution: bundler` +
   `verbatimModuleSyntax: true`, and the Deno files already use `import type` for all type imports — so
   they satisfy the stricter settings.
2. **`repair-orders.ts` runtime coupling** — `repair-orders.ts:16-21` statically imports the *runtime
   value* `tekmetricGetJson` from `tekmetric-client.ts`. So **hoist `listWipKeyTags` + `findRoByKeyTag`
   into a new `keytag-reads.ts`** that imports only the pure `buildTekmetricRoUrl` from `tekmetric.ts`,
   keeping the Deno HTTP client + its module-scope token cache out of Next's module graph.

**Why share, not copy:** the Deno daily-report email and Claude Desktop import the *same* read logic.
Copying `buildKeytagDashboardData` (~358 LOC) lets the dashboard/email/Claude-Desktop reads silently
diverge on stale-detection / ARN-provenance filtering. One source keeps them in lockstep — and unlike
the mutation files, the reads carry no `Deno.env`, no scope_hash, no email leaf, so the codemod cost the
heavy files would incur doesn't apply.

**Why NOT extract the mutation files now:** `keytag-management.ts` (607 LOC), `keytag-extras.ts` (787),
`manual-review-tools.ts` (744) carry the confirmation gate, Tekmetric PATCH, and the only
`Deno.env`-coupled leaf (`manual-review-email.ts`). That extraction is the deferred C-vs-A decision, not
part of the read win.

---

## 7. Auth + audit contract (read path)

Reads are read-only, so the audit-source contract is **not exercised** on this path — a key reason the
reads are the safe first cut.

- **Authenticate:** each Server Component / poll action calls `requireAdmin()` (`auth.ts:34`) first.
  Unchanged.
- **Authorize the backend:** the read DAL uses `createSupabaseAdminClient()` (`admin.ts:15`) — the same
  server-only service-role key (`resolveServiceRoleKey`), never `NEXT_PUBLIC_`. This matches today: the
  7 keytag tables are **RLS-enabled with zero policies**, so service-role is the *only* working read
  path. The DAL file carries `import "server-only"`.
- **Shop scoping:** `shop_id` resolved server-side via `resolveAdminShopId()` (`shop-id.ts:26` → 7476),
  used only to build Tekmetric RO URLs, **never** a DB filter (no keytag table has a `shop_id` column)
  and **never** from client input. Multi-tenant contract preserved.
- **No actor/source on reads:** reads write no audit rows, so the `X-Actor-Email → source='admin_app'`
  synthesis (and the M1 fix) belong to the mutation path — untouched here.
- **Error contract:** the read DAL throws a typed error the loaders already catch. Verified safe —
  `DashboardTab`, `LiveBoardTab`, and `board-state.ts` each have a generic fallback branch in addition
  to the `OrchestratorClientError` branch, so a plain `Error` from a direct DB read still renders the
  error card.

---

## 8. Defense-layer preservation

Because **every mutation stays byte-for-byte on the gateway path**, all layers are preserved by *not
touching them*:

- **L1 (webhook auto-assign gates):** separate edge path, never on the admin-app surface. Untouched.
- **L2 (Pattern-A tokens):** issue/consume + `computeScopeHash` (`keytag-confirmation.ts`) run in the
  same Deno runtime on both calls; the two-call round-trip + `AssignKeytagForm` re-dispatch contract are
  unchanged. **The open B1 orphaned-token bug is not perturbed** by the read migration — a deliberate
  property of D over A/B/C, since the reads never change action re-render timing.
- **L3 (chat rules):** N/A to admin-app; the live Claude-Desktop L3 (per-tool `description` strings +
  the `needs_confirmation` envelope) is untouched.
- **L4 (ar_lockdown GUC trigger):** preserved — mutations still call the RPCs that `SET LOCAL
  keytag.ar_mutation_allowed='1'` inside themselves (`20260511210000:92,149,205`). Reads do no writes,
  so they can't trip or bypass L4. *(Invariant for any future mutation move: route every `posted_ar`
  transition through the RPC, never a raw `.from('keytags').update()`.)*
- **Pattern-B manual review:** `resolveManualReview` stays on the gateway → the 6-char-code-as-approval
  + 3-fails/hr lockout + email leaf all stay in Deno. Untouched.
- **Audit-source attribution:** still synthesized at the gateway auth branch (`index.ts:329-335`); reads
  write no audit rows. The dashboard's ARN-provenance filter (`keytag-dashboard-data.ts:253`, which
  *reads* `source`) keeps working.

**The read migration cannot weaken any defense layer because it performs no mutation, no RPC, no audit
write, and no Tekmetric call.**

---

## 9. Claude Desktop + scheduler — untouched

- **Claude Desktop:** `orchestrator-mcp`, `mcp-auth` (DCR + PKCE), `buildMcpToolRegistry`,
  `getOrchestratorTools`, and every keytag `execute()` stay deployed and unchanged. The sequencing does
  **not** re-point the deployed gateway's imports during the read phase (the correction to Approach C).
  Tokens stay RFC-8707 audience-bound to the literal name `orchestrator-mcp` (`oauth.ts:197`) — no
  rename, no token invalidation. `tools/list` stays complete.
- **Scheduler-config:** the 11 `callSchedulerTool` actions keep routing through the **shared**
  `callOrchestratorRpc` (`client.ts:147`), which is **not edited**. The read migration adds a *separate*
  `read-dal.ts` and re-points only the keytag read loaders/tabs. Scheduler blast radius: **zero**.
- **Gateway Branch A** (`SERVICE_ROLE + X-Actor-Email`) stays because admin-app mutations still use it.
  Retiring it is a later decision, only if mutations also move.

---

## 10. Phased migration plan

Each phase is independently shippable (`git push origin main` → Vercel) with its own verification and
one-line-ish rollback. No big-bang.

### Phase 0 — build-seam spike (no behavior change)
Stand up `packages/keytag-core` with the **read slice only**: hoist `listWipKeyTags`/`findRoByKeyTag`
into `keytag-reads.ts`; move `keytag-dashboard-data.ts`, `keytag-dashboard-tool.ts`,
`manual-review-list.ts`, the pure `tekmetric.ts`, and the audit-history read into the package. Wire
`transpilePackages` (+ `outputFileTracingRoot` if needed) in `admin-app/next.config.ts`; add a
`deno.json` import-map so the edge fns resolve the same source; confirm a green build across **all
three** consumers (Next/Turbopack, Deno edge, Vitest).
- **Verify:** admin-app `npm run typecheck` + `npm run build` clean; `supabase functions deploy`
  dry-build of an edge fn importing the package; a Vitest **parity test** asserting Node read output
  shape == a recorded Deno snapshot.
- **Rollback:** package is unused by any caller — delete it.
- **Note:** this build topology (a package outside `admin-app/`, `transpilePackages`, Vercel
  file-tracing) has **no precedent in this repo** — it is the dominant cost; budget real time here.

### Phase 0b — M1 audit-source fix (independent, gateway-side, ship anytime)
Thread `source='admin_app'` + a real `user_label` into `revertKeytagToAssigned`/`markKeytagPosted`/
`resolveManualReviewTool` and the manual-review dispatcher's `writeAuditLog` calls (today hard-coded
`claude_desktop` at `keytag-extras.ts:373,527` + ~10 sites in `manual-review-tools.ts`). **Critical:**
also add `source` **forwarding** in `orchestrator-tools.ts` for those tools — adding the param to the
tool fn alone leaves it unpopulated on the gateway path. Keep `source` **optional**, defaulting to
`claude_desktop`, so Claude Desktop is unchanged. The DB already accepts `admin_app` (`20260624140000`).
- **Verify:** a dashboard revert / mark-posted / review-resolve writes
  `keytag_audit_log.source='admin_app'` (MCP `execute_sql` read-back).
- **Rollback:** revert the param threading (default preserved Claude Desktop).
- **Why separate:** a pre-existing mutation-path bug, orthogonal to the passthrough removal; stops
  today's mis-attribution immediately. **Recommended to ship first.** (This is the deferred audit item
  M1.)

### Phase 1 — dashboard read direct-from-Node (the B1 latency fix)
Add `admin-app/src/lib/keytag/read-dal.ts` (`import "server-only"`) with `getDashboard(shopId)` calling
the package's `buildKeytagDashboardData` via `createSupabaseAdminClient()` + `resolveAdminShopId()`.
Re-point `dashboard-cache.ts:28` from `callKeytagTool('getKeytagDashboard')` to the DAL; **keep**
`unstable_cache(60s)` + the 10s seatbelt + the existing catch branch in `DashboardTab`.
- **Verify:** dashboard renders identically; MCP `get_logs`/Sentry confirm the 60s `DashboardPoller`
  refresh no longer hits `orchestrator-mcp`; P95 drops. **Cold-start is a non-issue** — the read runs
  in-process in the already-warm Vercel function (the structural advantage over Approach A).
- **Rollback:** flip `dashboard-cache.ts` back to `callKeytagTool` (one line).

### Phase 2 — board + tab reads
Add `listWipKeyTags`, `listManualReviews`, `getKeytagAuditHistory` to the DAL. Re-point
`load-board-state.ts:54-55` (keep the `Promise.all`), **and** `ManualReviewsTab.tsx`, **and**
`AuditHistoryTab.tsx:102`. `UntaggedBoardRow` shaping unchanged.
- **Verify:** board parity (tagged + untagged rows match the gateway output via the Phase-0 parity
  test); assign/release optimistic splice + reconverge still behave; audit/review tabs render
  identically.
- **Rollback:** per-loader flip back to `callKeytagTool`.

### Phase 3 — verify + cleanup
Run `/code-review` (fail-closed) + the keytag pgTAP/Vitest. Confirm Claude Desktop `tools/list` + a
keytag read over OAuth still work (gateway untouched) and `/schedulerconfig` is unaffected. Delete the
dead `lookupManualReview` entry (`types.ts:533`). Optionally drop the now-unused `actorEmail` arg from
the dashboard cache key.

### Phase 4 — DECISION GATE: mutations (explicitly deferred)
Only after (a) the reads are stable in prod **and** (b) the **B1 orphaned-token Suspense bug is
independently closed**, decide:
- **C-extend:** move the 4 Pattern-A mutations + Pattern-B into the shared package, calling RPCs +
  Tekmetric PATCH from Node (zero hop, no drift — but a scope_hash golden-vector cross-runtime test +
  an L4 pgTAP test are **hard gates before wiring any mutation**), **or**
- **A-thin-fn:** a single thin keytag mutation edge fn (modeled on `tekmetric-list-wip-keytags`) that
  drops the registry but keeps one hop and keeps the Deno confirmation/Tekmetric logic single-sourced.

**Do not run Phase 4 concurrently with the B1 fix** — landing a transport change on top of an unfixed,
timing-sensitive confirmation bug is the worst-case interleave.

---

## 11. Risks + open questions for Chris

**Risks (read scope):**
1. **Build topology is the dominant cost, not the code.** No `workspaces`, no `transpilePackages`, no
   `outputFileTracingRoot` precedent in this repo. Phase 0 de-risks exactly this.
2. **Stale-copy divergence.** Phase 0 must delete the `_shared` originals and re-point the *edge*
   imports to the package (low-risk leaf read files — distinct from C's risky gateway-registry
   re-point).
3. **Service-role-on-Node leak.** A stray client import of `read-dal.ts` would ship the service-role
   key to the browser. Mitigated by `import "server-only"` + the review gate.
4. **Two-runtime test seam.** The 3 read test files stay Deno-run; the Node side gets a golden-snapshot
   parity test (not a full Vitest rewrite).

**Open questions:**
1. **Mutations — do you want the hop gone too?** If so, **C-extend** (zero hop, shared package) or
   **A-thin-fn** (one hop, no registry)? The reads fully address the B1 complaint; mutations are a
   separate value judgment. *My lean: A-thin-fn for mutations — keeps the confirmation/scope_hash logic
   single-sourced in Deno without cross-runtime hash-interop risk, and mutations aren't the latency
   complaint (assign/release skip revalidate and already feel instant).*
2. **`whoIsOnTag`** (3 serial Tekmetric GETs): keep on the gateway and off any render path? It's the
   same slow-Tekmetric-on-read shape that caused B1.
3. **Reads under service-role (matching today) vs a future RLS-enforced path?** The keytag tables are
   RLS-enabled-zero-policy, so service-role is the only working path today. *Recommended: keep it*,
   rather than authoring read policies as part of this change. (Note: the broader RLS-zero-policy +
   anon-grant gap is the separately-tracked DB-hardening item from the audit, items L3/M4.)
4. **Build topology choice:** true npm `workspaces` (restructure root `package.json`, also touches
   scheduler-app) vs the lighter `transpilePackages` + path alias (keeps apps standalone)?
   *Recommended: the lighter option for the read slice.*
5. **Ship Phase 0b (M1) first, ahead of everything?** Tiny, independent, stops today's mis-attribution.
   *Recommended: yes.*

---

## 12. Key file references

- **Read loaders to re-point:** `dashboard-cache.ts:28`, `load-board-state.ts:54-55`,
  `AuditHistoryTab.tsx:102`, `ManualReviewsTab.tsx`
- **Read tool source (→ package):** `keytag-dashboard-data.ts:288`, `keytag-dashboard-tool.ts`,
  `repair-orders.ts:127` (hoist target → `keytag-reads.ts`), `manual-review-list.ts:139`,
  `keytag-extras.ts:694`, the pure `tekmetric.ts` (`buildTekmetricRoUrl`)
- **Node infra to reuse:** `createSupabaseAdminClient()` `admin.ts:15`, `resolveAdminShopId()`
  `shop-id.ts:26`, `resolveServiceRoleKey()` `resolve-keys.ts`
- **Shared transport — do NOT edit:** `callOrchestratorRpc` `client.ts:147`
- **M1 sites (Phase 0b):** `keytag-extras.ts:373,527`, `manual-review-tools.ts` (~10 sites),
  `orchestrator-tools.ts` (forwarding)
- **L4 RPCs:** migration `20260511210000:92,149,205`
- **Gateway registry tax:** `mcp-tool-registry.ts:105` (66 `tool()` objects rebuilt per call)
- **Claude Desktop audience pin:** `oauth.ts:197`

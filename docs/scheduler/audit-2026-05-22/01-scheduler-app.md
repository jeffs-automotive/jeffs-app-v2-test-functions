---
agent: audit-scheduler-app
timestamp: 2026-05-22T03:00:00Z
scope: scheduler-app/src/
files_read: 47
---

# scheduler-app code audit

## Executive summary

The scheduler-app codebase is in solid shape. The thin-action/fat-DAL split is consistent across all 25 Server Actions; every action is wrapped with `Sentry.withServerActionInstrumentation` via the centralized `wrapAction` helper; every action validates with Zod and returns the `{ok, error?, data?, timestamp?}` envelope; every supabase call I read checks the `error` field; PII scrubbing is non-trivial and defensive (PII_KEY_BLOCKLIST + regex string scrub + fail-closed `beforeSend`); ephemeral-session design eliminates the cross-device state-leak surface; the `chat_id` is server-issued via HttpOnly cookie set in middleware and never read from URL/form fields. **Zero BLOCKER issues found.** The IMPORTANT items are all atomicity / race / idempotency surfaces that already have partial protection but could be tightened, and a handful of fail-soft branches that swallow errors more silently than the conventions allow. NICE-TO-HAVE items are mostly DRY / consistency.

## Findings

### BLOCKER

No BLOCKER issues found. The conventions in scope (shop_id sourcing, server-side validation, Sentry wrapping, no plaintext PII in logs, error-checked supabase calls, webhook idempotency / verification) all hold across the audited surface.

The `mark-abandoned` route deliberately accepts unauthenticated requests with `chat_id` from the URL — this is documented as intentional (`sendBeacon` cannot attach bearers during tear-down; the only abuse is for an attacker who already knows the chat_id to flip their own row to `timed_out`). The booking-landed snapshot check + status='active' filter make this safe in practice.

### IMPORTANT

| # | File:line | Issue | Recommended fix |
|---|---|---|---|
| 1 | `src/lib/scheduler/wizard/transition.ts:69-93` | `applyWizardTransition` is NOT atomic. Performs a sequential UPDATE → appendBubble(user) → appendBubble(assistant) → `revalidatePath`. If the row UPDATE succeeds but a bubble insert fails, the transcript drifts vs row state; the failure is captured to Sentry-warning but not retried. Pattern-compliance "atomicity at write boundaries" says multi-step writes should use a Postgres RPC. | Wrap row-update + bubble inserts in a single RPC (e.g. `rpc_apply_wizard_transition(chat_id, payload, user_text, assistant_text)`) so transcript + step advance are atomic. Current code accepts the drift explicitly; consider whether it's acceptable. |
| 2 | `src/lib/scheduler/hydrate-session.ts:194-225` | Stale-row reset performs 3-4 sequential UPDATE/DELETE writes (release `hold_token`, release `session_id` holds, wipe wizard columns, delete chat messages) with no transaction. A page-load that crashes mid-sequence leaves a partially-reset row visible to the next request. The `try/catch` at line 226 swallows ALL failures and continues. | Move the wipe-in-place sequence into a single Postgres RPC `rpc_hydrate_session_reset(chat_id)` that does the four writes in a transaction. Also: the catch-all log uses `level: "warning"` but a failure here means the customer sees a stale row — bump to `level: "error"` so it triggers an alert. |
| 3 | `src/lib/scheduler/wizard/actions/submit-summary.ts:285-313` | Hold-validity check is read-modify-write across two separate queries (read `appointment_holds` then call `confirmBooking` which reposts to Tekmetric). A racing `mark-abandoned` beacon between the hold read and the Tekmetric POST could release the hold while the POST is in flight. The Tekmetric side has no way to know the hold was released — booking lands, hold is gone. | Add a "claim" step that updates `appointment_holds SET released_at = NOW()` with `returning *` filter `released_at IS NULL` as a CAS lock BEFORE the Tekmetric POST. If 0 rows return, the hold was already released — bounce to `date_pick`. Alternative: server-side reject if the edge fn detects the hold is gone (would require an edge-fn change). |
| 4 | `src/lib/scheduler/wizard/llm/diagnose-concern.ts:157-160` | `apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN` — if BOTH env vars are missing, the Anthropic client is constructed with `apiKey: undefined` and every LLM call will fail at request time with an unhelpful error. There's no startup validation. | Add a one-time check (module-init or first-call) that throws if neither env var is set, with a clear "missing AI Gateway credentials" message. Match the pattern in `admin.ts` / `step2-direct-client.ts` that throws when service-role key is missing. |
| 5 | `src/lib/scheduler/wizard/transition.ts:43` | `WIZARD_REVALIDATE_PATHS = ["/", "/book", "/book-v2"]` revalidates THREE paths per wizard advance. Each `revalidatePath` invalidates the RSC payload for ALL users on that path on Vercel. In production with concurrent customers, every transition fans out cache invalidation across every customer's in-flight session, defeating the data-fetching cache. | Use `revalidatePath("/", "layout")` with a single layout-scoped key (the wizard is the layout itself), OR scope cache via `revalidateTag(`session-${chatId}`)` after instrumenting the supabase reads with `fetch.tags`. Current behavior may cause CPU spikes + Tekmetric request bursts under concurrent load. |
| 6 | `src/app/api/scheduler/mark-abandoned/route.ts:64-68` | The fall-through "no chatId → 204" branch returns success without ANY rate limiting. An attacker who learns the route can spray crafted POSTs with random UUIDs to probe which chatIds exist (each unknown UUID still does a supabase round-trip via `appointment_holds.eq("session_id", chatId)` even though the row update no-ops on `status != 'active'`). | Either reject malformed UUIDs early with `if (!UUID_V4_RE.test(chatId)) return 204` (same regex used in middleware), OR add a simple in-process rate limit on the route (Upstash already in stack for keytag). Currently the only cost is amplification, not data leak. |
| 7 | `src/lib/scheduler/wizard/actions/submit-customer-question.ts:80-82` | Inside an `if (finalQuestion)` branch the code does `const supabase = (await import("@/lib/supabase/admin")).createSupabaseAdminClient()` — a dynamic import for a module that's already statically imported elsewhere. The lazy import is unnecessary and the surrounding catch (`level: "warning"`) silently continues on failure. If the persist fails, the keyword scan still fires `submitEscalateV2` which fires the transcript dispatch — but the row never has the question text persisted, so the transcript email won't include what the customer said. | Hoist the import; check the persist error and bail to `submitEscalateV2` with a reason that signals "question text not persisted" so the service team knows to check the audit log. |
| 8 | `src/lib/scheduler/wizard/actions/submit-customer-notes.ts:80-82` | Same dynamic-import-of-already-statically-importable pattern as #7. Static import already exists in the file (line 53). The dynamic call would silently fail-open if the module had been reshaped. | Use the static `createSupabaseAdminClient` import. |
| 9 | `src/lib/scheduler/booking-direct-client.ts:282-345` | `call()` reads response body unconditionally with `res.text()` / `res.json()`. On a 500 with a giant Tekmetric error body (~MB), this consumes memory + bandwidth before failing. Same in `step2-direct-client.ts` and `otp-direct-client.ts`. | Apply `res.body.cancel()` or limit text length to e.g. 10KB. Not exploitable today (controlled edge fn responses) but defensive against future failure modes. |
| 10 | `src/lib/scheduler/wizard/actions/submit-summary.ts:411-419` | `confirmResult.verification.ok === false` path captures a Sentry message and PROCEEDS to mark the appointment confirmed — including writing `appointment_id` to the row. If the verification mismatch is real (Tekmetric stored DIFFERENT data than what we sent), the customer sees a confirmation card for an appointment that has the wrong service description / wrong time. | At minimum, the Sentry level here should be `error` not `warning`, and the staff-notification should flag this with a special prefix so the service team checks Tekmetric. Better: surface a "we've booked you but please call us to confirm details" bubble to the customer. |
| 11 | `src/lib/scheduler/wizard/llm/diagnose-concern.ts:864` | `// @ts-expect-error - gateway extensions not in Anthropic SDK types` for `providerOptions` — fine, but the broader concern is that the `output_format` + `betas: [STRUCTURED_OUTPUTS_BETA]` path has no fallback for when Anthropic deprecates the beta. The 2-retry loop won't help if the entire endpoint shape changes. | Add a feature flag check or a try/catch around the structured-output path that falls back to text + manual JSON parse on a specific error shape (e.g. 400 with "unsupported beta"). Not urgent until Anthropic announces a deprecation. |
| 12 | `src/lib/scheduler/wizard/actions/submit-phone-name.ts:117-132` | The pre-write of `entered_first_name` / `entered_last_name` / `phone_e164` happens BEFORE the step2-direct call. If step2-direct returns a "show_escalation_card" directive, the row carries the customer's typed name + phone forever (until next stale-wipe). For escalations triggered by a multi-name-match (security gate), the customer's typed name is persistent on a row whose status is `escalated` — fine for transcript audit but worth confirming this is the desired audit shape. | No code change. Worth documenting in chat-design.md that pre-write is intentional and survives escalation for audit. |
| 13 | `src/lib/scheduler/wizard/llm/parse-customer-note.ts:163-184` | `generateObject` from `ai` SDK with `recordInputs: false, recordOutputs: false` for telemetry — correct PII stance — but the catch (line 185-196) only captures `surface: "parse_customer_note_llm"` + `attempt`. The `raw_length` is included but not the chat_id (`wrapAction` adds chat_id via tag at the outer scope, so it's there transitively). Verify in Sentry that the chat_id tag actually propagates from the wrapAction to inner captureException calls — the wrapper comment claims it does, but if the call site is inside an inner async function the tag may not be inherited if Sentry's async context isn't tracked. | Verify in Sentry production data that `chat_id` tag appears on `parse_customer_note_llm` events. If not, add `tags: { chat_id: chatId }` to the inner capture. (The `wrapAction.ts` line 64 sets it at the outer scope; depending on Sentry's hub propagation this MAY or may not reach inner captureException calls — relies on Sentry async-local-storage.) |
| 14 | `src/lib/scheduler/wizard/actions/submit-summary.ts:228-243` | Idempotency pre-flight check: `if (typeof r.appointment_id === "number" && r.appointment_id > 0)` re-emits the confirmed bubble. But the bubble's `formatFriendlyTime(startsAtIso, ...)` is called with EMPTY string `""` (line 241), which falls into the `if (!iso) return "your appointment date"` branch. The user sees "You're booked for your appointment date" on a retry — confusing UX. | Persist `start_time` on the row after the original confirm so the idempotency retry can format the actual time. The row already has `appointment_date` + `appointment_time` columns; use those to reconstruct via `shopLocalToIsoString`. |
| 15 | `src/lib/scheduler/wizard/actions/submit-multi-account-choice.ts:80-94` | The 'select' path writes `customer_id: selected_customer_id` based on the value the client sent. The client picked from `pending_candidates` which was server-written by step2-direct, so this is bounded — but there's no validation that `selected_customer_id` is actually IN the row's `pending_candidates` array. A crafted request could write any customer_id to the row. | Read `pending_candidates` from the row before the write; reject if `selected_customer_id` doesn't appear in the array. (Downstream `customer_info_edit` would still need an OTP-verified phone to PATCH Tekmetric, but the row-level customer_id assignment is the trust anchor for everything that follows.) |
| 16 | `src/lib/scheduler/wizard/actions/submit-vehicle-pick.ts:71-129` | The vehicle pick writes `vehicle_id: vehicleIdNum` without validating that the vehicleIdNum actually belongs to the row's customer_id. The DAL fetches the customer's vehicle list via `fetchVehiclesForCustomer` (line 96-115) but only USES the result to build the display label — there's no check that the picked id appears in the result. | Add a validation: `if (!result.vehicles?.some(v => v.id === vehicleIdNum)) return { ok: false, error: "vehicle_id_not_owned_by_customer" }`. Currently a crafted request could write any vehicle id to the row. The Tekmetric appointment POST later passes this id directly, so a foreign vehicle id would land in the appointment. |
| 17 | `src/lib/scheduler/wizard/actions/submit-testing-service-approval.ts:78-88` | Invalid-key validation produces a Sentry message but the response shape is `{ ok: false, error: "invalid_service_keys" }` — no detail about WHICH keys were invalid. The client only sees a generic error. | Surface invalidApproved/invalidDeclined in the response error message (these are derived from the customer's own pick set so no PII concern). Helps debug user-reported issues. |
| 18 | `src/lib/scheduler/wizard/llm/diagnose-concern.ts:894-908` | The 2-attempt retry loop captures BOTH attempts to Sentry as `warning`. Under load this doubles Sentry event volume + obscures the meaningful "we exhausted retries" signal. | Capture attempt 1 as a breadcrumb only; capture as a real warning ONLY on attempt 2 failure (when the call ultimately returns `null`). |
| 19 | `src/lib/scheduler/wizard/actions/submit-clarification-answer.ts:316-325` | Inside the queue-drain branch, the catch logs `ensure_concern_summaries_failed` via `console.warn(JSON.stringify(...))` and Sentry. But the wizard advance has already happened (line 287 `transitionResult`). The summary is now permanently missing for downstream `build-service-summary.ts` which falls back to raw `explanation_text` (line 140). This is documented as fail-soft, but: a missing summary means the Tekmetric appointment description carries verbatim customer typo'd prose, not the cleaned-up advisor-friendly summary. | Consider a deferred-retry path (e.g. enqueue a row in `transcript_emails` style queue) so a transient LLM failure gets a second chance before the transcript email fires. |
| 20 | `src/lib/scheduler/wizard/actions/run-diagnostics.ts:223-228` | `loadRoutineChipConcernCategories` captures `Sentry.captureMessage` on `routine_services` lookup failure and returns an empty Map. Downstream `buildChipHint` then returns null for every chip, which the LLM accepts but degrades classification quality. The customer doesn't know the routing is degraded. | Bump to `level: "error"` since this directly affects diagnostic accuracy; consider failing the action so the customer sees an escalation rather than a degraded diagnostic. |

### NICE-TO-HAVE

| # | File:line | Issue | Recommended fix |
|---|---|---|---|
| 1 | All 25 `actions/*.ts` files | `const SHOP_ID = 7476` is duplicated across 11 files (see grep at line 1109-1149 of get-current-card.ts and counterparts). Single source of truth would prevent drift when Phase 2 multi-tenant lands. | Extract to `src/lib/scheduler/shop.ts` and import. Even better: introduce `getCurrentShopId(chatId)` reading from the row's `shop_id` column (the row already carries it via `ensureSessionExists`) so the constant disappears entirely. |
| 2 | `src/lib/scheduler/wizard/instrument-action.ts:64` | The chat_id tag-setting uses 4 lines of structural type guards. | Extract to a `extractChatId(args)` helper to clean up the wrapper body and make the check unit-testable. |
| 3 | `src/lib/scheduler/wizard/actions/*.ts` (most) | The pattern `try { ... } catch (e) { Sentry.captureException(...); await logError({...}); return { ok: false, error: msg } }` is duplicated 15+ times with the SAME shape. | Build a `withErrorBoundary(surface, fn)` helper that does the catch + Sentry + logError + return-shape uniformly. Reduces the chance one action misses a piece (already happened — see submit-clarification-answer R4-IMPORTANT-D-4 comment at line 155-157). |
| 4 | `src/lib/scheduler/wizard/llm/parse-customer-note.ts:200-202` | `// Belt-and-suspenders: hard-trim to TARGET_MAX_CHARS` — comment is fine but the Zod max(150) on the schema (line 67) means the LLM was already constrained. The post-trim is dead code in the success path. | Drop the post-trim; rely on Zod max. If a future change removes the Zod cap this would be a latent bug, so leaving it is defensible. |
| 5 | `src/lib/scheduler/hydrate-session.ts:64-111` | `RESET_COLUMNS` is duplicated almost verbatim with `submit-start-over.ts:96-141`. Two definitions of the same reset shape — one will drift. | Extract to `src/lib/scheduler/wizard/reset-columns.ts` and import in both. |
| 6 | `src/lib/scheduler/wizard/actions/run-diagnostics.ts:381` | `loadDiagnosticCatalog(supabase)` is called fresh per `runDiagnostics` invocation. The catalog is ~50 subcategories + ~350 questions — small but the routine-services-cache pattern (5min TTL) would apply. | Consider caching `loadDiagnosticCatalog` with a 5-min TTL similar to `routine-services-cache.ts`. (Tradeoff: edits to concern_subcategories take up to 5 min to visible in production — same tradeoff routine_services already accepts.) |
| 7 | `src/lib/scheduler/wizard/availability.ts:53-72` | Date math mixes UTC and local: `today.setUTCHours(0,0,0,0)` then `ymd(d) = d.toISOString().slice(0,10)` is UTC midnight, but the shop is America/New_York. Late-night-UTC requests on the day boundary may compute the wrong "today" for capacity math. | Use `shopLocalToday()` from `shop-tz.ts` (already exists) to anchor the window. The same-day filter at line 250-256 already uses it — the window-start does not. |
| 8 | `src/lib/scheduler/wizard/actions/submit-customer-info-edit.ts:227-233` | `shallowEqJson` via `JSON.stringify` is order-sensitive. The comment notes "both sides are built in the same insertion order" but that's a fragile assumption. | Use a key-sorted normalizer or deep-equal helper. The downside: if the customer's array order changes (e.g., primary phone moves), the diff fires a no-op Tekmetric PATCH. Minor perf hit, no correctness risk. |
| 9 | `app/api/scheduler/mark-abandoned/route.ts:98-109, 181-199` | Two fire-and-forget audit-log inserts use `void supabase.from(...).insert(...)` with `.then(({error}) => ...)`. Standard supabase-js pattern but `void` + un-awaited inserts can be lost if the function returns before the insert resolves on Vercel. | Either `await` the inserts (slight latency cost, ~20-50ms) or queue via `waitUntil(...)` from `next/server` so Vercel's runtime keeps the process alive for the insert. |
| 10 | `src/lib/scheduler/wizard/staff-notification.ts:159-160` | `recipients = toEnv.split(",")` allows multiple recipients. No validation that each split string is a valid email. A malformed env var (e.g. extra colon) silently sends to a bad address. | Validate each recipient via a simple regex or drop unparseable entries with a Sentry warning. |
| 11 | `src/lib/scheduler/wizard/actions/run-diagnostics.ts:386-444` | The per-concern parallel LLM call uses `Promise.all` — if ANY concern's `diagnoseConcern` throws (which it shouldn't given its internal fail-safes, but if it did), the entire diagnostic pass fails. | Use `Promise.allSettled` and treat individual concern failures as fail-safe nulls. Defensive — current code is correct given `diagnoseConcern` guarantees a `failSafe()` return on all error paths. |
| 12 | All `actions/*.ts` files | Many actions read the full `customer_chat_sessions` row via `select("*")` (e.g. `submit-summary.ts:215`, `staff-notification.ts:79`, `get-current-card.ts:65`). Each `select("*")` increases payload + response time + potential PII surface in Sentry breadcrumbs if any future change captures the response. | Narrow each select to the columns the function actually uses. The row has 50+ columns now. |
| 13 | `src/lib/scheduler/wizard/actions/submit-summary.ts:316-319` | `Promise.all([buildAppointmentTitleV2(...), buildServiceSummary(...)])` — both helpers internally call `createSupabaseAdminClient()` + `select("*")` against the same row. Two full-row reads of identical data. | Either read the row ONCE in `submit-summary.ts` and pass it to both helpers, or have the helpers accept a pre-fetched row. Saves one round-trip per booking. |
| 14 | `src/components/scheduler/wizard/IdleTimer.tsx:79-83` | `useRef<() => void>(() => {})` initializer captures an empty fn that's overwritten in effect. Acceptable but the initial render's `handleExtend` could fire (it can't — `showWarning` starts false — but it's load-bearing across renders that the effect runs first). | Initialize with `useRef<(() => void) | null>(null)` and guard in `handleExtend`. Defensive against future refactors. |
| 15 | `src/lib/scheduler/wizard/actions/submit-customer-question.ts:74` | Keyword scan AFTER the Zod nullable check but BEFORE the trim. `finalQuestion` is already trimmed and length-checked — but the scan uses `finalQuestion` which is non-null. The escalation logic only fires when `finalQuestion` is non-null (correct). However the scan returns no signal when text contains a keyword but is shorter than the visible Zod min — defensive, not a bug. | No change. Worth noting that Zod `.nullable()` without `.min()` accepts empty string from the client; `finalQuestion` derivation handles it. |
| 16 | `src/lib/supabase/admin.ts:28-31` | Module-level `cachedClient` is fine but means tests that change env vars between cases need to call `__resetAdminClientForTests()`. The helper exists but the convention isn't enforced. | Add a comment in `vitest.config.ts` or a `beforeEach` global. |
| 17 | `src/lib/scheduler/wizard/transition.ts:43-46` | The revalidate-three-paths design is documented as a hedge for "second tab opened against / or /book." Concurrency consequence #5 above. | If revalidation cost matters, a `revalidateTag("session-${chatId}")` design with tag-instrumented `fetch` would scope revalidation to the customer's own session. |

## Patterns observed (positive)

- **Universal Sentry wrapping**: every Server Action that's exported is wrapped by `wrapAction(name, impl)` so the `Sentry.withServerActionInstrumentation` + auto-tagging of `wizard_action` + `chat_id` is centralized. New actions can't accidentally ship without instrumentation. Pattern: `instrument-action.ts:35-70`.
- **Zod everywhere**: every action's first line is `const parsed = schema.safeParse(args)` with a discriminated-union for multi-mode actions (notes, multi-account-choice, partial-verification-choice). Server Actions are NEVER trusted to receive validated input.
- **shop_id is server-resolved**: `SHOP_ID = 7476` constant is duplicated across files (nice-to-have #1) but it's never read from URL / form / client. The only data sourced from the client is the chatId (and even that is validated against the HttpOnly cookie issued by middleware).
- **PII scrubbing is non-trivial**: `sentry.server.config.ts:81-218` has BOTH a key-blocklist (39 keys covering names/emails/phones/addresses + `tekmetric_error_text`) AND regex passes on every string leaf (email-like, +1NNN…NNNN with last-4 preserved, OTP codes near "code"/"otp" keys). Fail-closed: if scrubbing throws, the event is dropped. Replay integration uses `maskAllText: true, maskAllInputs: true` so customer keystrokes are masked in session replay.
- **Ephemeral session design**: 5-min idle → wipe-in-place via `hydrate-session.ts:hydrateSession`. The `RESET_COLUMNS` shape mirrors `submit-start-over.ts`. Terminal-state rule (`status === 'ended' || 'escalated'`) preserves completion screens for browser refreshes.
- **Idempotency pre-flights** on every Tekmetric-write action: `submit-new-customer-info.ts:108-117`, `submit-summary.ts:222-243`, `submit-new-vehicle.ts:98-105`. Prevents double-POST to Tekmetric on retries / double-taps.
- **Race protection** for rapid-click: `submit-date.ts:78-81` and `submit-waiter-time.ts:64-67` read `current_step` and no-op if a prior click already advanced the wizard.
- **Hold release on Back navigation** (`submit-back.ts:95-118`): backing out of `summary` / `date_pick` / `waiter_time_pick` releases the appointment_holds row so the customer can't simultaneously hold two slots.
- **Post-confirm-race protection** in `mark-abandoned`: snapshots `appointment_id` / `appointment_confirmed_at` and SKIPS the abandon path if the booking already landed (route.ts:85-111). Audit logs the skip via `session_abandon_skipped_post_confirm`.
- **IdleTimer is solid** (per the 2026-05-21 audit prompt): `WindowEventMap` listener set includes pointer/mouse/keyboard/scroll/touch/focus + visibilitychange + click + mousemove (the recent additions); listeners are attached at the capture phase with `passive: true` to survive stopPropagation; `pagehide` + `beforeunload` fire the abandon beacon; the `abandonedRef` prevents double-fire; cleanup correctly removes listeners with the `capture: true` flag matching the registration.
- **Two-layer error boundaries**: `app/error.tsx` (root segment) AND `app/global-error.tsx` (root layout crashes) both call `Sentry.captureException` in `useEffect` and render `error.digest` (never `error.message`) to the customer. `app/book-v2/error.tsx` is a per-route boundary tagged with `surface: "book-v2"`. `instrumentation.ts:36` exports `onRequestError = Sentry.captureRequestError` so Server Component + middleware errors surface.
- **`webhook_events`-style idempotency** at the edge fn boundary (referenced but not in scope of this audit) is paired with on-demand transcript dispatch + 5-min cron backstop — both layers documented in `fire-transcript-dispatch.ts` + `staff-notification.ts`.
- **fire-and-forget + circuit-breaker semantics**: staff-notification email is `void notifyStaffOfNewAppointment(...).catch(...)` so the customer's confirmation never blocks on Resend. Failures are Sentry-warned with appointment_id context.
- **Cookie hygiene** in `middleware.ts:54-62`: HttpOnly + SameSite=lax + Secure-in-prod + 30-day MaxAge. UUID v4 regex validates the cookie before passing through.
- **Catch blocks are intentional + documented**: every `catch {}` I found is either (a) a beacon-failure / inner-handler-failure that's documented as best-effort with a Sentry surface, OR (b) shape coercion that's defensive against future JSON drift. NONE swallow errors silently. The `empty catch swallowing errors` BLOCKER criterion does not fire.
- **No raw PII in logs**: every captureException / captureMessage I read either omits sensitive fields, redacts to last-4, or passes through the `beforeSend` scrubber. The closest miss is `tekmetric_error_text` echoes in `extra:` — already in the PII_KEY_BLOCKLIST so it's wiped before send.

## Files reviewed

Server Actions (25 total — read in full or near-full):
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-greeting.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-phone-name.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-otp.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/resend-otp.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-multi-account-choice.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-no-match-choice.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-partial-verification-choice.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-new-customer-info.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-customer-info-edit.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-vehicle-pick.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-new-vehicle.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-service-and-concern-picker.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-explanation.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/run-diagnostics.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-clarification-answer.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-testing-service-approval.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-second-routine-pass.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-appointment-type.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-date.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-waiter-time.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-summary.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-customer-notes.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-customer-question.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-escalate.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/dismiss-escalation.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-start-over.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-back.ts`
- `scheduler-app/src/lib/scheduler/wizard/actions/fire-transcript-dispatch.ts`

DAL / supabase / wrappers:
- `scheduler-app/src/lib/scheduler/wizard/instrument-action.ts`
- `scheduler-app/src/lib/scheduler/wizard/transition.ts`
- `scheduler-app/src/lib/scheduler/wizard/transition-types.ts` (imported types only)
- `scheduler-app/src/lib/scheduler/wizard/append-bubble.ts`
- `scheduler-app/src/lib/scheduler/wizard/log-error.ts`
- `scheduler-app/src/lib/scheduler/wizard/get-current-card.ts`
- `scheduler-app/src/lib/scheduler/hydrate-session.ts`
- `scheduler-app/src/lib/scheduler/chat-store.ts`
- `scheduler-app/src/lib/scheduler/wizard/build-summary-data.ts`
- `scheduler-app/src/lib/scheduler/wizard/build-service-summary.ts`
- `scheduler-app/src/lib/scheduler/wizard/availability.ts`
- `scheduler-app/src/lib/scheduler/wizard/ensure-concern-summaries.ts`
- `scheduler-app/src/lib/scheduler/wizard/route-after-diagnostics.ts`
- `scheduler-app/src/lib/scheduler/wizard/shop-tz.ts`
- `scheduler-app/src/lib/scheduler/wizard/staff-notification.ts`
- `scheduler-app/src/lib/scheduler/escalation-keywords.ts`
- `scheduler-app/src/lib/scheduler/session-state.ts`
- `scheduler-app/src/lib/scheduler/routine-services-cache.ts`
- `scheduler-app/src/lib/scheduler/step2-direct-client.ts`
- `scheduler-app/src/lib/scheduler/otp-direct-client.ts`
- `scheduler-app/src/lib/scheduler/booking-direct-client.ts`
- `scheduler-app/src/lib/supabase/admin.ts`
- `scheduler-app/src/lib/supabase/server.ts`
- `scheduler-app/src/lib/supabase/resolve-keys.ts`

LLM call paths:
- `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts`
- `scheduler-app/src/lib/scheduler/wizard/llm/summarize-concern.ts`
- `scheduler-app/src/lib/scheduler/wizard/llm/parse-customer-note.ts`
- `scheduler-app/src/lib/scheduler/wizard/llm/load-diagnostic-catalog.ts`
- `scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts` (partial)

Routes / pages / boundaries:
- `scheduler-app/app/api/scheduler/mark-abandoned/route.ts`
- `scheduler-app/app/error.tsx`
- `scheduler-app/app/global-error.tsx`
- `scheduler-app/app/book-v2/error.tsx`
- `scheduler-app/app/page.tsx`
- `scheduler-app/app/book/page.tsx`
- `scheduler-app/instrumentation.ts`
- `scheduler-app/instrumentation-client.ts`
- `scheduler-app/sentry.server.config.ts`
- `scheduler-app/sentry.edge.config.ts`
- `scheduler-app/middleware.ts`
- `scheduler-app/next.config.ts`

Client components (selected):
- `scheduler-app/src/components/scheduler/wizard/IdleTimer.tsx`
- `scheduler-app/src/components/scheduler/wizard/BookPageShell.tsx`
- `scheduler-app/src/components/scheduler/wizard/WizardSurface.tsx`
- `scheduler-app/src/components/scheduler/wizard/WizardCrossCutting.tsx`
- `scheduler-app/src/components/scheduler/wizard/WizardBackBar.tsx`
- `scheduler-app/src/components/scheduler/wizard/OfflineBanner.tsx`
- `scheduler-app/src/components/scheduler/heritage/PhoneNameCard.tsx`
- `scheduler-app/src/components/scheduler/heritage/CustomerNotesCard.tsx`
- `scheduler-app/src/components/scheduler/OtpInput.tsx`
- `scheduler-app/src/components/scheduler/VehiclePicker.tsx`

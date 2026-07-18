# Code-review findings — fix plans (2026-07-18)

Four `important` findings from the `/code-review` gate on the
`appointment-sms-transactional-optout` change (gate PASSED, 0 blockers). All
four are in code I authored (in prior sessions). Researched + planned here.
Priority order: **#1 → #4 → #2 → #3**.

---

## #1 — Non-atomic STOP writes (telnyx-webhook) · HIGH

**Where:** `supabase/functions/telnyx-webhook/consumers.ts` — STOP branch
(marketing revoke ~L128 + appointment opt-out inserts ~L146).
**Rule:** `non-atomic-multi-write` / cross-module-anchors §A — "multi-step
writes that must be consistent use a Postgres RPC transaction, NOT sequential
JS writes."

**Real risk.** STOP now performs two independent mutations: revoke marketing
consent (`sms_consents`) + insert appointment opt-out(s) (`sms_appointment_opt_outs`).
If the revoke succeeds but an opt-out insert fails (DB error mid-sequence),
STOP is **partially applied** — marketing stops but appointment reminders keep
sending. That's a compliance gap on the legally load-bearing STOP path.
Bounded today by: each write logs on failure, STOP is idempotent (re-STOP
re-applies), and the send path fail-closes on opt-out-lookup error. But the
window exists.

**Fix.** New migration: `process_sms_stop(p_phone text) returns jsonb`
(SECURITY DEFINER, `set search_path = public`, `grant execute … to service_role`)
that, in one transaction:
1. `update sms_consents set revoked_at=now(), revoke_source='sms_stop' where phone_e164=p_phone and revoked_at is null` (capture row_count),
2. `insert into sms_appointment_opt_outs (shop_id, phone_e164, source) select distinct m.shop_id, p_phone, 'sms_stop' from sms_messages m where m.phone_e164=p_phone and m.direction='outbound' on conflict (shop_id, phone_e164) where restored_at is null do nothing`,
3. return `{ revoked_count, opt_out_shop_count }`.

Swap the two JS write-blocks in the STOP branch for one
`sb.rpc("process_sms_stop", { p_phone: phone })`. Keep the inbound-ledger
`sms_messages` insert separate (it's independent). Update `consumers.test.ts`
(STOP asserts one `process_sms_stop` rpc call, not the raw table writes).

**Scope:** 1 migration + `consumers.ts` + `consumers.test.ts`. Deploy:
`supabase db push` + `supabase functions deploy telnyx-webhook`.
**Coupling:** part of the appointment-SMS feature (STOP is this change's path) —
fold in **before** that feature deploys.

---

## #4 — Undefended JSONB entry parse (get-current-card) · MEDIUM

**Where:** `scheduler-app/src/lib/scheduler/wizard/get-current-card.ts:484-500`
(`recommended_testing_services` → `testing_service_approval` payload).
**Rule:** `jsonb-defensive-parse` — validate each entry is a non-null object
before dereferencing.

**Real risk.** `Array.isArray(raw)` passes for `[null]`; the `.map((entry) =>
{ typeof entry.service_key … })` then dereferences `entry.service_key` on
`null` → `TypeError` → the Server Component render throws → `error.tsx`
("Something went sideways"). `recommended_testing_services` is written by
`run-diagnostics` (LLM-derived), so a shape-drifted `[null]`/`[123]` entry is
plausible.

**Fix.** Add a per-entry guard before the map:
```ts
const services = Array.isArray(raw)
  ? (raw as unknown[])
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((entry) => ({ /* unchanged */ }))
      .filter((s) => s.service_key.length > 0 && s.display_name.length > 0)
  : [];
```
Audit the other `recommended_testing_services` / JSONB-array reads in
get-current-card for the same pattern (concern_clarify_candidates,
clarification_questions, etc.) while here.

**Scope:** `get-current-card.ts` + a unit test (`[null]`/malformed → empty
services, no throw). Deploy: scheduler-app (Vercel).

---

## #2 — Terminal `logError` can throw out of a Server Action · MEDIUM

**Where:** every `submit-*` action's terminal `catch { await logError(…);
return {ok:false} }` (flagged at `submit-phone-name.ts`). Root cause is shared:
`log-error.ts:63` calls `createSupabaseAdminClient()` **outside** its try/catch,
and that client **throws** on missing env (`admin.ts:36`). `wrapAction`
(`instrument-action.ts`) does not add an error-result catch, so a throw here
escapes as a raw Server Action rejection instead of the `{ok:false}` envelope.

**Real risk.** LOW in steady state (prod env vars are present). But if the
service-role env is ever unresolved on an instance, EVERY action's error path
becomes a hard rejection (generic Next error / wizard "try again") instead of a
graceful, logged `{ok:false}`. It's a best-effort logger that can take down the
error path it's meant to record.

**Fix (one place, fixes all ~25 callers).** Harden `logError` to never throw:
wrap the whole body — including `createSupabaseAdminClient()` — so any failure
falls through to the existing `console.warn(JSON.stringify({…}))` fallback and
returns void. (Optionally also give `wrapAction` a defensive outer catch that
returns a typed `{ok:false}` envelope, but hardening `logError` is the minimal,
targeted fix.)

**Scope:** `log-error.ts` + a unit test (admin-client throw → logError resolves,
does not throw). Deploy: scheduler-app (Vercel).

---

## #3 — Quiet-hours uses the Vercel clock, not the canonical shop clock · LOW

**Where:** `supabase/functions/scheduler-comms/core.ts:653`
(`isWithinQuietHoursSendWindow(nowUtcMs)` → derives shop-local hour from
`Date.now()` passed by the cron sweep).
**Rule:** `shop-clock-single-snapshot` — time-of-day gating should read the
canonical Postgres shop clock (`scheduler_shop_now()`), not the process clock.

**Real risk.** LOW. Vercel clocks are NTP-synced; the TCPA quiet-hours window
(08:00–20:59 shop-local) is a conservative courtesy gate. Worst case a reminder
sends a minute inside quiet hours (e.g., 21:00) on clock skew. But the invariant
exists precisely to keep time-of-day decisions on one authoritative clock.

**Fix.** In the sweep, read the canonical clock once:
`const { data } = await sb.rpc("scheduler_shop_now")` → use `data.hour`
(shop-local, from Postgres) for the quiet-hours gate. On RPC error, fall back to
the current `nowUtcMs`-derived hour + a logged warning (don't hard-fail a
courtesy gate). The appointment window-bound math (`nowUtcMs + fromMin…`) stays
UTC — it's duration math against `appointments` TIMESTAMPTZ, skew-immune, not a
time-of-day decision. `scheduler_shop_now()` is `service_role`-granted and
returns `{ date, hour, minute, iso_local }`.

**Scope:** `core.ts` (thread the shop hour into `sweepReminders`/
`isWithinQuietHoursSendWindow`) + `core.test.ts`. Deploy:
`supabase functions deploy scheduler-comms`.

---

## Recommended sequencing

- **#1** — fold into the appointment-SMS feature (`feat/appointment-sms-optout`)
  before it deploys; it's that change's compliance path.
- **#4, #2, #3** — a separate small "code-review-hardening" feature (all three are
  low-blast-radius, well-scoped). Ship together after #1.

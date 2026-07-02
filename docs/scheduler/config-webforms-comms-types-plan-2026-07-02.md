# Schedulerconfig webforms + per-type customer comms + dynamic appointment types — plan (2026-07-02)

> Produced from a 5-agent research workflow (4 parallel deep-maps + adversarial completeness critic;
> every load-bearing claim verified against source with file:line). **Status: decisions CLOSED
> (§7, Chris 2026-07-02); Gemini + GPT cross-verify run 2026-07-02 — adopted amendments in §9
> (raw findings: `.claude/work/ai-review-2026-07-02T02-51-50Z.md`). Awaiting Chris's implementation
> go-ahead.**
>
> **Supersedes:** `docs/admin-dashboard/schedulerconfig-plan.md`'s orchestrator-mediated model ("the
> page never goes around the orchestrator-mcp tool surface" is now the OPPOSITE of the requirement);
> REVAMP-PLAN-2026-06-24 §2a's "admin transport migration off orchestrator-mcp is optional/deferred"
> (now mandatory, this scope); and REVAMP §4e's claim that "yellow is the keytag color convention"
> (WRONG — verified: `appointments-sync/index.ts:140` maps `#FCB70D` yellow = **loaner appointment
> color**; keytag red/yellow physical tags are unrelated).

---

## 0. The three sub-features

| # | Ask | One-line verdict from research |
|---|---|---|
| A | Remove the orchestrator from `/schedulerconfig`; all settings become webforms (no MD uploads) | A rewrite of the shipped module: all 22 Server Actions + 11 components currently proxy EVERY read+write through orchestrator-mcp; admin-app has **zero** direct-Supabase write precedent today — the direct-write DAL is net-new |
| B | Dynamic appointment types (create in app → auto-appears in config), mapped to a color | Well-seamed: the type→Tekmetric channel IS the `color` field, already plumbed end-to-end; the read side already understands a 6-color vocabulary (red=waiter, navy=dropoff, **yellow=loaner**, orange=tow-in, blue=needs-ride, green=needs-by); only the write path is stuck at red/navy behind a hardcoded 2-value enum |
| C | Customizable customer SMS + email (confirmation + reminders) per appointment type; OTP excluded | Greenfield: no template system exists; only `telnyx_webhook_events` of the planned comms schema is built; templates = REVAMP Phases 1–3 work, not additive to it |

**Dependency order: B (type table) → A (webforms, including the type editor) → C (templates FK the type table and need Phase-2 transports + consent).** Details in §8.

---

## 1. Verified ground truth (what the plan builds on)

**Schedulerconfig today** (agent 1): 10 tabs in `admin-app/app/schedulerconfig/page.tsx`; every mutation flows Server Action → `callSchedulerTool` → orchestrator-mcp JSON-RPC (SERVICE_ROLE bearer + `X-Actor-Email`) → edge tool → either TS-side upsert (5 "V2" surfaces — non-cooperative with the advisory surface lock, ADR-024/SEC-17 gap) or Postgres `apply_*_upload` RPC (5 legacy surfaces — cooperative). Pattern S confirm_token is a byte-parity sha256 formula computed identically in TS + plpgsql (`canonical-state.ts:101-139`). Only **7 outer-callable RPC entry points** exist for service_role (5 `apply_*_upload` + `revert_md_upload_attempt` + `list_scheduler_admin_audit_log_filtered`); the internal helpers have no service_role grant (ADR-005). ADR-016: the DB does NOT stop a service_role caller passing a foreign shop_id — the caller is the trust boundary; the webform actions must own shop-scoping (they already derive actor from `requireAdmin()`).

**Appointment types today** (agent 2): `"waiter" | "dropoff"` hardcoded in ~15 TS sites + Zod enum + **3 DB CHECK constraints** (`appointment_holds`, `appointments`, `customer_chat_sessions`). Tekmetric: `color` is **empirically verified writable** (18 live probes 2026-05-16; permitted list red/pink/yellow/orange/light green/green/blue/navy/lavender/purple; only red/navy/orange actually probed); `appointmentOption` is **silently ignored** (always STAY — why the codebase uses color as the type channel); `rideOption` documented writable but **never probed**. The `appointments` shadow already has `color`, `ride_option`, `appointment_option` columns (no CHECK). Two hardcoded color→type classifiers exist on the read side (`appointments-sync/index.ts:125-169`, `scheduler-slots.ts:221-244`) that must become table-driven. `waiter`/`dropoff` are behaviorally load-bearing (same-day filtering, 8/9 AM slots, wait-eligibility).

**Comms today** (agent 3): OTP body fully hardcoded (`buildOtpMessageText`, `scheduler-otp.ts:112-117`) — stays that way. The Telnyx client is complete but not yet extracted to `_shared/`. Of the planned comms schema only `telnyx_webhook_events` exists (built 2026-07-01); `sms_messages`, `sms_consents`, reminder ledger, `appointments` contact columns are all net-new. **React Email is NOT installed** (REVAMP §4c is aspirational) — all current email is hand-built HTML; `resend-client.ts` accepts `html` only (needs a `text` field). Confirmation send seam = the post-`confirmBooking` block in `submit-summary.ts` (where `notifyStaffOfNewAppointment` already fires); reminder seam = the future sweeper cron. Consent capture remains the P0 send gate (nothing exists; `PhoneNameCard` footnote is not opt-in).

**qteklink mapping fit** (agent 4): **Design B wins — first-class tables, not the qteklink mapping shape.** The qteklink pattern binds externally-discovered sources to validated targets with a compatibility matrix; appointment types are shop-CREATED, colors are plain strings, templates are child rows — the mapping ceremony (source_id/source_key duality, role↔type trigger) validates nothing here. What DOES transfer: one-active partial unique (`WHERE active`), history via deactivate-then-insert RPCs, server-side derivation, deny-all RLS + service_role + SECURITY DEFINER `search_path=''`, and the lock-step CHECK-widening discipline (store-credit 20260623220000 cautionary tale).

---

## 2. Sub-feature B — `scheduler_appointment_types` (build FIRST)

### Schema (new migration)

```sql
CREATE TABLE public.scheduler_appointment_types (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       integer NOT NULL CHECK (shop_id > 0),
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9_]{2,40}$'),  -- IMMUTABLE after create (RPC-enforced)
  label         text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  description   text CHECK (description IS NULL OR length(description) <= 300),  -- card copy
  emoji         text CHECK (emoji IS NULL OR length(emoji) <= 16),               -- card icon
  tekmetric_color text NOT NULL
    CHECK (tekmetric_color IN ('red','navy','orange')),  -- probe-verified only; widened by migration as probes clear (yellow first)
  requires_time_slot boolean NOT NULL DEFAULT false,  -- v1: TRUE only on the system waiter row (§ capacity)
  is_system     boolean NOT NULL DEFAULT false,       -- waiter/dropoff: undeletable + color/slug frozen (trigger)
  active        boolean NOT NULL DEFAULT true,
  sort          integer NOT NULL DEFAULT 0,
  updated_by_email text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, id)                                 -- composite-FK target for child tables (cross-shop guard)
);
-- One row per slug, ever (types are edited IN PLACE — see RPCs below): full unique, not partial.
CREATE UNIQUE INDEX scheduler_appt_types_slug_key
  ON public.scheduler_appointment_types (shop_id, slug);
-- Color IS the classification channel: two active types must never share one.
CREATE UNIQUE INDEX scheduler_appt_types_one_active_color
  ON public.scheduler_appointment_types (shop_id, tekmetric_color) WHERE active;
-- deny-all RLS + REVOKE anon/authenticated; writes only via SECURITY DEFINER RPCs.
-- BEFORE UPDATE/DELETE trigger: DELETE always refused (soft-deactivate only); is_system rows
-- additionally freeze slug/color/requires_time_slot and refuse active=false. updated_at trigger
-- maintains the staleness-check column on every write (cross-verify blocker: an unmaintained
-- updated_at makes optimistic concurrency silently useless).
```

Seed (shop 7476 via migration; new-shop onboarding is out of scope with the shops table): `waiter`
(red, requires_time_slot, is_system), `dropoff` (navy, is_system). `loaner` (yellow) / `tow_in`
(orange) are seeded **inactive** — and the classifiers read ALL rows (active or not) for color→slug
so historical yellow/orange Tekmetric appointments keep classifying, while the **wizard reads active
rows only** (bookable ⊂ classifiable). Color edits on non-system rows warn that appointments-sync
re-classifies on each sync pass (the 7-day shadow window re-upserts), so a color change can
re-label recent appointments; system colors are frozen.

RPCs — **types are edited IN PLACE** (cross-verify blocker: deactivate-then-insert would mint a new
`id` and orphan the templates FK'd to it; edit history lives in the audit log, consistent with the
§3 edit model): `scheduler_set_appointment_type` (insert or in-place update; slug immutable; writes
the audit row in the SAME transaction), `scheduler_deactivate_appointment_type` (sets
`active=false`; refuses `is_system`).

### Change list (from the verified blast radius)

- **DB:** replace the 3 `CHECK (appointment_type IN ('waiter','dropoff'))` constraints with a
  BEFORE-write **validation trigger** on each table: `appointment_type` must exist as a slug in
  `scheduler_appointment_types` for the shop (any row, active or not — historical values stay
  valid). Cross-verify overruled bare app-layer enforcement (D4 amended): ADR-016 makes service-role
  callers the trust boundary, so dropping the last DB guardrail on three core operational tables was
  a real integrity hole. **Expand/migrate/contract order:** (1) create + seed the type table,
  (2) deploy table-driven readers/classifiers (tolerant of both), (3) swap writers to validate
  against the table, (4) swap the CHECKs for the trigger, (5) only then allow creating new types.
  Rewrite the pgTAP CHECK assertions; new pgTAP for the type table (RLS row-counts, slug/color
  uniques, is_system trigger, updated_at maintenance, stale-write rejection).
- **Wizard:** `card-payloads.ts` unions → `string`; `get-current-card.ts:468-523` builds options from
  the table (live read per render — `routine_services` precedent at `:260-267`); `AppointmentTypeCard.tsx`
  drops `TYPE_META` for payload-driven label/description/emoji; `submit-appointment-type.ts` replaces
  `z.enum` with validation against active slugs; `submit-date.ts` branches on `requires_time_slot`
  instead of `=== "waiter"`.
- **Booking:** `submit-summary.ts:501-518` — color ternary → table lookup; `scheduler-booking-direct`
  parseBody type-guard; `scheduler-slots.ts` `holdAppointmentSlot` bucketing on `requires_time_slot`;
  both `classifyAppointmentType` classifiers read the table (color→slug) instead of switch statements.
- **Sync + rendering:** `appointments-sync` classifier; `transcript-html.ts:296-298` + the
  waiter→"Wait" label map in `transcript-dispatcher.ts:613` become table-driven (critic catch — a new
  type must not render as a raw slug in staff emails); `staff-notification.ts`.
- **Tekmetric probe (extend `tekmetric-api-testing`):** verify the remaining permitted colors persist
  on write before offering them in the picker (only red/navy/orange are probe-verified; decision D8
  restricts the picker until then), and settle `rideOption` (also unblocks loaner-cars).
- **Loaner coordination:** this table IS the shop-scoped loaner-color config the loaner-cars worktree
  wants (`scope.md:36`); its demand query should read `scheduler_appointment_types` rather than a
  separate constant. Coordinate before that project resumes.

### Capacity model (the honest hard part)

**v1 rule (tightened per cross-verify): `requires_time_slot=true` is reserved for the system
`waiter` row.** Custom types are always daily-cap and explicitly SHARE the existing dropoff cap in
`appointment_default_limits` (adding a loaner type reduces dropoff availability by design — one
shared pool, no per-type caps in v1). Rationale: `hold_waiter_slot`'s advisory-lock key is
type-scoped, so two waitable types sharing the same physical 8/9 AM lane could race and overbook —
rather than redesigning the lock to lane-scope now, v1 simply doesn't create a second waitable type.
Revisit (lane-scoped lock key + per-type caps) only when a real second waitable type is needed.

---

## 3. Sub-feature A — schedulerconfig webforms (de-orchestrate)

### Architecture

- **New admin-app direct-write DAL** (`admin-app/src/lib/scheduler/write-dal.ts` or per-surface
  modules): `createSupabaseAdminClient()` calling **one SECURITY DEFINER RPC per write surface** —
  the config mutation and its `manual_change` audit row commit in the SAME transaction, always
  (cross-verify: "where atomicity matters" was too soft — a config write without its audit row, or
  vice versa, corrupts the history the future LLM checker depends on). The RPC recomputes the
  before/after `diff_summary` from trusted DB reads — **the client diff modal is UX only, never
  authoritative**. Bulk surfaces (service maps, question catalogs, closed dates, limits) pass the
  render-time collection snapshot hash; the RPC recomputes and rejects on drift (catches
  added/deleted-rows conflicts that per-row `updated_at` cannot). The MD-oriented `apply_*_upload`
  RPCs retire with the uploads. Thin Actions (`wrapAdminAction` + `requireAdmin` + Zod), Fat DAL —
  unit-testable; the DAL modules are `server-only`-guarded so the service-role client can never be
  imported client-side.
- **Forms replace MD uploads**: each tab gets a real form over the live data (tables with inline
  edit / add-row / toggle per surface: routine + testing services, subcategory descriptions, service
  map, required facts, concern questions per category, guidelines prose textarea, appointment limits
  number grid, closed-dates calendar). Copy-ready precedents: `block-appointment-capacity.ts` (small
  direct form action shape), `AssignKeytagForm.tsx` (imperative-run + confirm dialog — avoids the
  force-dynamic useActionState re-suspend spin bug). The diff-modal UX for bulk edits can borrow
  `DiffPreviewDialog`'s rendering, but the two-phase server protocol behind it is gone (§ Edit
  model).
- **Two new surfaces** join the module: appointment types (from B) + message templates (from C).

### Edit model (DECIDED by Chris 2026-07-02 — replaces the Pattern S ceremony)

**The dry-run / confirm-token / pre-state-snapshot protocol is RETIRED for the new webforms.** All
live data renders on the page and is edited directly. For bulk/destructive operations the form shows
a **client-side diff modal + confirm button** (UX only — no server-side two-phase token round-trip,
no `computeConfirmToken` reimplementation). A future, separately-scoped feature will add an **LLM
functionality-checker** that reviews changes and seeks out errors after the fact — nothing in this
design should block it (audit rows carry enough before/after context to feed it).

What survives from the old machinery:

1. **Audit continuity:** every direct edit still writes a `scheduler_admin_audit_log` row
   (`operation: 'manual_change'`, `diff_summary`, and `pre_state_snapshot` where cheap). The
   existing audit history + RecentUploadsList stay readable. This is the raw material for the future
   LLM checker.
2. **shop_id trust boundary moves to the actions** (ADR-016): always server-derived, never from the
   form. Zod schemas strip client `shop_id` (existing convention).
3. **Concurrency:** last-write-wins with an `updated_at` staleness check on save (reject + refresh
   when the row changed under you) replaces the advisory-lock + drift-token protocol. Single-admin
   reality (Chris) makes the heavier machinery pure ceremony.
4. **Revert becomes legacy:** historical MD-upload rows stay revertable via the existing
   `revert_md_upload_attempt` RPC until the 30-day window ages out; the new forms produce no
   revertable uploads. The Pattern-S/canonical-state/confirm-token code is then prunable (Phase-0
   style dead-code deletion, in a later pass — not this feature).

### Orchestrator + Claude Desktop disposition (DECIDED by Chris 2026-07-02)

**Claude Desktop is retired for app tasks** (`feedback_claude_desktop_retired.md`): its capabilities
were stopgap; features built into the apps are REMOVED from Claude Desktop, and CD compatibility is
never a design consideration. Consequences:

- The 10 `upload_*_md` + 10 `export_*_md` + `revert_md_upload` + `list_scheduler_admin_audit_log` +
  `block/unblock_appointment_capacity` + `find_orphan_customers` + `run_appointments_sync` scheduler
  admin tools are **DELETED from the mcp-tool-registry** once the webforms replace them — no
  advisor-chat carve-out. The chat-only single-record edit tools (`upsert_testing_service` etc.,
  verified unused by admin-app) die with them. The 36 MD template docs under
  `docs/chat-instructions/scheduler/templates/` are deleted (their parse/validation semantics move
  into the form validators). **Deletion ordering (cross-verify):** every deleted tool gets its
  direct replacement FIRST — audit history reads move to a direct `.rpc()` call on
  `list_scheduler_admin_audit_log_filtered` (an existing outer entry point), historical-upload
  revert gets a direct action on `revert_md_upload_attempt` (kept until the 30-day window on the
  last MD upload lapses), and the Operations tab's sync-run + orphan-finder become direct
  invocations — none of these capabilities is dropped, only re-homed.
- `admin-app/src/lib/orchestrator/scheduler-client.ts` dies; `callSchedulerTool` usages in
  `admin-app/src/actions/scheduler/*` are replaced by the direct DAL.
- **orchestrator-mcp itself survives this feature only because keytag's admin-app actions still call
  it** — but the direction is now explicit: the orchestrator exits ALL app workflows. Migrating the
  keytag admin path off it (and then evaluating whether orchestrator-mcp + mcp-auth can be
  decommissioned entirely) is FOLLOW-UP scope, not this feature.

---

## 4. Sub-feature C — customizable customer comms (templates)

### Schema (lands with REVAMP Phase 1 comms foundation)

```sql
CREATE TABLE public.scheduler_message_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     integer NOT NULL CHECK (shop_id > 0),
  type_id     uuid,   -- NULL = shop-level fallback default (what makes a NEW type resolve immediately)
  kind        text NOT NULL CHECK (kind IN ('confirmation','reminder_24h','reminder_2h')),
  channel     text NOT NULL CHECK (channel IN ('sms','email')),
  subject     text,
  body        text NOT NULL CHECK (length(btrim(body)) > 0),  -- {{merge_field}} TEXT — never stored HTML
  active      boolean NOT NULL DEFAULT true,
  updated_by_email text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),  -- trigger-maintained (staleness checks)
  -- COMPOSITE FK (cross-verify BLOCKER): a template can only reference ITS OWN shop's type —
  -- a bare FK on id alone would allow shop A's template to point at shop B's type.
  FOREIGN KEY (shop_id, type_id)
    REFERENCES public.scheduler_appointment_types (shop_id, id) ON DELETE RESTRICT,
  -- channel/field invariants: email requires a subject; SMS forbids one.
  CONSTRAINT scheduler_msg_tpl_subject_channel CHECK (
    (channel = 'email' AND subject IS NOT NULL AND length(btrim(subject)) > 0)
    OR (channel = 'sms' AND subject IS NULL)
  )
);
CREATE UNIQUE INDEX scheduler_msg_tpl_one_active
  ON public.scheduler_message_templates
     (shop_id, coalesce(type_id,'00000000-0000-0000-0000-000000000000'::uuid), kind, channel)
  WHERE active;
-- Writes are RPC-only (deactivate-then-insert for history) — the expression index is deliberately
-- NOT an upsert target; PostgREST upsert cannot address it (same 42P10 class as the webhook tables).
```

**Resolution rule** (full form — the fragment was flagged as ambiguous): after verifying the
appointment's `type_id` belongs to the shop,
`SELECT ... WHERE shop_id = $1 AND kind = $2 AND channel = $3 AND active
AND (type_id = $4 OR type_id IS NULL) ORDER BY type_id NULLS LAST LIMIT 1` — type-specific wins,
shop default fills the gap. Note precisely: a new type **resolves** templates immediately; nothing
*sends* until the consent ledger + transports exist (the P0 gate is unchanged). Seed shop-default
rows for all 6 (kind×channel) combos in the migration — the SMS defaults keep a "Reply STOP to opt
out" footer (belt-and-braces beyond profile-level opt-out handling; matches our registered campaign
samples). OTP is NOT a row here — `buildOtpMessageText` stays hardcoded per Chris (considered and
rejected externalizing it; its factually-wrong "STOP exemption" comment gets corrected when the
file is touched).

### Rendering + validation

- **Renderer:** pure-TS whitelist `{{token}}` replacer in `_shared/` (shared by the confirm seam and
  the reminder cron). Unknown tokens are rejected at save; at send time an unknown token **fails
  closed** (no send + Sentry warning — corrupted-template signal), while a known token with missing
  DATA renders its documented per-field fallback. Never eval, no template engine. The email path
  HTML-escapes the ENTIRE rendered body (not just merge values — the body text itself is
  admin-authored) before injection into the fixed layout, newlines → `<br>`. Merge-field whitelist (all columns verified available): `first_name` (verified→entered
  precedence), `appointment_date`, `appointment_time` (rendered shop-tz), `appointment_type_label`,
  `vehicle` (year/make/model), `services_summary`, `shop_phone`, `shop_name`.
- **Email:** DB-stored templated TEXT injected into ONE fixed brand HTML layout (mirroring
  `scheduler-manual-review-email`'s `buildHtml` + `escapeHtml` on every merged value) + a plain-text
  alternative. React Email NOT adopted (not installed; decision D6). `resend-client.ts` gains a
  `text` field.
- **SMS form validation** (10DLC — campaign is transactional-only Low Volume Mixed): require the
  brand name substring in every body; flag marketing language; SHAFT denylist; block public URL
  shorteners; GSM-7 vs UCS-2 detection with live segment counter (warn on smart-quote/emoji silently
  halving capacity to 70/67); recommend 1-segment cap. STOP/HELP footers NOT required per-message
  (profile-level Advanced Opt-Out handles it).
- **Editor UI:** a Templates tab in schedulerconfig — per appointment type (auto-listing active types
  + the shop default row), kind × channel matrix, preview with SYNTHETIC sample merge data,
  test-send restricted to `@jeffsautomotive.com` addresses / a configured staff phone, clearly
  labeled `[TEST]`, rate-limited, and audit-logged. **Sequencing fix (cross-verify):** this tab
  ships with sub-feature C, NOT with A's webform rewrite — A ships the Types tab only (no dead
  Templates tab ahead of the schema/transports it needs).

### Send seams (unchanged from REVAMP; templates plug in)

Confirmation: fires from the post-`confirmBooking` success block in `submit-summary.ts` — but
UNLIKE the staff notification it is **not** bare fire-and-forget: customer sends require the send
ledger (`sms_messages` / notification ledger with a UNIQUE send key, e.g.
`(appointment_id, 'confirmation', channel)`) for duplicate suppression across retries/double-submits,
plus the consent snapshot (cross-verify). Reminders: the Phase-3 sweeper cron with the
`(appointment_id, reminder_kind)` idempotency ledger, state gate + JIT Tekmetric re-check, quiet
hours. **Templates do not bypass the consent gate** — sends stay blocked until `sms_consents`
exists and is checked (P0 unchanged). Observability obligation for the comms phases: a queryable
sent/skipped/blocked-by-consent/provider-failed/template-invalid breakdown (ledger status column),
not just Sentry.

---

## 5. What this scope does NOT include

Consent UI + `sms_consents` ledger, `sms_messages`, the reminder cron itself, Telnyx client
extraction, transports migration (all REVAMP Phases 1–3 — this plan slots INTO them, §8); loaner SMS
(Phase 6 fast-follow); rideOption writes before the probe; multi-shop `shops` table; React Email.

---

## 6. Testing + review obligations

- pgTAP: new tables (RLS row-counts, one-active indexes, is_system guard, template resolution) +
  rewrite `scheduler_phase1_schema.test.sql:104-110` (CHECK assertions).
- Vitest: DAL units for every new admin write path; renderer (token whitelist, escaping, segment
  math); type-driven wizard branches (`requires_time_slot`).
- Playwright: webform E2E per surface (the shipped schedulerconfig-plan §12 suite is invalidated —
  re-author); dynamic-type E2E (create type → appears in wizard → books with right color →
  templates resolve); multi-tenant isolation on the new tables.
- Reviews: /code-review gate (the direct-write DAL is a NEW pattern for admin-app — expect the
  shop-id/security/silent-failure agents to scrutinize it) + the standard agent fan-out + UI-diff
  reviewers for the new forms + /feature-cross-verify per Chris's "reverify everything after".

---

## 7. Decisions — CLOSED by Chris 2026-07-02

- **D1 — Edit model: DECIDED.** No Pattern S dry-run/confirm-token. Live data on the page, direct
  audited edits; client-side diff modal + confirm for bulk ops; a future LLM functionality-checker
  feature (separate scope) reviews changes after the fact. See §3.
- **D2 — Claude Desktop tools: DECIDED.** Claude Desktop is retired for app tasks — the scheduler
  admin tools are deleted from the registry when the webforms ship; CD compatibility is never a
  design input (`feedback_claude_desktop_retired.md`). See §3.
- **D3 — Type identity:** UUID id + stable slug + `is_system` for waiter/dropoff ✔ (accepted).
- **D5 — Template fallback:** NULL-type shop-default rows so a new type RESOLVES templates
  immediately ✔ (accepted; actual sending still gated on consent + transports, §4).
- **D10 — Sequencing/tracking: DEFERRED by Chris** — implementation does not start until he says so;
  the internal dependency order (B → A → C, §8) stands, but branch/module mechanics are decided at
  implement time.
- Accepted defaults (as amended by cross-verify, §9): **D4** the 3 CHECKs are replaced by a
  slug-exists validation trigger (not bare app-layer enforcement). **D6** fixed hand-built email
  layout, no React Email. **D7** `requires_time_slot` reserved for the system waiter row in v1;
  custom types share the dropoff daily cap. **D8** color picker = probe-verified colors ONLY
  (red/navy/orange today); **yellow is first in the probe queue** and joins the picker only once its
  write-persistence is confirmed. **D9** whitelist merge-field replacer; fail-closed at send on
  unknown tokens. **D11** loaner color source of truth = `scheduler_appointment_types`.

---

## 8. Sequencing (woven into the revamp)

1. **B first** (type table + wizard/booking/classifier migration + probe) — lands at revamp Phase 0/A
   schema time; it's the FK target for C and the color producer loaner-cars consumes.
2. **A second** (webforms; includes the new Types tab — the Templates tab ships with C, not here) —
   independent of comms but ordered after B so the type editor is built in the new webform pattern,
   and after any Phase-0 dead-code purge to avoid double-churning the same files.
3. **C last** (templates + the Templates editor tab) — schema with revamp Phase 1; rendering +
   seams live with Phase 2 transports + consent; sends activate in Phase 3. Templates without a
   consented send path are unshippable.

Cross-cutting: all three touch `appointments`/`customer_chat_sessions` shared schema, so they should
land on one branch — but per Chris (2026-07-02), branch/module mechanics and queue position are
decided when he green-lights implementation, not before. The only external coordination point is
loaner-cars reading the type table (D11).

**Follow-up scope registered (not this feature):** (1) migrate keytag's admin-app actions off
orchestrator-mcp, then evaluate decommissioning orchestrator-mcp + mcp-auth entirely; (2) the LLM
functionality-checker that reviews config changes and hunts errors; (3) prune the Pattern
S/canonical-state/confirm-token/revert machinery once the 30-day revert window on historical uploads
lapses; (4) new-shop onboarding seeds for the type + template tables (blocked on a real shops
model).

---

## 9. Cross-verify record (Gemini 2.5 Pro + GPT-5.5, 2026-07-02)

Raw findings: `.claude/work/ai-review-2026-07-02T02-51-50Z.md` (Gemini: 1 blocker / 5 important;
GPT: 7 blockers / ~20 important). **All blockers adopted** — the load-bearing amendments now inline
in §§2–4:

1. Composite FK `(shop_id, type_id)` on templates (cross-shop pollution guard) + `UNIQUE (shop_id,
   id)` on the type table.
2. Unique active `(shop_id, tekmetric_color)` — color is the classification channel and must not be
   ambiguous.
3. **Types are edited in place** (stable UUID identity; audit log = history) — deactivate-then-insert
   would have orphaned template FKs and contradicted the is_system rules.
4. `updated_at` maintained by trigger + stale-write tests (otherwise the staleness check is
   silently useless).
5. Slug-exists validation trigger replaces the dropped CHECKs (D4 amended — bare app-layer
   enforcement rejected given ADR-016's service-role trust boundary) + expand/migrate/contract
   deploy order.
6. Tool deletions re-homed before removal (direct audit-read + revert + ops actions).
7. Templates tab ships with C, not A.
8. Capacity: `requires_time_slot` reserved to the system waiter row in v1 (type-scoped advisory
   lock would race across multiple waitable types); custom types share the dropoff cap explicitly.
9. One RPC per write surface — config change + audit row atomic; server recomputes diffs; bulk
   surfaces use render-snapshot-hash preconditions.
10. Sends: ledger-backed idempotency for customer confirmations (not bare fire-and-forget);
    fail-closed on unknown tokens at send; whole-body HTML escaping; test-send safety rails;
    subject/channel CHECK; classifiers read all rows while the wizard reads active-only; slug
    format + immutability; color vocabulary CHECK; seeding scoped to shop 7476.

**Rejected findings (with reasons):** externalizing the OTP body to the template table (Chris
explicitly excluded OTP; hardcoded is a feature); adopting full per-row version history for every
config surface (audit-log `manual_change` rows + snapshots are the chosen history mechanism —
consistent with the in-place edit model); treating profile-level STOP/HELP handling as insufficient
for transactional bodies (Telnyx Advanced Opt-Out at the profile level IS the documented mechanism
and our registered samples carry the footer anyway — default seeds keep it as belt-and-braces;
re-cite at implementation).

New test obligations from this pass (add to §6): stale-write rejection (row + collection hash),
config/audit transaction atomicity, cross-shop FK rejection, is_system trigger, updated_at
maintenance, send-ledger duplicate suppression.

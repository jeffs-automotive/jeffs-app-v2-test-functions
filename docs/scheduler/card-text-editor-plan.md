# Card-text editor — plan

> **Feature:** `card-text-editor` · **Status:** plan (draft for Chris's approval) · **Author:** Claude ·
> **Date:** 2026-07-14
>
> Let Jeff's staff edit the **wording on each wizard card** from `/schedulerconfig`, with a **faithful
> live preview** of the card, **without** changing layout or buttons. Scope decisions locked with Chris
> 2026-07-14 (see §1).

---

## 1. Goal & scope (locked with Chris 2026-07-14)

**Goal.** Add a **"Card Text"** tab to the admin `/schedulerconfig` surface where staff edit the
customer-facing copy on each wizard card. The editor shows a **faithful Heritage-styled preview of the
card** with the copy rendered as inline-editable fields, so the editor sees the card as it appears on the
scheduler. Edits take effect on the live wizard (within the config cache TTL). Buttons and layout are
untouched.

**In scope — "main copy" only** (Chris: *"Main copy… a real copy of the card with text fields we can edit
so we can see what it will look like on the scheduler itself."*):
- Per-card **eyebrow, title, description/subtitle, footnote** (the `Card.Eyebrow / Title / Description /
  Footnote` slots), plus the small number of **in-body prose lines** (e.g. Greeting's "recorded &
  reviewed" note and "Have you been to our shop before?" prompt).
- **Merge fields** for personalized lines (Chris: *"Editable with merge fields"*) — e.g.
  `Hi, I'm {{agent_name}} 👋`, `Welcome back, {{first_name}}.` — via a whitelisted token renderer reused
  from `template-renderer.ts`.

**Out of scope (explicitly):**
- **Buttons / control labels / layout** — unchanged (Chris's standing constraint; enforced by the
  behavior-parity gate at verify).
- **Field labels, input placeholders, validation/error messages** — these are form *chrome*, not "main
  copy". Excluded from v1. (The two big forms — `NewCustomerInfoCard`, `CustomerInfoEditCard` — are
  therefore light-touch: only their eyebrow/title/description/footnote are editable.)
- **The "Jeff" chat bubbles** (the conversational voice persisted to `customer_chat_messages`). Chris:
  *"I don't think we use this in the scheduler right now… we may use it in the future for customers to
  manage their appointments."* Excluded entirely. (Factual note for the record: those bubble strings
  **do** still persist + replay in the transcript today — ~100 strings across 37 server-action files —
  but this feature does not touch them. A future "editable bubbles" effort is a separate, larger surface.)
- **`AppointmentTypeCard` option copy** (`card_title` / `card_description` / `emoji` per type) — **already
  editable** today via the existing **Appointment Types** tab (`scheduler_appointment_types`). We will not
  duplicate it; the new tab covers the *card chrome* (eyebrow/title/footnote), and points staff at the
  Appointment Types tab for the per-option copy.

**Approx. size:** ~90 editable strings across ~19 cards (the `WizardFooter` is all buttons → excluded).
Most cards have 3–5 slots.

---

## 2. Design decision: new table modeled on `scheduler_appointment_types` (NOT `scheduler_message_templates`)

Settled during research (agent 3). `scheduler_message_templates` is welded to outbound comms (channels
`sms|email`, subjects, GSM-7/10DLC/SHAFT validators, consent gating) — none of which applies to card UI
text, and the wizard never reads it (only the `scheduler-comms` edge fn does, at send time).

The exact precedent is **`scheduler_appointment_types`**
(`supabase/migrations/20260702031500_scheduler_appointment_types.sql`): it already stores **editable card
copy** (`card_title` / `card_description` / `emoji`), the wizard reads it through a 5-min-TTL cached
loader with a **byte-identical hardcoded fallback** (`scheduler-app/src/lib/scheduler/appointment-types.ts`
→ `FALLBACK_TYPES`), the card renders straight from the payload, and it is edited through the proven
`/schedulerconfig` **direct-write** tab. We copy that pattern almost verbatim.

**What we reuse (the mechanism):** RLS-on + zero-policy + revoke-from-anon; service-role reads from Server
Components/Actions; `SECURITY DEFINER … SET search_path = ''` write RPC with `FOR UPDATE` + optimistic
`updated_at` staleness (`stale_write:` prefix); `updated_at` touch trigger; audit via
`scheduler_admin_direct_log`; the thin-action → fat-DAL → RPC admin write chain (`DirectFormState` /
`stateFromResult` / `validationError`); the 5-min-TTL cached loader + code fallback.

---

## 3. The slot model (already exists in the codebase)

Every Heritage card renders through a **shared compound `Card`** (`scheduler-app/src/components/ui/Card.tsx`):

```
<Card.Eyebrow>…</Card.Eyebrow>       label-eyebrow (uppercase small)
<Card.Title>…</Card.Title>           font-display 2xl/28px
<Card.Description>…</Card.Description> muted 15px
<Card.Body>…fields / buttons / prose…</Card.Body>
<Card.Footnote>…</Card.Footnote>     xs tertiary
```

This is the vocabulary the editor + loader key on. A card's editable copy is a small set of **slots**
identified by a stable `(card_key, slot_key)`:

- Canonical slots present on ~every card: `eyebrow`, `title`, `description`, `footnote`.
- **In-body prose slots** (card-specific), named explicitly, e.g. `greeting`:
  - `body_disclosure` → "Heads up — this conversation is recorded and reviewed…"
  - `body_question` → "Have you been to our shop before?"

Buttons, badges, form fields inside `Card.Body` are **not** slots (out of scope).

`card_key` mirrors the `WizardStep` / card enumeration used in
`scheduler-app/src/lib/scheduler/wizard/card-payloads.ts` (e.g. `greeting`, `phone_name`,
`concern_explanation`, `summary`, `completed`, …).

---

## 4. Data model — `scheduler_card_text`

New migration `supabase/migrations/<ts>_scheduler_card_text.sql`, structured like the appointment-types
migration.

```sql
create table public.scheduler_card_text (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              integer not null check (shop_id > 0),
  card_key             text not null check (card_key ~ '^[a-z0-9_]{2,60}$'),
  slot_key             text not null check (slot_key ~ '^[a-z0-9_]{2,60}$'),
  label                text not null,                 -- human field label in the editor ("Title")
  body                 text not null check (length(body) <= 2000),         -- current (editable) copy; may contain {{tokens}}
  default_body         text not null check (length(default_body) <= 2000), -- immutable seed copy → "Reset to default"
  allowed_merge_fields text[] not null default '{}',  -- whitelist for THIS slot (subset of the global set)
  sort                 integer not null default 0,    -- slot order within the card (preview layout)
  active               boolean not null default true,
  updated_by_email     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (shop_id, card_key, slot_key)                -- edit-in-place, one row per slot
);

create index scheduler_card_text_shop_card
  on public.scheduler_card_text (shop_id, card_key, sort);
```

- **Edit-in-place** (stable id keyed by `card_key`+`slot_key`), matching appointment-types; history in
  `scheduler_admin_audit_log`. No `channel`/`kind`/`subject` — this is not comms.
- `default_body` is set once at seed and never mutated → drives a reliable **"Reset to default"** and a
  drift check.
- `updated_at` **touch trigger** (reuse the `scheduler_appt_types_touch()` shape) — mandatory, else the
  optimistic staleness check is silently useless.
- **Security posture (copied from appointment-types):** `enable row level security`; `revoke all …
  from public, anon, authenticated`; `revoke delete, truncate … from service_role`. No policies → only
  service_role reaches it (RLS-bypass), and the app enforces `shop_id` + `requireAdmin`.

**Seeds:** one row per in-scope `(card_key, slot_key)` for shop 7476, with `body` = `default_body` =
**byte-identical** to the current component literal, `allowed_merge_fields` per slot, `label` +
`sort` for the editor. (Same "seeds reproduce live copy byte-for-byte" discipline as appointment-types,
so nothing renders differently on day 1.)

**Write RPC** `scheduler_set_card_text(p_shop_id, p_actor, p_card_key, p_slot_key, p_body,
p_label, p_default_body, p_allowed_merge_fields, p_sort, p_expected_updated_at)` — `language plpgsql
security definer set search_path = ''`. **UPSERT, not bare UPDATE** (cross-verify blocker fix §12.1): it
`insert … on conflict (shop_id, card_key, slot_key) do update`, so a shop/slot with no row yet (a new or
uncustomized shop) still persists — the structural fields (`p_label`, `p_default_body`,
`p_allowed_merge_fields`, `p_sort`) are carried by the admin action from its manifest and used on the
INSERT branch. Staleness is checked on the UPDATE branch: `select … for update` then `stale_write:` raise
on `updated_at is distinct from p_expected_updated_at`. On the update branch it sets `body = p_body,
updated_by_email = p_actor` (never overwrites `default_body`). Then `perform
public.scheduler_admin_direct_log(p_shop_id, p_actor, 'scheduler_card_text', 'card_text', <1 on insert /
0>, <0 / 1 on update>, 0, jsonb_build_object('card_key',…, 'slot_key',…, 'via','webform'),
to_jsonb(v_old))`; `return jsonb_build_object('ok', true, 'id', …, 'updated_at', …)`. `revoke … from
public/anon/authenticated` + `grant execute … to service_role`. Companion
`scheduler_reset_card_text(p_shop_id, p_card_key, p_slot_key)` copies `default_body`→`body`.

**Protection trigger** `scheduler_card_text_protect` (cross-verify §12.4, mirrors
`scheduler_appt_types_protect`): refuse DELETE (deactivate instead); freeze `default_body`, `card_key`,
`slot_key` as immutable after insert — so a bug or stray write can't corrupt "Reset to default" or the
slot identity.

**pgTAP** (`supabase/tests/database/scheduler_card_text.test.sql`): anon cannot SELECT; service_role write
via RPC updates `body` + writes one `manual_change` audit row; stale `expected_updated_at` → `stale_write`;
reset restores `default_body`; unknown `slot_key` rejected.

---

## 5. Wizard read path (scheduler-app)

New loader `scheduler-app/src/lib/scheduler/card-text.ts`, modeled 1:1 on `appointment-types.ts`:

- `CARD_TEXT_DEFAULTS`: a code manifest `{ [card_key]: { [slot_key]: { default, allowed_merge_fields } } }`
  — the **outage fail-safe** (like `FALLBACK_TYPES`). A unit test asserts it equals the migration seed
  (drift guard).
- `getCardText(cardKey): Promise<Record<slot_key, string>>` — 5-min TTL cache of the full
  `scheduler_card_text` read (`.eq('shop_id', SHOP_ID)` `.eq('active', true)`), overlaying DB `body` onto
  `CARD_TEXT_DEFAULTS`. Two cross-verify fixes vs. the appointment-types loader:
  - **Cache keyed by `shop_id`** (a `Map<shopId, {fetchedAt, rows}>`, not a single global `let cache`) —
    so if `SHOP_ID` ever becomes dynamic, one shop's copy can never be served to another (multi-tenant
    leak; §12.2). Cheap insurance even though `SHOP_ID` is a constant today.
  - **Zero rows is NORMAL, not an outage** (§12.3): an uncustomized shop legitimately has no override rows
    → return defaults **quietly**. Only a genuine read **error** is Sentry-captured (observability rule 9).
    This is the key difference from `appointment-types.ts`, where 0 rows *is* an outage (the wizard can't
    function without bookable types). `__resetForTests`.
- **Merge-field substitution** happens where the card payload is built (`get-current-card.ts` and the
  card-payload builders already compute the values — `agent_name`, `shop_name`, `first_name`, vehicle,
  date, etc.). A shared `renderCardText(body, values)` ports the `template-renderer.ts` whitelist logic to
  scheduler-app (or is extracted to a shared module — see §8). Values are the ones the card already has;
  the save-time validator guarantees no token the card can't supply ever reaches render.

**Per-card migration recipe** (repeat per card; the mechanical bulk of the work — mirrors how
`AppointmentTypeCard` was already migrated off `TYPE_META`):
1. Move the card's literal strings into `CARD_TEXT_DEFAULTS[cardKey]` + the migration seed.
2. In the card's payload builder (`get-current-card.ts` / `card-payloads.ts`), call `getCardText(cardKey)`,
   substitute merge values, and add the resolved slot strings to the card's payload (`copy: {...}`).
3. In the component, replace the inline literals with `props.copy.title` etc. (Buttons/fields untouched.)

Because scope is "main copy", the component change per card is small and low-risk; the behavior-parity
gate at verify proves each card still works identically.

---

## 6. Admin editor tab (admin-app) — the faithful preview

New **"Card Text"** tab in `/schedulerconfig`, following the exact "add a new tab" recipe (research
agent 2): read-DAL `listCardText()`, write-DAL `setCardText(actor, …, expectedUpdatedAt)` →
`callRpc('scheduler_set_card_text', …)`, action `setCardTextAction` (`wrapAdminAction` + `requireAdmin` +
Zod + `renderTemplate`-style unknown-token reject + `revalidatePath('/schedulerconfig')`), register in
`DirectConfigTabs` `TAB_ORDER`, wire into `page.tsx` `Promise.all` + `slots`.

**The defining UX — faithful inline preview** (Chris's requirement). **Design spec DONE:**
`.claude/work/design/card-text-editor-spec.md` (frontend-design-director, 2026-07-15). Key decisions from
it, adopted:
- **"Card on a workbench"** — admin's own Workshop-Brass chrome (picker rail + save bar) frames a paper
  canvas on which a single **byte-faithful Heritage card** floats; every copy piece is a real labeled
  field in its exact on-scheduler typography; non-copy is drawn as **ghosted inert placeholders**.
- **A design-owned static `CARD_PREVIEW_MANIFEST`** (NOT new DB columns) carries the presentation layer:
  per card a `head[]` (`{slot_key, role}`), an **ordered** `body[]` interleaving `{block:"slot",…}` and
  `{block:"ghost", hint}` (resolves cross-verify §12.8 — Greeting's prose-between-buttons), and
  `footnotes[]`. The preview merges manifest (geometry) + row (copy); a unit test enforces manifest↔seed
  slot-key parity. **This keeps the §4 DB schema pure copy data** — no schema change.
- **Scoped `.heritage-preview` `--hp-*` stylesheet**, values byte-copied from scheduler `globals.css`,
  `color-scheme:light` hardcoded → theme-independent and collision-free with admin's shadcn theme.
  **Correction from the spec: admin dark mode is now LIVE** (`admin-app/app/providers.tsx` mounts
  ThemeProvider; the reference doc was stale) — which is *why* the preview must be theme-locked.
- Merge-field **chips** show sample values at rest, reveal raw `{{token}}` on focus, per-slot "Insert
  field" scoped to `allowed_merge_fields`, unknown token → `role="alert"` + Save disabled (fail-closed
  server-side). Imperative save + `expected_updated_at` staleness + per-slot reset, matching
  `TemplatesEditor`.
- **Spec risk R2** echoes cross-verify §12.1: a truly unseeded shop needs default text on the admin side —
  handled for shop 7476 by the seed; future shops get a slim admin defaults mirror or the empty-state
  banner (both specced).

Original shape (still accurate):

- A **card picker** (list/dropdown of the ~19 cards) on the left; the selected card's **faithful Heritage
  preview** on the right.
- **One generic `HeritageCardPreview` component**, data-driven by the card's slot rows — NOT 19 bespoke
  replicas. Because the "main copy" scope only touches the shared `Card` slots
  (eyebrow/title/description/body-prose/footnote), a single preview parameterized by "which slots this
  card has + their text + which are editable" faithfully represents every card's *text* layout. Buttons /
  form fields are drawn as **static ghosted placeholders** so the layout reads correctly without being
  editable.
- Each editable slot is an **inline field** styled in the slot's real typography (eyebrow = `label-eyebrow`,
  title = `font-display`, etc.), so typing shows the true on-scheduler look. **Merge-field tokens** render
  as chips with sample values in preview; an "insert field" affordance lists the slot's
  `allowed_merge_fields`.
- **Faithfulness requires porting the Heritage visual tokens into admin-app** (scoped): `paper-*`,
  `ink*`, `brand-gold-*`, `--radius-card`, `--shadow-card`, the `label-eyebrow` / `font-display` utility
  classes, and the **Poppins** font. Admin-app is shadcn/base-nova with its own theme, so this is a
  **scoped Heritage stylesheet** applied only inside the preview container. (The director will specify the
  exact token set + font load + whether to lift the `Card.tsx` markup verbatim into a preview-only
  component. This is the main design risk — pixel drift between preview and the real card — mitigated by
  reusing the same CSS variable names/values.)
- **Save / Reset / staleness:** imperative save with a `saving` flag (per the Templates editor's
  documented SPIN NOTE — not `useActionState`), `expected_updated_at: row.updated_at`, `sonner` toasts on
  `success | stale | validation_error | error`, `router.refresh()` on success/stale, per-slot "Reset to
  default" (disabled when `body === default_body`).

---

## 7. Rollout — all cards, one pass (Chris 2026-07-15)

Chris chose **all ~19 cards in a single feature** (no intermediate ship). Internal build order still
sequences to keep each step verifiable:

1. **Backend/mechanism first:** table + RPC + touch trigger + grants + pgTAP; the full seed for **every**
   in-scope `(card_key, slot_key)` across all cards; `card-text.ts` loader + `CARD_TEXT_DEFAULTS` manifest
   (all cards) + `renderCardText`.
2. **Admin editor:** tab + generic `HeritageCardPreview` + read/write-DAL + action (covers all cards
   data-drivenly — the preview is parameterized, so no per-card admin work).
3. **Wizard cards:** migrate all card components off inline literals to `props.copy.*`, threading `copy`
   through their payload builders. This is the mechanical bulk; each card is behavior-parity-checked.

All cards land together, then one verify pass + one deploy. (The generic preview means the admin side does
not grow per card — only the seed manifest + the per-card component edits do.)

---

## 8. Cross-cutting / compliance

- **Shop-agnostic:** `shop_id` server-resolved (`SHOP_ID` / `resolveAdminShopId()`), never from client;
  table is shop-scoped; seeds are for 7476 but the schema is generic. New shops get defaults from
  `CARD_TEXT_DEFAULTS` until seeded.
- **Observability:** loader failure → Sentry-captured fallback (rule 9, no silent failure); every Supabase
  call checks `error`; RPC audit row on every write.
- **Security:** `requireAdmin()` first in the action; SECURITY DEFINER `search_path = ''`; unknown-token
  reject fail-closed at save; RLS deny-all + service-role-only.
- **Merge-field renderer reuse:** extract `template-renderer.ts`'s whitelist logic to a shared spot usable
  by both the admin save-validator and the scheduler-app renderer (mirrors the existing admin
  `template-renderer.ts` ↔ edge `scheduler-comms/core.ts` "keep in sync" split — but here we can share one
  module since both are TS; if a clean shared import isn't feasible across the two app builds, duplicate +
  a parity test, per the appointment-types fallback precedent).
- **Testing:** pgTAP (RLS + RPC + staleness + reset); Vitest (loader overlay + fallback + drift-guard +
  renderer whitelist); the verify-phase **UI-diff hard gate** (`design-review` + `wiring-review` +
  `dead-code-review` + `behavior-parity-review`) must be blocker-free — behavior-parity is the proof that
  each migrated card "works exactly the same, only the words can change."

---

## 9. Files (all cards)

**Create**
- `supabase/migrations/<ts>_scheduler_card_text.sql` — table + touch trigger + `scheduler_set_card_text`
  (+ reset) RPC + seeds for **all** in-scope `(card_key, slot_key)` + grants.
- `supabase/tests/database/scheduler_card_text.test.sql` — pgTAP.
- `scheduler-app/src/lib/scheduler/card-text.ts` — loader + `CARD_TEXT_DEFAULTS` (all cards) + `renderCardText`.
- `scheduler-app/src/lib/scheduler/card-text.test.ts` — overlay/fallback/drift/renderer.
- `admin-app/src/components/scheduler/direct/CardTextDirectTab.tsx` + `HeritageCardPreview.tsx`
  (+ scoped Heritage stylesheet/tokens per the design spec).
- `.claude/work/design/card-text-editor-spec.md` — `frontend-design-director` output.

**Edit**
- `scheduler-app/src/lib/scheduler/wizard/get-current-card.ts` + `card-payloads.ts` — thread `copy` into
  every in-scope card's payload.
- **All ~19 in-scope card components** under `scheduler-app/src/components/scheduler/heritage/` — literals
  → `props.copy.*` (main-copy slots only; buttons/fields untouched). (`WizardFooter` excluded — all
  buttons; `AppointmentTypeCard` option copy stays on the Appointment Types tab.)
- `scheduler-app/src/lib/database.types.ts` + `admin-app/src/lib/database.types.ts` — regen after migration.
- `admin-app/src/lib/scheduler/read-dal.ts` (+ `listCardText`), `write-dal.ts` (+ `setCardText`),
  `src/actions/scheduler/direct-config-actions.ts` (+ `setCardTextAction`),
  `src/components/scheduler/direct/DirectConfigTabs.tsx` (register tab), `app/schedulerconfig/page.tsx`
  (wire slot).
- `.claude/memory/scheduler/scheduler_system_architecture.md` — new tab + table + loader (+ bump "Last
  updated").

---

## 10. Open items for Chris (before implement)

1. **Workflow/marker organization.** An active `qteklink-payroll` feature marker sits in `implement` phase
   (shipped/deployed but not `/feature-done`'d). This feature is a different module (scheduler/admin).
   Options: (a) `/feature-done` qteklink-payroll first, then run card-text-editor on `main`; (b) spin
   card-text-editor into its own worktree via `/project-start` (the concurrency model), leaving the
   qteklink marker untouched; (c) other. **My recommendation: (a) if qteklink-payroll is truly finished,
   else (b).** Needs Chris's call.
2. ~~Phasing~~ — **DECIDED 2026-07-15: all cards in one pass** (§7).
3. **Preview faithfulness ceiling** — confirm the "one generic Heritage preview + ghosted buttons"
   approach is acceptable (vs pixel-perfect per-card replicas, which would be far more work). I recommend
   the generic approach; the design spec will show a mock.

---

## 11. Next steps (after approval)

Plan approved → dispatch `frontend-design-director` for the preview spec → `/feature-cross-verify` the
plan (Gemini + GPT) → resolve the marker/worktree org → `/feature-implement` → build (all cards) TDD →
`/feature-verify` (typecheck + tests + build + `/code-review` + UI-diff hard gate) → deploy → `/feature-done`.

---

## 12. Cross-verify hardening (2026-07-15)

Ran `scripts/ai-review.mjs` on this plan + the precedent files (`Card.tsx`, `appointment-types.ts`, the
appointment-types migration, `template-renderer.ts`). **Gemini 3.5 Flash passed with findings; the GPT
call failed (network/`OPENAI_API_KEY`) — partial cross-verify.** Artifact:
`.claude/work/ai-review-2026-07-15T04-10-39Z.md`. (Re-run GPT when the key is available — one model is not
the full second opinion.) Accepted findings, folded into the plan:

- **§12.1 (BLOCKER) — write path must UPSERT.** A bare UPDATE no-ops for a shop/slot with no row yet
  (uncustomized/new shop). RPC is now `insert … on conflict … do update`, structural fields carried by the
  action. Folded into §4.
- **§12.2 (BLOCKER) — loader cache keyed by `shop_id`.** The appointment-types global `let cache` would
  leak one shop's copy to another if `SHOP_ID` becomes dynamic. New loader uses `Map<shopId, …>`. Folded
  into §5.
- **§12.3 (important) — 0 rows is normal for card text.** Do NOT Sentry on empty result (that would flood
  on every uncustomized shop); Sentry only on a genuine read error. Folded into §5.
- **§12.4 (important) — protection trigger.** Freeze `default_body` / `card_key` / `slot_key`; refuse
  DELETE — protects "Reset to default" + slot identity. Folded into §4.
- **§12.5 (important) — `body` length CHECK** (`<= 2000`) — stop a pasted mega-payload bloating the
  table/cache/render. Folded into §4.
- **§12.6 (important) — preserve line breaks.** `Card.Description` / `Card.Footnote` collapse `\n` to
  spaces today. For DB-driven copy, render the description/footnote/prose slots with `white-space:
  pre-line` (applied at the payload-render site, NOT by mutating the shared `Card.tsx` — that would touch
  every card and break behavior-parity). Editor: single-line inputs for `eyebrow`/`title`, multiline
  (pre-line) for `description`/`footnote`/body-prose.
- **§12.7 (important) — renderer must NOT couple to the SMS whitelist.** `template-renderer.ts` hardcodes
  `MERGE_FIELD_SAMPLES` (SMS tokens — `first_name`, `appointment_date`, … — which does NOT include
  `agent_name` / `shop_name` that cards need). Extract the whitelist logic to take a **caller-supplied
  token map**, and give card-text its **own per-slot allowed-token set** (`allowed_merge_fields` on the
  row). This is a real requirement, not a nicety — the SMS whitelist can't validate card tokens.
- **§12.8 (important) — preview faithfulness for interleaved layouts.** Greeting interleaves prose slots
  (`body_disclosure`, `body_question`) *between* buttons. The generic `HeritageCardPreview` must place
  ghosted controls in the card's real order — so the per-card manifest carries an **ordered** slot +
  ghosted-control layout, not a flat slot list. Escape hatch: if a card's body is too bespoke to render
  faithfully from the generic component, that one card gets a small dedicated preview. The
  `frontend-design-director` spec owns resolving this; flagged to it.

# Scheduler domain — chat agent rules

Consult this file whenever the user mentions any of:
**scheduler, appointment, booking, /book, testing service, routine service, concern, diagnostic, "describe concern", brake inspection, check battery, warning lights, check suspension, A/C check, concern questions, sub-category, pricing, price change, "set price", closed dates, appointment limits, availability, orphan customer, sync appointments, revert upload, undo upload** in a shop context.

---

## Per-MD edit guides (open one of these when the user asks to change content for that specific table)

The detailed format spec + dry-run-then-confirm flow + examples for each MD type live in dedicated files:

- [`scheduler/edit-testing-services.md`](./scheduler/edit-testing-services.md) — 15 diagnostic services. Option B per-service-block MD. New fields: `description`, `example_keywords`. Two-step dry-run-then-confirm flow.
- [`scheduler/edit-routine-services.md`](./scheduler/edit-routine-services.md) — 10 picker chips. Same Option B format. New columns: `description` (added 2026-05-19), `starting_price_cents`, `price_waived_note`. Two-step flow.
- [`scheduler/edit-concerns.md`](./scheduler/edit-concerns.md) — `{cat}-concerns.md` checklists + `{cat}-guideline.md` per-category prose. Hierarchical sub-cat + question format with `[multi]` chips. Two-step flow.
- [`scheduler/edit-closed-dates.md`](./scheduler/edit-closed-dates.md) — holidays + one-off closures. Sundays auto-managed by cron — don't list them here.
- [`scheduler/edit-appointment-default-limits.md`](./scheduler/edit-appointment-default-limits.md) — per-day-of-week capacity pattern. Note the Sunday-is-closed cascading cron behavior.
- [`scheduler/revert-upload.md`](./scheduler/revert-upload.md) — undo a recent successful bulk upload via `revert_md_upload(upload_id)`. 30-day snapshot retention. Currently supports testing_services + routine_services.

**Two-step flow (mandatory for all bulk uploads since 2026-05-19):**
1. Call upload tool with `dry_run: true` (DEFAULT) → tool returns diff_summary + validation_errors + validation_warnings + confirm_token.
2. SHOW the diff to the advisor. Get explicit "yes".
3. Re-call with `dry_run: false` + `expected_confirm_token: <token from step 1>` to actually apply.
4. On apply success, the response includes `audit_log_id` — save it (needed for revert).

**Validation rules** (same on bulk-upload AND single-row `patch_*_service_fields` paths since 2026-05-19):
- `service_key` matches `^[a-z0-9_]+$`
- `concern_categories` ⊆ 14 canonical slugs (noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other)
- `starting_price_cents` non-negative integer
- `description` 10-500 chars (when present)
- `abbreviation` ≤30 chars

---

## Background

The customer-facing scheduler lives at **appointments.jeffsautomotive.com** (the `/book` route in scheduler-app). Customers go through a wizard to book an appointment:

```
Greeting → Phone+Name → OTP → (reconciliation) → Customer Info → Vehicle Pick
   → Service + Concern Picker → (per-service diagnostic Q&A)
   → Appointment Type (waiter / dropoff) → Date → Time → Hold
   → Summary → Confirm → Customer Notes → Done
```

Customers interact with the wizard directly. **Advisors don't book on behalf of customers through this chat** — that's still done in Tekmetric. What advisors DO via the chat is **administer the predefined data** behind the wizard:

- Add / edit / deactivate **testing services** (with pricing)
- Add / edit / deactivate **routine services** (NO pricing — Phase 1 design)
- Edit the **concern checklists** the diagnostic LLM uses (one markdown doc per category)
- Edit the **per-category guideline prose** the diagnostic LLM reads
- Edit **appointment availability** (default per-day limits, blackout dates)
- Trigger **appointment sync** from Tekmetric on demand
- Find **orphan customers** (locally cached but deleted in Tekmetric)

### The 14 concern categories (memorize these — don't invent new ones)

`noise`, `vibration`, `pulling`, `smell`, `smoke`, `leak`, `warning_light`, `performance`, `electrical`, `hvac`, `brakes`, `steering`, `tires`, `other`

Each category has 6-12 **sub-categories** (specific symptom patterns) with 5-7 plain-language **questions** each. The diagnostic LLM uses the sub-category that best matches the customer's free-form description, then asks any questions the description didn't already answer.

---

## Orchestrator tools available for the scheduler

### READ tools (no audit log entry)

| Tool name | What it does |
|---|---|
| `list_routine_services` | Lists the routine-service catalog (chips on the picker card) |
| `list_concern_questions` | Lists concern questions for a category (post-sub-cat-refactor) |
| `lookup_testing_service_pricing` | Resolves `service_key` → display_name + starting_price_cents + concern_categories |
| `find_orphan_customers` | Locally cached customers Tekmetric has deleted (drift detector) |

### WRITE tools (every call appends a row to `scheduler_admin_audit_log` with the advisor's user_label)

| Tool name | What it does |
|---|---|
| `upsert_testing_service` | Full-row upsert for one testing service (requires every field) |
| `patch_testing_service_fields` | **Partial-field update** — change just the price (or any subset) without re-supplying every column |
| `deactivate_testing_service` | Soft-delete a testing service (sets `active=false`; preserves transcript references) |
| `upsert_routine_service` | Full-row upsert for one routine chip (NO pricing field — routine services have no pricing in Phase 1) |
| `patch_routine_service_fields` | **Partial-field update** for routine services |
| `deactivate_routine_service` | Soft-delete a routine chip |
| `upload_concern_category_md` | Upload ONE category's hierarchical .md checklist. Parses sub-categories + numbered questions, **answer-options + multi_select** (added 2026-05-18), diff-based upsert + soft-delete absent rows, audit-logged with md_content_hash |
| `upload_concern_category_guideline_md` | **(NEW 2026-05-18)** Upload ONE category's diagnostic-guideline prose paragraph. Single-row upsert keyed on `(shop_id, category)`. The diagnostic LLM reads this prose BEFORE the per-subcategory questions. |
| `upload_concern_questions_md` | **LEGACY** — flat-table format upload (pre-sub-category). Still works but `upload_concern_category_md` is the forward path. |
| `upload_routine_services_md` | Bulk replace the routine-services catalog from an MD table |
| `upload_testing_services_md` | Bulk replace the testing-services catalog (with prices) from an MD table |
| `upload_appointment_default_limits_md` | Replace per-day-of-week capacity defaults |
| `upload_closed_dates_md` | Replace the FUTURE closed-dates set (past dates are immutable) |
| `export_*_md` | Round-trip exports — download current state as MD, edit locally, upload back |
| `run_appointments_sync` | On-demand call to the appointments-sync edge function (catches up the local appointments shadow from Tekmetric) |

You don't call these directly — you call `run_orchestrator` and it routes to the right one. But knowing what's available helps you frame the intent.

---

## Clarifications to handle BEFORE sending to the orchestrator

### 1. Money — always integer cents, displayed as dollars

Internal: `starting_price_cents` is **integer cents**. `4995` = $49.95.

| User says | You send to orchestrator |
|---|---|
| "Set brake inspection price to $45" | `starting_price_cents: 4500` |
| "Charge $49.95 for the battery test" | `starting_price_cents: 4995` |
| "Make it forty bucks" | `starting_price_cents: 4000` |
| "Drop it by 5 dollars" | First look up current price, subtract, send the new total |
| "$45.999" / "$45 1/2" | Reject — "Prices need to be in dollars and cents, like $45.99." |

After a write, **always** confirm with the dollar form:
> "Updated **Brake Inspection** price to **$45.00**."

### 2. Confirm before large price changes

For any price change where the delta is **>25%** OR the absolute change is **>$50**, confirm BEFORE calling the orchestrator:

> "Just to confirm — change **Brake Inspection** from $39.99 to $99.99? That's about 150% more."

Wait for "yes" before proceeding. Small tweaks (under 25%) don't need a confirmation step.

### 3. service_key is required and is the canonical identifier

Service keys are lowercase + underscore: `brake_inspection`, `check_battery`, `warning_lights`, `oil_change`, etc. **Never invent a key.** If the user names a service in prose:

| User says | What you do |
|---|---|
| "Brake inspection" | Match to `brake_inspection` |
| "Change the AC check price" | Match to either `check_ac` (routine) or an AC testing service — `lookup_testing_service_pricing` first if ambiguous |
| "The new transmission scan" | Service key not obvious — ASK: "What service_key should this use? (lowercase + underscore — e.g. `transmission_scan`)" |
| "tire rotate" | Match to `tire_rotate` (existing routine chip) |

When in doubt, list the existing services first via a read tool so you and the user are both on the same page.

### 4. Routine services HAVE NO PRICING in Phase 1

If the user asks to set a price on a **routine** service (oil_change, tire_rotate, alignment, state_inspection, etc.), correct them:

> "Routine services don't have a price field — only the testing services do (Brake Inspection, Check Battery, etc.). Did you mean one of the testing services?"

If they ARE talking about a testing service that was miscategorized as routine, that's a different problem — you may need to deactivate the routine entry and create a testing entry. Confirm before doing either.

### 5. Concern categories — only the 14 valid values

When the user references a concern category (e.g. for `concern_categories` on testing_services), validate against:

`noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other`

| User says | You do |
|---|---|
| "Add a transmission category" | "There isn't a 'transmission' category in our 14. Closest fits: `performance` (slipping, rough shift) or `other`. Which?" |
| "Tag it for brakes and noise" | `concern_categories: ['brakes', 'noise']` — OK |
| "Engine category" | "There's no 'engine' category — closest are `performance`, `electrical`, `leak`, or `smoke` depending on the symptom. Which one?" |

### 6. Uploading a concern category MD — confirm the category_slug

`upload_concern_category_md` takes BOTH a `category_slug` AND the MD content. The slug is mandatory and must be one of the 14. If the user says:

> "Upload the brakes doc"

→ Confirm: "Uploading `brakes` — that's the file `concerns/brakes/brakes-concerns.md`, right?"

Then pass `category_slug: 'brakes'` + the MD content.

If the user pastes the content directly into chat, treat the full pasted block as `md_content`. If they reference a local file, ask them to paste it (the orchestrator can't read their filesystem).

### 7. Re-uploading the same MD is a no-op

The upload tools compute a SHA-256 of the content and short-circuit if it matches a prior upload. The orchestrator returns `duplicate_upload: true` — pass that through:

> "That content matches what's already in the DB — no changes made."

### 8. Confirm soft-deletes (deactivations)

Soft-deletes don't bulk-delete by themselves — but `upload_concern_category_md` and the bulk MD uploads soft-delete any sub-category, question, or row that's IN the DB but MISSING from the uploaded content. That's intentional (so the MD is the source of truth) but it can surprise advisors.

Before any upload that removes rows from a category, confirm:

> "Uploading this will deactivate any sub-categories / questions that aren't in your MD. Specifically, this version has 6 sub-categories — the current DB has 8 for `brakes`. The 2 not in your file (`x_subcat_a`, `y_subcat_b`) will be soft-deleted. Proceed?"

If they say yes, proceed. If they didn't intend to drop those, have them edit their MD to include them.

### 9. Concern question OPTIONS + multi-select are carried in the MD format (updated 2026-05-18)

The MD format now carries answer-options + a multi-select flag inline. Each numbered question has an indented `- ` line beneath it with `|`-separated entries:

```markdown
1. Does it occur at high speeds, low speeds, or right before stopping?
   - High speeds=high | Low speeds=low | Right before stopping=stopping | Not sure=unsure
2. [multi] Do you hear the noise coming from the front or rear of the vehicle? Left or right side?
   - Front=front | Rear=rear | Left side=left | Right side=right | All four wheels=all | Not sure=unsure
```

- `Label=value` form: parser uses both verbatim. The `=value` is optional — when omitted, the parser slugifies the label.
- `[multi]` prefix on the question text → multi-select chip card (chips toggle, then a Continue button). Otherwise single-select (tap-to-submit).
- A question with NO options line falls through to the legacy default `[Yes, No, Sometimes / Not sure]` set — back-compat for old MDs.

When uploading an updated concern MD: the parser honors options + multi_select. For EXISTING matched questions it only updates `options/multi_select` if the MD differs from the DB. For NEW questions it uses the MD's parsed options (or the default set if the line is missing).

### 10. Concern category guidelines — separate from the questions (updated 2026-05-18)

`concern_category_guidelines` is a different table from `concern_questions`. It holds the per-category **prose paragraph** the diagnostic LLM reads BEFORE the questionnaire — it shapes how the LLM phrases follow-up questions and what facets it prioritizes.

There IS now an upload tool: `upload_concern_category_guideline_md`. Edit `docs/scheduler/concerns/{slug}/{slug}-guideline.md`, then ask Claude:

> "Upload the updated brakes guideline."

Format: H1 with the display label + the prose body. Stops at the first `---` rule (notes/sources ignored). One row per category; the upload is a single-row upsert keyed on `(shop_id, category)`.

To VIEW the current guideline without editing: read `concern_category_guidelines` directly (read-only) OR open the matching guideline MD file.

### 11. Appointment availability — past vs future

`upload_closed_dates_md` only affects FUTURE closed_dates. Past dates are immutable (historical record). If the user tries to "un-close" a past date, refuse:

> "Past closed dates are locked — historical record. I can only edit future closures."

### 12. Sync triggers — manage expectations

`run_appointments_sync` takes a few seconds (typically 2-10s). Set expectations:

> "Running appointments sync — give me a few seconds…"

After the call, summarize:

> "Sync done in 3.2s. **47** appointments in the rolling 7-day window. **0** soft-deleted (none missing from Tekmetric). Last sync time updated."

### 13. Vague intent — ask what they want

User says "Fix the scheduler" or "Look at the brakes" → don't guess. Ask:

> "What do you want to do with brakes — view the concern questions, edit the testing-service price, look at recent bookings, or something else?"

### 14. Multi-step requests — execute in order, confirm each

User: "Drop the brake inspection price to $35 and add 'corroded terminals' to the battery test keywords"

→ Two orchestrator calls in sequence:
  1. `patch_testing_service_fields(service_key='brake_inspection', starting_price_cents=3500)`
  2. `patch_testing_service_fields(service_key='battery_test', example_keywords=[...current + 'corroded terminals'])` (lookup current first if needed)

Report both. If step 1 fails, stop and ask before step 2.

### 15. Format flexibility — accept and translate

| User types | Translate to |
|---|---|
| `brake_inspection` / `brake inspection` / `Brake Inspection` | service_key: `brake_inspection` |
| `$45` / `45 dollars` / `forty-five dollars` / `45.00` | starting_price_cents: 4500 |
| `WARNING LIGHT` / `warning-light` / `warning light` | category: `warning_light` |
| `Red 5` (keytag context — not scheduler) | redirect to keytag.md |

---

## After the orchestrator returns

### Successful price/field changes — confirm concretely with dollar amounts

✅ "Updated **Brake Inspection** price to **$45.00**. (Changed: `starting_price_cents`.)"
✅ "Updated **Check Battery** — added keywords ['corroded terminals']. (Changed: `example_keywords`.)"
✅ "Updated **Warning Lights** — flipped `requires_explanation` to true. (Changed: `requires_explanation`.)"

❌ Don't just say "Updated" or "OK".
❌ Don't show cents to the user — show dollars (`$45.00`, not `4500`).

### Successful concern doc uploads — show the diff summary

✅ "Uploaded **brakes** concern doc. 6 sub-categories, 37 questions. (Added: 0 / Modified: 6 / Deactivated: 0 — content matches current DB structure.)"
✅ "Uploaded **electrical** concern doc. 7 sub-categories, 49 questions. (**3 added**, 0 modified, **1 sub-cat deactivated** — `loose_battery_terminal` is gone now.)"

### Successful reads — concise

✅ "**Brake Inspection** is currently **$39.99**. Categories: `brakes`. Notes: [if present]. Last edited by mike@ on 2026-05-10."
✅ "**Warning Lights** routine chip: requires_explanation=true, wait_eligible=false, concern_categories=[`warning_light`]."

### Audit history — group sensibly

When the audit log returns multiple rows, structure newest-first with the time, user, action, and table:

```
**3 admin changes today:**
- 14:23 — mike@ patched `brake_inspection` (starting_price_cents 3999 → 4500)
- 11:08 — chris@ uploaded the `electrical` concern doc (3 added, 0 modified, 1 deactivated)
- 09:14 — chris@ deactivated `tpms_testing` (active false)
```

### Errors — surface verbatim with next steps

| Orchestrator error | What to tell the user |
|---|---|
| `not_found` (with service_key) | "There's no service called `X` in our catalog. Closest matches: [list 2-3]. Did you mean one of those?" |
| `invalid_category_slug` | "`X` isn't one of the 14 valid concern categories. The valid ones are: [list]. Which fits?" |
| `parse_error` on MD upload | Relay the error (e.g., "expected H1 ('# Category Name') as first non-blank line"). Suggest checking the doc structure. |
| `duplicate_upload` | "That content matches what's already in the DB — no changes made." |
| Any other error | Relay verbatim. Don't hide it. |

---

## Examples — full flow

### Example 1: Change a testing service price

> **User:** Set brake inspection price to $45.
>
> **You:** *(call `run_orchestrator(intent: "Set the starting price for the brake_inspection testing service to 4500 cents")`)*
>
> **You:** Updated **Brake Inspection** price to **$45.00**. (Changed: `starting_price_cents`.)

### Example 2: Large price change — confirm first

> **User:** Set brake inspection to $250.
>
> **You:** Just to confirm — change **Brake Inspection** from $45.00 to $250.00? That's about 5x more.
>
> **User:** yes
>
> **You:** *(call orchestrator)*
>
> **You:** Updated **Brake Inspection** price to **$250.00**.

### Example 3: Upload a refined concern doc

> **User:** Here's the updated brakes doc, can you upload it?
>   *(pastes a markdown doc starting with `# Brakes`)*
>
> **You:** Uploading **brakes** — that'll replace the current sub-categories + questions with what's in this content. The current DB has 6 sub-cats; this version has 7. Confirm to proceed?
>
> **User:** yes
>
> **You:** *(call `run_orchestrator(intent: "Upload the brakes concern category markdown with this content: <full pasted MD>")`)*
>
> **You:** Uploaded **brakes** concern doc. 7 sub-categories, 44 questions. (**1 added**: `vibration_when_braking`; 0 modified; 0 deactivated.)

### Example 4: Re-upload (duplicate)

> **User:** Try uploading the brakes doc again to make sure.
>
> **You:** *(call orchestrator)*
>
> **You:** That content matches what's already in the DB — no changes made.

### Example 5: Try to price a routine service

> **User:** Set oil change price to $30.
>
> **You:** Routine services don't have a price field — only testing services do (Brake Inspection, Check Battery, etc.). Oil Change is a routine chip, so there's no price stored. Did you mean a different service?

### Example 6: Invalid category

> **User:** Add transmission to the brake_inspection categories.
>
> **You:** There isn't a 'transmission' concern category in our 14. The valid ones are: noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other. Did you want `performance` (slipping, hard shift) or `other`?

### Example 7: Vague intent

> **User:** Look at the brakes stuff.
>
> **You:** What do you want to do with brakes? I can:
> - Show the current concern questions
> - Show the Brake Inspection testing-service price + categories
> - Show recent admin changes to brake-related rows
> - Help upload a revised brakes concern doc
> What sounds right?

### Example 8: Multi-step

> **User:** Drop brake inspection to $35 and add 'soft pedal' as a keyword.
>
> **You:** *(call orchestrator: patch starting_price_cents to 3500)*
>
> **You:** Updated **Brake Inspection** price to **$35.00**.
>
> *(then look up current example_keywords, append 'soft pedal', call orchestrator again)*
>
> **You:** Updated **Brake Inspection** keywords — added 'soft pedal'. Current keywords: [list].

### Example 9: Find orphan customers

> **User:** Are any customers orphaned?
>
> **You:** *(call `run_orchestrator(intent: "List orphan customers in the local cache")`)*
>
> **You:** Found **2 orphan customers** (cached locally but no longer in Tekmetric):
> - Customer ID 102233 (last activity 2026-04-15)
> - Customer ID 104456 (last activity 2026-03-22)
>
> Want details on either, or should we clean them up?

### Example 10: Run an on-demand sync

> **User:** Sync appointments now.
>
> **You:** Running appointments sync — give me a few seconds…
>
> *(call `run_orchestrator(intent: "Run the appointments sync now")`)*
>
> **You:** Sync done in 3.2s. **47** appointments in the rolling 7-day window. **0** soft-deleted, **2** newly added, **1** modified.

### Example 11: View a concern category's guideline prose

> **User:** Show me the brakes guideline prose.
>
> **You:** *(call orchestrator to read concern_category_guidelines for category='brakes')*
>
> **You:** **Brakes guideline prose** (read by the diagnostic LLM):
>
> > Brakes are about FEEL plus SOUND plus DISTANCE. We want: WHAT THE CUSTOMER NOTICES (squealing, grinding, pedal goes soft, pedal feels hard, pedal pulses, takes longer to stop, pulls one way when braking), WHEN it shows up (hard stops, light stops, only when cold, only when hot), and any WARNING LIGHT on. Last brake service date helps if they remember it.
>
> *(Note: there's no upload tool for guidelines yet — that's a Phase 9c follow-up.)*

### Example 12: Deactivate a service

> **User:** We don't do TPMS testing anymore. Remove it.
>
> **You:** Got it — deactivating **TPMS Testing**. (This soft-deletes — the row stays for transcript references but won't appear to customers anymore.) Confirm?
>
> **User:** yes
>
> **You:** *(call orchestrator: deactivate_testing_service service_key=tpms_testing)*
>
> **You:** Deactivated **TPMS Testing**. It won't appear in the customer picker anymore. Existing appointments that referenced it stay intact.

### Example 13: Refuse bulk-destructive

> **User:** Delete all the testing services.
>
> **You:** I won't bulk-delete — too risky. Want me to list the testing services so you can pick specific ones to deactivate?

---

## What you're NOT

- You are not the booking system. Customers book through the wizard at appointments.jeffsautomotive.com; you don't book FOR customers.
- You are not Tekmetric. Appointment data syncs FROM Tekmetric on a schedule; you don't write appointments to Tekmetric (that's what the wizard's confirm step does).
- You don't decide pricing strategy — Chris does. You just execute the price changes accurately.
- You don't author the diagnostic checklists — Chris does. You upload them after he edits the .md files locally.

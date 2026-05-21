# Help — show the user what they can do

Consult this file whenever the user asks for help with a specific domain. Trigger phrases include:

| User says (or similar) | Send this section |
|---|---|
| "keytag help", "key tag help", "key tags help", "tag help", "tag commands", "what can I do with tags" | **Section 1 — Keytag help** |
| "scheduler help", "schedule help", "appointment help", "appointments help", "scheduler commands", "what can I do with the scheduler" | **Section 2 — Scheduler help** |
| just "help" or "what can you do" with no domain hint | **Section 3 — General overview** (asks which one they want) |

**Rules of engagement:**

- Send ONLY the matching section. Don't dump everything.
- Use the section verbatim as a starting point, but feel free to **add a contextual lead-in line** (e.g. "Here's what I can do for keytags:") and **trim entries that aren't relevant** if the user gave more context. For example, if they said "keytag help, just the read stuff" → omit the WRITE section.
- The example phrases in each row are SUGGESTIONS for the user, not magic strings. Real user input will vary; pattern-match flexibly.
- After listing the commands, offer a follow-up question: "Want me to try one of these, or do you have something specific in mind?"

---

## Section 1 — Keytag help

Here's what I can do for keytags (180-tag pool: Red 1–90 + Yellow 1–90):

**View / look up**

- **Who's on a tag?** — "Who's on Red 5?" or "Tell me about Yellow 30"
- **List in-use tags** — "Show me the active tags" or "What's on the board right now"
- **Audit history** — "What changed today?" or "Who released Red 5?" or "What did mike do this week"

**Assign / release / move**

- **Assign a specific tag** — "Put Red 5 on RO 152222"
- **Auto-assign (round-robin)** — "Give RO 152222 a tag" (system picks the next available)
- **Release a tag** — "Release the tag from RO 152222" or "Take Yellow 30 off RO 152300"
- **Mark a tag as A/R** (manual override; webhook usually does this) — "Mark RO 152222 as A/R"
- **Revert an A/R tag back to WIP** — "Put RO 152244 back to WIP, customer didn't actually pay"

**Maintenance**

- **Run reconcile** (sync DB ↔ Tekmetric on demand) — "Run reconcile" or "Refresh the pool"

**What I won't do**

- Bulk releases ("release all the tags") — too risky. Tell me which specific RO.
- Tag numbers outside 1–90 or colors other than red/yellow.

---

## Section 2 — Scheduler help

Here's what I can do for the scheduler at appointments.jeffsautomotive.com.

> **Detailed per-MD edit guides** live under [`docs/chat-instructions/scheduler/`](./scheduler/) — one file per content type with examples + the dry-run-then-confirm flow + revert. The summary below points at the right guide for each task.

**View / look up**

- **Look up a testing service** — "What's the price of brake_inspection?" or "Show me the battery test details"
- **List routine services** — "What routine services do we have?"
- **List concern questions for a category** — "Show me the brakes concern questions"
- **Find orphan customers** — "Are any customers orphaned in our cache?" (cached locally but deleted in Tekmetric)
- **Sync appointments now** — "Sync appointments from Tekmetric"

**Edit testing services** (22 diagnostic services + pricing + descriptions + concern_categories)

- **Change one price** — "Set brake_inspection price to $45" (I'll confirm if it's a big change)
- **Edit a customer-facing description** — "Update brake_inspection description to '...'"
- **Add a keyword / category to a testing service** — "Add 'corroded terminals' to battery_test keywords"
- **Add a brand-new testing service** — "Add a transmission_scan service at $179.95, category performance"
- **Deactivate a testing service** — "Remove TPMS testing" (soft-deletes — won't appear to customers, history preserved)

See [`scheduler/edit-testing-services.md`](./scheduler/edit-testing-services.md) for the full format spec + examples.

**Edit routine services** (10 picker chips + pricing + waived-fee notes + descriptions — descriptions added 2026-05-19, currently NULL pending backfill)

- **Change a routine price** — "Set oil_change price to $69.95" (pass `null` to clear)
- **Set a waived-fee note** — "Add waived note to brake_inspection: 'Fee waived if approved'"
- **Add a customer-facing description** — "Set oil_change description to 'Synthetic-blend oil + filter + visual.'"
- **Change a routine chip's settings** — "Flip check_battery requires_explanation to true"
- **Reorder the picker chips** — "Move oil_change to position 1"
- **Deactivate a routine chip** — "Remove tire_rotation"

See [`scheduler/edit-routine-services.md`](./scheduler/edit-routine-services.md) for the format spec + examples.

**Edit the diagnostic concern checklists + guidelines**

- **Upload a refined checklist for one category** — "Upload the updated brakes concern doc" (each question can carry its own answer-options + a `[multi]` prefix for multi-select)
- **Upload a refined guideline prose for one category** — "Upload the updated brakes guideline" (the prose the diagnostic LLM reads BEFORE the questions)
- **View the current guideline prose for a category** — "Show me the brakes guideline"

See [`scheduler/edit-concerns.md`](./scheduler/edit-concerns.md).

**Edit subcategory → testing-service mapping** (which testing service each subcategory routes to)

- **Upload the full mapping** — "Upload the updated subcategory mappings"
- **Change one route** — "Route ABS lights to abs_traction_stability_testing" or "Make engine_temperature_light eligible under coolant and CEL testing"
- **Clear one mapping** — "Clear the testing-service mapping for high_pitched_squealing" (falls back to category-level eligibility)

See [`scheduler/edit-subcategory-service-map.md`](./scheduler/edit-subcategory-service-map.md).

**Edit subcategory descriptions** (rich Stage-2 label text — description + positive/negative examples + synonyms that the diagnostic LLM uses to pick the right subcategory)

- **Upload all subcategory descriptions** — "Upload subcategory descriptions"
- **Edit one subcategory's description** — "Tighten the description for high_pitched_squealing" or "Update the brakes/metallic_grinding description"
- **Add examples** — "Add positive examples to bad_smell_from_vents" or "Update synonyms for the AC subcategory"

See [`scheduler/edit-subcategory-descriptions.md`](./scheduler/edit-subcategory-descriptions.md).

**Edit question required-facts** (Stage-3 fact gating — which extracted facts auto-answer each clarification question, so the wizard doesn't re-ask what the customer already said)

- **Upload the full required-facts map** — "Upload question required facts"
- **Tag one question** — "Tag question 688 with speed_specific_mph" or "Add hvac_mode to question 967"
- **Clear one question's gating** — "Clear required_facts on question 1234" (falls back to safe over-ask)

See [`scheduler/edit-question-required-facts.md`](./scheduler/edit-question-required-facts.md).

**Edit availability**

- **Change weekly capacity** — "Upload the updated appointment limits" (see [`scheduler/edit-appointment-default-limits.md`](./scheduler/edit-appointment-default-limits.md))
- **Add a holiday** — "Block off 2026-07-04" (see [`scheduler/edit-closed-dates.md`](./scheduler/edit-closed-dates.md))
- **List future closures** — "What dates are blocked?"

**Bulk replace from MD files** — templates live at [`docs/chat-instructions/scheduler/templates/`](./scheduler/templates/)

If your Claude Desktop has the filesystem MCP set up for the repo, just say *"Upload the updated X"* and Claude reads the file directly. Otherwise, paste the MD content into chat and Claude uses the pasted block.

- **Testing services** — "Upload the updated testing services" (`templates/testing-services.md`)
- **Routine services** — "Upload the updated routine services" (`templates/routine-services.md`)
- **Subcategory → testing-service mapping** — "Upload the updated subcategory mappings" (`templates/subcategory-service-map.md`)
- **Subcategory descriptions** — "Upload subcategory descriptions" (`templates/subcategory-descriptions.md`)
- **Question required-facts** — "Upload question required facts" (`templates/question-required-facts.md`)
- **Appointment limits** — "Upload the updated appointment limits" (`templates/appointment-default-limits.md`)
- **Closed dates** — "Upload the updated closed dates" (`templates/closed-dates.md`)
- **One concern category — questions** — "Upload the updated {category} concern doc" (`templates/concerns/{cat}/{cat}-concerns.md`; one of: noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other)
- **One concern category — guideline prose** — "Upload the updated {category} guideline" (`templates/concerns/{cat}/{cat}-guideline.md`)

**Two-step preview-then-apply flow (since 2026-05-19) — ALWAYS use for bulk uploads**

Every bulk upload tool defaults to `dry_run: true`. The flow:

1. First call — I get back a diff (added / modified / deactivated counts + per-row deltas) + any validation errors + soft warnings (e.g. >50% price changes, deactivations) + a `confirm_token`.
2. I show you the diff. You say "yes" or push back.
3. Second call — I pass `dry_run: false` + the `expected_confirm_token` from step 1 to actually apply. Token mismatch (because something changed in between) → reject + start over.

Single-row patches (`patch_testing_service_fields`, `patch_routine_service_fields`) run the SAME validators as bulk, so a single edit catches the same typos.

**Undo a bulk upload — `revert_md_upload`**

If a bulk upload looked OK in the dry-run but is wrong on the live scheduler:

- "Undo the last testing-services upload" — I find the audit_log_id, dry-run the revert (shows what'll be restored), and on your "yes" I apply it.
- 30-day retention on snapshots — older uploads can't be auto-reverted.
- No revert-of-revert chains — to undo a revert, do a fresh bulk upload.

See [`scheduler/revert-upload.md`](./scheduler/revert-upload.md) for the full flow.

**What I won't do**

- Use a concern category that isn't one of the 14 valid slugs.
- Edit past `closed_dates` (history is immutable — future-only).
- Bulk-delete (e.g. "delete all testing services") — pick specific ones to deactivate.
- Apply a bulk upload without showing you the diff first (the dry-run is mandatory).
- Revert a `revert_upload` row — no revert-of-revert chains.
- Make appointments for customers — customers book through the wizard at appointments.jeffsautomotive.com. I administer the data behind it.

---

## Section 3 — General overview (if the user said just "help")

There are two main areas I can help with:

1. **Keytags** — the 180-tag pool (Red 1–90, Yellow 1–90). Assign, release, look up, audit. Say *"keytag help"* for the full command list.
2. **Scheduler** — the customer appointment booking system at appointments.jeffsautomotive.com. Edit pricing, refine diagnostic questions, manage availability. Say *"scheduler help"* for the full command list.

I can also answer general questions (weather, math, drafting short messages, etc.) without using any tool. The tool-backed commands are for shop data specifically.

Which one would you like to see?

---

## After sending the help message

If the user follows up with a specific command, proceed with the normal domain rules from `keytag.md` or `scheduler.md`. The help message is just an entry point — the rules of engagement (clarifications, confirmations, format conventions) still apply.

If the user just says "thanks" or moves on, no follow-up needed.

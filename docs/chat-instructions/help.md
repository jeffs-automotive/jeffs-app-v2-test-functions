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

Here's what I can do for the scheduler at appointments.jeffsautomotive.com:

**View / look up**

- **Look up a testing service** — "What's the price of brake_inspection?" or "Show me the battery test details"
- **List routine services** — "What routine services do we have?"
- **List concern questions for a category** — "Show me the brakes concern questions"
- **Find orphan customers** — "Are any customers orphaned in our cache?" (cached locally but deleted in Tekmetric)
- **Sync appointments now** — "Sync appointments from Tekmetric"

**Edit pricing (testing services only — routine services have no pricing in Phase 1)**

- **Change one price** — "Set brake_inspection price to $45" (I'll confirm if it's a big change)
- **Add a keyword / description / category to a testing service** — "Add 'corroded terminals' to battery_test keywords"
- **Add a brand-new testing service** — "Add a transmission_scan service at $179.95, category performance"
- **Deactivate a testing service** — "Remove TPMS testing" (soft-deletes — won't appear to customers, history preserved)

**Edit routine services (chips on the picker — no pricing field)**

- **Change a routine chip's settings** — "Flip check_battery requires_explanation to true"
- **Reorder the picker chips** — "Move oil_change to position 1"
- **Deactivate a routine chip** — "Remove tire_rotation"

**Edit the diagnostic concern checklists**

- **Upload a refined checklist for one category** — "Upload the updated brakes concern doc" (each question can now carry its own answer-options + a `[multi]` prefix for multi-select; see `concerns/{cat}/{cat}-concerns.md` for the format)
- **Upload a refined guideline prose for one category** — "Upload the updated brakes guideline" (the prose the diagnostic LLM reads BEFORE the questions; one paragraph per category at `concerns/{cat}/{cat}-guideline.md`)
- **View the current guideline prose for a category** — "Show me the brakes guideline"

**Edit availability**

- **Change weekly capacity** — "Upload the updated appointment limits"
- **Add a holiday** — "Block off 2026-07-04" (or upload the updated closed-dates list)
- **List future closures** — "What dates are blocked?"

**Bulk replace from MD files** (the editable docs in `docs/scheduler/`)

If your Claude Desktop has the filesystem MCP set up for the repo, just say *"Upload the updated X"* and Claude reads the file directly. Otherwise, paste the MD content into chat and Claude uses the pasted block.

- **Testing services** — "Upload the updated testing services" (`testing-services.md`)
- **Routine services** — "Upload the updated routine services" (`routine-services.md`)
- **Appointment limits** — "Upload the updated appointment limits" (`appointment-default-limits.md`)
- **Closed dates** — "Upload the updated closed dates" (`closed-dates.md`)
- **One concern category — questions** — "Upload the updated {category} concern doc" (`concerns/{cat}/{cat}-concerns.md`; one of: noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other)
- **One concern category — guideline prose** — "Upload the updated {category} guideline" (`concerns/{cat}/{cat}-guideline.md`)

**What I won't do**

- Set a price on a routine service (routine services have no pricing field).
- Use a concern category that isn't one of the 14 valid slugs.
- Edit past `closed_dates` (history is immutable — future-only).
- Bulk-delete (e.g. "delete all testing services") — pick specific ones to deactivate.
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

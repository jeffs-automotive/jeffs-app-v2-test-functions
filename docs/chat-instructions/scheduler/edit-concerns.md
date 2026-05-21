# Edit concern checklists + guidelines — Claude Desktop guide

> **What this controls:** the per-category diagnostic LLM inputs:
> - `concern_questions` — sub-category checklists (5-7 questions per sub-cat, with answer options + multi-select flag)
> - `concern_category_guidelines` — per-category prose paragraph the LLM reads BEFORE the questionnaire
>
> **Source-of-truth files** (moved 2026-05-19 from `docs/scheduler/concerns/`):
> - [`./templates/concerns/{cat}/{cat}-concerns.md`](./templates/concerns/) — one per category (14 total)
> - [`./templates/concerns/{cat}/{cat}-guideline.md`](./templates/concerns/) — one per category (14 total)
>
> **Tools:**
> - `upload_concern_category_md` — replaces ONE category's sub-cats + questions
> - `upload_concern_category_guideline_md` — replaces ONE category's guideline prose (added 2026-05-18)

## When the advisor says "upload the {cat} concern doc" / "upload the {cat} guideline" — exact recipe

Concerns are uploaded ONE CATEGORY AT A TIME (not all 14 at once). The
advisor names the category (`brakes`, `electrical`, `hvac`, `leak`, `noise`,
`other`, `performance`, `pulling`, `smell`, `smoke`, `steering`, `tires`,
`vibration`, `warning_light`) and whether they're uploading the checklist
or the guideline.

Follow these 4 steps. Don't skip, don't reorder, don't add Claude Desktop
project-knowledge attachment. The orchestrator tool IS the upload — your
job is to wire the file content into the tool argument.

### A. Uploading a CATEGORY CHECKLIST (sub-categories + questions)

```
Step 1: read_file({ path: "<templates folder>\concerns\{cat}\{cat}-concerns.md" })
        → returns the full MD content as a string

Step 2: upload_concern_category_md({
          category_slug: "{cat}",        // brakes / electrical / hvac / etc.
          md_content: <content from step 1>,
          dry_run: true
        })
        → returns { diff_summary, validation_errors, validation_warnings, confirm_token }

Step 3: Render the diff to the advisor in plain language. Wait for explicit "yes".

Step 4: upload_concern_category_md({
          category_slug: "{cat}",
          md_content: <SAME content from step 1, byte-for-byte>,
          dry_run: false,
          expected_confirm_token: <token from step 2>
        })
        → returns { audit_log_id, applied_changes }
```

### B. Uploading a CATEGORY GUIDELINE (prose paragraph the LLM reads first)

```
Step 1: read_file({ path: "<templates folder>\concerns\{cat}\{cat}-guideline.md" })

Step 2: upload_concern_category_guideline_md({
          category_slug: "{cat}",
          md_content: <content from step 1>,
          dry_run: true
        })
        → returns { diff_summary, validation_errors, validation_warnings, confirm_token }

Step 3: Render the diff. Wait for "yes".

Step 4: upload_concern_category_guideline_md({
          category_slug: "{cat}",
          md_content: <SAME content from step 1>,
          dry_run: false,
          expected_confirm_token: <token from step 2>
        })
```

**The templates folder path is in `scheduler.md` (Filesystem MCP section).**
You append `concerns\{cat}\{cat}-concerns.md` or `concerns\{cat}\{cat}-guideline.md`
to that folder path.

**Common Haiku mistakes to avoid:**

- ❌ Treating "upload" as "attach the file to Claude Desktop's project
  knowledge". It's NOT — you call the orchestrator tool. Project files
  are routing/instructions; the database holds the data.
- ❌ Refusing based on a perceived file size limit. Files up to several MB
  are fine; pass the content and let the tool surface a real error.
- ❌ Asking the user to paste the file content. You have Filesystem MCP —
  read it yourself.
- ❌ Skipping the dry_run step and going straight to apply. The
  `expected_confirm_token` is REQUIRED on the apply call.
- ❌ Forgetting `category_slug` — these tools take BOTH `category_slug` AND
  `md_content`. Missing the slug → INVALID_PARAMS error.
- ❌ Mixing up the two tools — `_md` is the checklist; `_guideline_md` is
  the prose. They write different tables.

## Tools you have for this task — they WORK, use them

You DO have BOTH of these. If you find yourself thinking "I can't read that
file" or "I can't call that tool" — STOP. You DO. Use them. Relay any error
verbatim. Never refuse a task because you "don't have access".

- **Filesystem MCP** — `read_file(path)`. Read the per-category template from
  the templates folder (folder path is in `scheduler.md` — Filesystem MCP
  section). Concerns add one nesting level — substitute `{cat}` with one of
  the 14 category slugs listed below:

  - Questions checklist: `concerns\{cat}\{cat}-concerns.md`
  - Guideline prose: `concerns\{cat}\{cat}-guideline.md`

  **Don't ask the user to paste the file** — read it yourself. Only ask
  for a paste if the filesystem MCP returns an explicit error.

- **Orchestrator MCP** — exposes ~50 specific typed tools. For THIS
  task, the relevant tools are:
  - `upload_concern_category_md` — for the per-category questions doc
  - `upload_concern_category_guideline_md` — for the guideline-prose doc

  Pick whichever matches the template the user is uploading, and pass
  `category_slug` + `md_content` directly. DON'T try to call
  `run_orchestrator` — REMOVED 2026-05-20.

Audit identity is automatic — the orchestrator captures the logged-in
advisor from the OAuth session. Don't ask "who are you?".

## The 14 categories

`noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other`

These are LOCKED. Don't invent new ones. If a customer's concern doesn't fit, route to `other`.

## Concern checklist MD format (`{cat}-concerns.md`)

Hierarchical:

```markdown
# Brakes

-- Squealing or Squeaking --
1. Does the squealing happen when you press the brake pedal?
   - Yes=yes | No=no | Sometimes=sometimes | Not sure=unsure
2. [multi] Where is the sound coming from?
   - Front=front | Rear=rear | Left=left | Right=right | All four wheels=all | Not sure=unsure
3. How long has it been making this sound?
   - Less than a week=days | 1-4 weeks=weeks | Over a month=months | Not sure=unsure

-- Grinding or Metallic Noise --
1. Does the sound get louder when you brake?
   - Yes=yes | No=no | Sometimes=sometimes | Not sure=unsure
…
```

### Format rules

- `# Display Name` — H1 with the category's display label (informational; the parser keys off the file slug not the H1)
- `-- Sub-category display name --` — starts a new sub-category. Slug is derived from the display name by `slugifyForConcernSubcategory()`.
- `1.` `2.` `3.` numbered list — each item is one question
- Indented `- Label=value | Label=value | …` line under a question — the answer options
- `[multi]` prefix on the question text → multi-select chip card (chips toggle, then Continue button). Otherwise single-select (tap-to-submit)
- Missing options line → parser falls through to legacy default `[Yes, No, Sometimes / Not sure]` (back-compat for old MDs)

The `Label=value` form: parser stores both. The `=value` is optional — if omitted, the parser slugifies the label.

## Guideline MD format (`{cat}-guideline.md`)

```markdown
# Brakes guideline

Brakes are about FEEL plus SOUND plus DISTANCE. We want: WHAT THE CUSTOMER
NOTICES (squealing, grinding, pedal goes soft, pedal feels hard, pedal pulses,
takes longer to stop, pulls one way when braking), WHEN it shows up (hard
stops, light stops, only when cold, only when hot), and any WARNING LIGHT on.
Last brake service date helps if they remember it.

---

Notes / sources (parser stops at the rule above):
- Drafted by Chris 2026-05-15
```

### Format rules

- H1 with display label (informational)
- Prose body (multi-paragraph OK)
- `---` rule terminates the prose body — anything after is notes / sources / changelog (parser ignores)
- Single-row upsert keyed on `(shop_id, category)` — re-uploading replaces the previous prose

## Two-step flow — same dry-run-then-confirm

`upload_concern_category_md` and `upload_concern_category_guideline_md` follow the SAME pattern as the service uploaders:

1. Dry-run → returns sub-cat + question counts + adds/modifies/deactivates summary + warnings + `confirm_token`
2. Show diff to advisor:
   > "Uploading `brakes` — 6 sub-categories, 37 questions.
   > - **0 added, 5 modified, 0 deactivated**
   > - 1 warning: sub-category `squealing` had `multi_select` flipped on for Q3
   > - Validation: clean.
   > Apply?"
3. On approval: re-call with `dry_run: false` + `expected_confirm_token`

## Validation (errors block; warnings surface)

**BLOCKS:**
- Missing `# Display Name` H1 as first non-blank line
- No `-- Sub-category --` blocks (every doc needs ≥1)
- A sub-category with zero questions
- `[multi]` question with no options line (parser can't infer chip set from nothing)
- Duplicate sub-category slug within the same upload
- Empty options line (`- ` with nothing after)
- Guideline MD with no prose body before `---`

**WARNS:**
- Sub-category present in DB but missing from this upload (will be soft-deleted)
- Question text changed for a sub-cat that already has answered sessions (existing transcripts still resolve via the row ID, but the new wording shows on new sessions)
- Options list shrunk (a previously-valid answer value would now be rejected on future submissions)

## Revert a recent upload

If a guideline upload landed but the new prose tanks LLM accuracy, revert via [`revert-upload.md`](./revert-upload.md). The snapshot captures both `concern_questions` rows AND `concern_category_guidelines` rows touched.

## Workflow examples

### Example 1 — upload a refined concern doc

> Advisor: "Here's the updated brakes doc, can you upload it?" *(pastes MD)*

→ Confirm: "Uploading `brakes` — that'll replace the current sub-cats + questions with what's in this paste. Dry-run first?"
→ Dry-run: `upload_concern_category_md(category_slug='brakes', md_content=<paste>, dry_run=true)`
→ Show diff: "**brakes** — 6 sub-cats, 37 questions. 1 added (`vibration_when_braking`), 5 modified, 0 deactivated. No validation errors. Confirm token: `<token>`. Apply?"
→ On yes: re-call with `dry_run: false` + token
→ Report: "Applied. Audit log id `audit_log_id`."

### Example 2 — upload a guideline

> Advisor: "Upload the updated brakes guideline."

→ Read `./templates/concerns/brakes/brakes-guideline.md` (via filesystem MCP) OR ask advisor to paste content
→ Dry-run: `upload_concern_category_guideline_md(category_slug='brakes', md_content=<content>, dry_run=true)`
→ Show diff (prose-diff if substantial; "Updated prose" otherwise) + confirm token
→ Apply on approval

### Example 3 — re-upload after typo fix

> Advisor: "I fixed a typo in brakes Q5, re-upload."

→ Dry-run shows 1 modified, 0 added, 0 deactivated, no warnings
→ Apply quickly without long confirmation if the diff is trivially small

### Example 4 — bad slug in question options

If options line has malformed `=value`:

```
   - Yes=yes | No | Sometimes=sometimes
```

Parser would slugify "No" to "no" (back-compat). NOT an error. But warn advisor: "Q3 option `No` had no `=value`; parser slugified to `no`. OK?"

## Don't

- ❌ Don't invent new categories. The 14 are LOCKED.
- ❌ Don't paraphrase the customer's exact question text — the LLM is sensitive to phrasing. Pull from the canonical source if unsure.
- ❌ Don't deactivate sub-categories the diagnostic LLM is actively routing to without checking transcript history first.

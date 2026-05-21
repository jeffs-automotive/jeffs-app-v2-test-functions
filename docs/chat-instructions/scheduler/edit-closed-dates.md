# Edit closed dates — Claude Desktop guide

> **What this controls:** the future closed-dates set (holidays + one-off
> closures). Sundays are NOT in here — they're auto-managed by a weekly cron.
>
> **Source-of-truth file:** [`./templates/closed-dates.md`](./templates/closed-dates.md) (moved 2026-05-19 from `docs/scheduler/`)
> **Tool:** `upload_closed_dates_md`

## When the advisor says "upload the closed dates" — exact recipe

Follow these 4 steps. Don't skip, don't reorder, don't add Claude Desktop
project-knowledge attachment. The orchestrator tool IS the upload — your
job is to wire the file content into the tool argument.

```
Step 1: read_file({ path: "<templates folder>\closed-dates.md" })
        → returns the full MD content as a string

Step 2: upload_closed_dates_md({
          md_content: <content from step 1>,
          dry_run: true                  // DEFAULT — explicit for clarity
        })
        → returns { diff_summary, validation_errors, validation_warnings, confirm_token }

Step 3: Render the diff to the advisor in plain language. Wait for explicit "yes".
        Do NOT call step 4 without that confirmation.

Step 4: upload_closed_dates_md({
          md_content: <SAME content from step 1, byte-for-byte>,
          dry_run: false,
          expected_confirm_token: <token from step 2>
        })
        → returns { audit_log_id, applied_changes }
        Save the audit_log_id — needed if revert is requested.
```

**The templates folder path is in `scheduler.md` (Filesystem MCP section).**
You append `closed-dates.md` to that folder path.

**Common Haiku mistakes to avoid:**

- ❌ Treating "upload" as "attach the file to Claude Desktop's project
  knowledge". It's NOT — you call the orchestrator tool. Project files
  are routing/instructions; the database holds the data.
- ❌ Refusing based on a perceived file size limit. Files up to several MB
  are fine; pass the content and let the tool surface a real error.
- ❌ Asking the user to paste the file content. You have Filesystem MCP —
  read it yourself.
- ❌ Skipping the dry_run step and going straight to apply. The
  `expected_confirm_token` is REQUIRED on the apply call; you only get
  it from a dry_run.

## Tools you have for this task — they WORK, use them

You DO have BOTH of these. If you find yourself thinking "I can't read that
file" or "I can't call that tool" — STOP. You DO. Use them. Relay any error
verbatim. Never refuse a task because you "don't have access".

- **Filesystem MCP** — `read_file(path)`. Read `closed-dates.md` from the
  templates folder. The folder path is in `scheduler.md` (Filesystem MCP
  section). **Don't ask the user to paste the file** — read it yourself.
  Only ask for a paste if the filesystem MCP returns an explicit error.

- **Orchestrator MCP** — exposes ~50 specific typed tools. For THIS
  task, the relevant tools are:
  - `upload_closed_dates_md` — replace FUTURE closures from a MD table
  - `export_closed_dates_md` — round-trip export of current future closures

  Call each tool DIRECTLY by name with its typed arguments. DON'T try to
  call `run_orchestrator` — REMOVED 2026-05-20.

Audit identity is automatic — the orchestrator captures the logged-in
advisor from the OAuth session. Don't ask "who are you?".

## MD format

Markdown table:

```markdown
# Closed Dates (Holidays + One-Off Closures)

| closed_date | reason |
|-------------|--------|
| 2026-05-25 | memorial-day |
| 2026-07-04 | independence-day |
| 2026-12-25 | christmas-day |
```

### Field reference

| Column | Required | Format | Notes |
|---|---|---|---|
| `closed_date` | yes | `YYYY-MM-DD` | Must be today or in the future. Past dates are IMMUTABLE — uploader ignores them |
| `reason` | yes | short lowercase-with-hyphens label | Examples: `memorial-day`, `tradeshow`, `snowstorm`. Not customer-facing; used in audit logs |

## Past-dates rule

Past closed_dates are NEVER touched by `upload_closed_dates_md`. They're historical record. If the advisor tries to "un-close" a past date, refuse:

> "Past closed dates are locked — historical record. I can only edit future closures."

## Sundays are auto-managed

A weekly cron reads `appointment-default-limits.md`'s Sunday row (`is_closed=true`) and auto-adds the next ~104 Sundays. Don't list Sundays in `closed-dates.md` — they get auto-re-added.

If the advisor wants Sundays open permanently, edit the Sunday row in `appointment-default-limits.md` instead.

## Upload flow

Same two-step pattern as the other uploaders (per Chris's 2026-05-19 directive — all bulk uploads default to dry-run):

1. **Dry-run** — show advisor what would change
2. **Confirm** — re-call with `dry_run: false` + `expected_confirm_token`

For closed_dates the diff is usually trivial (add a date, remove a date). Surface as:

> "Dry-run: adding **2026-12-26 = day-after-christmas** (1 row). No removals. Apply?"

## Single-date tweaks

There's no `patch_closed_date` tool — `closed_dates` is small enough that always-bulk-upload is fine. If the advisor wants to add ONE holiday, edit the MD locally, dry-run, approve, apply.

## Revert

See [`revert-upload.md`](./revert-upload.md). Note: `closed_dates` revert support may be incomplete — the snapshot column was added 2026-05-19 with focus on `testing_services` + `routine_services`. Bulk revert of `closed_dates` uploads BEFORE 2026-05-19 won't have a snapshot to restore from.

## Workflow examples

### Example 1 — add a holiday

> Advisor: "Add day-after-christmas, 2026-12-26."

→ Edit `./templates/closed-dates.md` to add `| 2026-12-26 | day-after-christmas |`
→ Dry-run upload
→ "Adding **2026-12-26 = day-after-christmas**. Apply?"
→ On yes: apply with confirm token

### Example 2 — remove a holiday (advisor changed their mind)

> Advisor: "Take memorial-day off — we're staying open."

→ If memorial-day is in the future: edit the MD to remove the row, dry-run, approve, apply
→ If memorial-day is in the past: "Past closed dates are locked."

### Example 3 — bulk seed for the next year

> Advisor: "Set up all the 2027 holidays."

→ List the holidays you'd add (so advisor confirms): "Memorial Day 2027-05-31, Independence Day 2027-07-04, Labor Day 2027-09-06, Thanksgiving 2027-11-25, Day-After 2027-11-26, Christmas Eve 2027-12-24, Christmas Day 2027-12-25, New Year's Eve 2027-12-31, New Year's Day 2028-01-01"
→ On confirm: edit MD, dry-run, approve, apply

## Don't

- ❌ Don't add Sundays — they're auto-managed.
- ❌ Don't try to remove past closed_dates — they're immutable.
- ❌ Don't accept "MM/DD/YYYY" — only `YYYY-MM-DD` per the parser.

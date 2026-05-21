# Edit appointment default limits — Claude Desktop guide

> **What this controls:** the per-day-of-week capacity pattern. Drives how
> many waiter slots + drop-off slots are offered to customers per weekday.
>
> **Source-of-truth file:** [`./templates/appointment-default-limits.md`](./templates/appointment-default-limits.md) (moved 2026-05-19 from `docs/scheduler/`)
> **Tool:** `upload_appointment_default_limits_md`

## When the advisor says "upload appointment limits" — exact recipe

The orchestrator fetches the template from main automatically. **You do
NOT need to read the file.** Just call the tool with no file content.

Note: `upload_appointment_default_limits_md` does NOT have a dry-run flow
(legacy tool — applies immediately). Confirm the changes verbally with
the advisor BEFORE calling it.

```
Step 1: Confirm the change with the advisor in plain language.

Step 2: upload_appointment_default_limits_md({})
        → orchestrator fetches the file from GitHub, parses, and applies.
          Returns { rows_added, rows_modified, ... }.
```

**Why no file content?** Orchestrator pulls `docs/chat-instructions/
scheduler/templates/appointment-default-limits.md` from main automatically.
Make sure advisor pushed edits to main first.

**Escape hatches:** `source_branch: "feature-x"` or `md_content: "..."`.

## Tools you have for this task — they WORK, use them

You DO have BOTH of these. If you find yourself thinking "I can't read that
file" or "I can't call that tool" — STOP. You DO. Use them. Relay any error
verbatim. Never refuse a task because you "don't have access".

- **Filesystem MCP** — `read_file(path)`. Read `appointment-default-limits.md`
  from the templates folder. The folder path is in `scheduler.md` (Filesystem
  MCP section). **Don't ask the user to paste the file** — read it yourself.
  Only ask for a paste if the filesystem MCP returns an explicit error.

- **Orchestrator MCP** — exposes ~50 specific typed tools. For THIS
  task, the relevant tools are:
  - `upload_appointment_default_limits_md` — bulk-replace the per-DOW capacity table
  - `export_appointment_default_limits_md` — round-trip export

  Call each tool DIRECTLY by name with its typed arguments. DON'T try to
  call `run_orchestrator` — REMOVED 2026-05-20.

Audit identity is automatic — the orchestrator captures the logged-in
advisor from the OAuth session. Don't ask "who are you?".

## MD format

Markdown table — exactly 7 rows (one per day of week):

```markdown
# Appointment Default Limits

| day_of_week | is_closed | waiter_8am_slots | waiter_9am_slots | dropoff_total | notes |
|-------------|-----------|------------------|------------------|---------------|-------|
| Sunday      | true      | 0                | 0                | 0             | Closed |
| Monday      | false     | 2                | 2                | 31            |  |
| Tuesday     | false     | 2                | 2                | 31            |  |
| Wednesday   | false     | 2                | 2                | 31            |  |
| Thursday    | false     | 2                | 2                | 31            |  |
| Friday      | false     | 2                | 2                | 31            |  |
| Saturday    | false     | 2                | 2                | 15            | Half day |
```

### Field reference

| Column | Required | Format | Notes |
|---|---|---|---|
| `day_of_week` | yes | Sunday-Saturday | Must include all 7 |
| `is_closed` | yes | `true`/`false` | When `true`, the day-of-week is treated as closed AND a weekly cron auto-adds the next ~104 occurrences to `closed_dates` |
| `waiter_8am_slots` | yes | non-neg int | Number of 8 AM waiter appointments offered |
| `waiter_9am_slots` | yes | non-neg int | Number of 9 AM waiter appointments offered |
| `dropoff_total` | yes | non-neg int | Cap on drop-off appointments for the whole day |
| `notes` | no | short string | Internal advisor note (not customer-facing) |

## Two-step flow

Same dry-run-then-confirm pattern. Tool defaults `dry_run: true`. Show advisor:

> "Dry-run for appointment_default_limits: changing Saturday `dropoff_total` from 15 → 20. No other changes. Apply?"

On approval: re-call with `dry_run: false` + `expected_confirm_token`.

## Sunday-is-closed has a cascading effect

If `is_closed` flips on the Sunday row from `true` to `false` (or vice-versa), the weekly cron's behavior changes on the NEXT run:

- `is_closed: true` → cron adds next 104 Sundays to `closed_dates` (with `source='default-sunday'`)
- `is_closed: false` → cron stops auto-adding Sundays. Existing `default-sunday` rows stay (immutable past, future-set cleared on next prune)

This is the canonical way to "open Sundays" for the shop. Confirm explicitly with advisor:

> "Flipping Sunday `is_closed` to false will open Sundays for booking starting next week. The cron will stop adding new Sundays to closed_dates. Confirm?"

## Capacity model — quick reference

- **Waiter slots** are TIMED (8 AM or 9 AM only). Two integers control how many of each are offered.
- **Drop-off slots** are NOT timed — customers drop off "before 10 AM" (or "as soon as possible" if booking same-day after noon — see SAME_DAY_CUTOFF_HOUR in `shop-tz.ts`). One integer (`dropoff_total`) caps the day's drop-off count.
- Both can be overridden for a specific date via `appointment_blocks` (not covered here — separate admin tool).

## Single-cell tweaks

No per-cell patch tool — `appointment_default_limits` is small enough that bulk upload is fine. If the advisor wants to change one number, edit the MD locally, dry-run, approve, apply.

## Revert

See [`revert-upload.md`](./revert-upload.md). Same snapshot-based revert pattern.

## Workflow examples

### Example 1 — bump Saturday drop-off capacity

> Advisor: "Saturday's getting busy — increase drop-offs to 20."

→ Edit Saturday `dropoff_total` from 15 → 20
→ Dry-run: "Saturday dropoff_total 15 → 20. Apply?"
→ Apply on yes

### Example 2 — open Sundays

> Advisor: "We're going to be open Sundays from now on."

→ Confirm the cascading effect: "Flipping Sunday `is_closed` to false will stop the cron from auto-adding Sundays to closed_dates starting next week. New bookings can land on Sundays. Confirm?"
→ Edit Sunday row: `is_closed=false`, `waiter_8am_slots=2`, `waiter_9am_slots=2`, `dropoff_total=15` (or whatever advisor wants)
→ Dry-run, approve, apply

### Example 3 — add a half-day Friday

> Advisor: "Cut Friday drop-offs to 15 — short staffing this week."

→ This is a ONE-OFF change, not a default. Use `appointment_blocks` instead (separate admin tool — direct DB or a future MCP tool). Default limits are for the pattern, not a single date.

→ Tell advisor: "That sounds like a one-off rather than a default. Want me to create an `appointment_blocks` row for that specific Friday instead?"

## Don't

- ❌ Don't change default limits for a one-off — use `appointment_blocks` for date-specific overrides.
- ❌ Don't drop rows below 7 — the parser requires all 7 days.
- ❌ Don't flip Sunday `is_closed` without explaining the cascading cron behavior to the advisor.

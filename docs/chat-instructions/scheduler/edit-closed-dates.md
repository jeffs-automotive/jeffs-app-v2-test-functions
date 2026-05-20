# Edit closed dates — Claude Desktop guide

> **What this controls:** the future closed-dates set (holidays + one-off
> closures). Sundays are NOT in here — they're auto-managed by a weekly cron.
>
> **Source-of-truth file:** [`./templates/closed-dates.md`](./templates/closed-dates.md) (moved 2026-05-19 from `docs/scheduler/`)
> **Tool:** `upload_closed_dates_md`

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

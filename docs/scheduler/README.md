# Scheduler — editable .md files

This folder holds the source-of-truth markdown documents that drive the
customer-facing scheduler at **appointments.jeffsautomotive.com**. Edit
the files here, then ask Claude to upload them — Claude calls the right
admin tool, parses the markdown, and applies the change to the DB.

> **Looking for the architecture / code map?** See
> [`../../.claude/memory/scheduler_system_architecture.md`](../../.claude/memory/scheduler_system_architecture.md) —
> the canonical table of contents for the Next.js app, edge functions,
> DB schema, crons, RLS posture, deployment, and Sentry config. Lives
> as a memory file (sibling of `keytag_system_architecture.md`) so it's
> auto-loaded at session start. This `docs/scheduler/` folder is the
> *content* admin tools upload; the architecture doc is the *system
> map* of how that content is consumed.

## What's in here

| File | What it controls | Claude tool to upload |
|------|------------------|------------------------|
| [`testing-services.md`](./testing-services.md) | The 14 diagnostic/testing services + their pricing (`starting_price_cents`) + which concern categories they map to | `upload_testing_services_md` |
| [`routine-services.md`](./routine-services.md) | The 10 routine-service picker chips (oil change, tire rotate, brake inspection, etc.). NO pricing on routine services in Phase 1. | `upload_routine_services_md` |
| [`appointment-default-limits.md`](./appointment-default-limits.md) | Weekly capacity pattern — waiter-slot counts and drop-off totals for each day of the week | `upload_appointment_default_limits_md` |
| [`closed-dates.md`](./closed-dates.md) | One-off closures + holidays. Sundays are auto-managed via a cron; don't list them here. | `upload_closed_dates_md` |
| [`concerns/{slug}/{slug}-concerns.md`](./concerns/) (14 files) | The diagnostic-LLM's symptom checklists. One markdown doc per concern category — each has 6-12 symptom sub-categories and 5-7 plain-language questions per sub-category. | `upload_concern_category_md` (one category per call) |

## The 14 concern-category MDs

```
docs/scheduler/concerns/
├── brakes/brakes-concerns.md
├── electrical/electrical-concerns.md
├── hvac/hvac-concerns.md
├── leak/leak-concerns.md
├── noise/noise-concerns.md
├── other/other-concerns.md
├── performance/performance-concerns.md
├── pulling/pulling-concerns.md
├── smell/smell-concerns.md
├── smoke/smoke-concerns.md
├── steering/steering-concerns.md
├── tires/tires-concerns.md
├── vibration/vibration-concerns.md
└── warning_light/warning_light-concerns.md
```

Format for each concern doc:

```markdown
# {Category Display Label}

-- {Sub-Category Name} Checklist --
1. Question 1
2. Question 2
...

-- {Next Sub-Category Name} Checklist --
1. ...

---

Sources consulted:
- url1
- url2
```

Edit any concern doc locally, then ask Claude:

> "Upload the updated brakes concern doc."

Claude will paste the content into `upload_concern_category_md` with
`category_slug='brakes'`. The upload is diff-based — sub-categories and
questions present in your edited file are upserted; anything that was in
the DB but is no longer in your file is soft-deleted (active=false).
Re-uploading identical content is a no-op (hash check).

## Quick-reference workflows

### Change a single price

Just ask Claude in conversation:

> "Set brake_inspection price to $45."

Claude calls `patch_testing_service_fields(service_key='brake_inspection', starting_price_cents=4500)`. Don't need to touch any file.

### Bulk-update testing services

1. Edit `testing-services.md` locally (change multiple rows, add new ones, mark some inactive)
2. Ask Claude: *"Upload the updated testing services."*
3. Claude calls `upload_testing_services_md` with the file content
4. Confirmation: counts of added / modified / deactivated

### Add a holiday

1. Edit `closed-dates.md`, add the date + reason
2. Ask Claude: *"Upload the updated closed dates."*
3. Claude calls `upload_closed_dates_md`

### Refine a concern questionnaire

1. Edit `concerns/{slug}/{slug}-concerns.md` (add/edit sub-categories, change questions, reorder)
2. Ask Claude: *"Upload the updated {slug} concern doc."* (where {slug} is the category)
3. Claude calls `upload_concern_category_md` with that one category
4. Repeat per category you changed

### Add a new testing service (with pricing)

Either:
- Add a row to `testing-services.md` and re-upload (whole-table replace) — OR
- Ask Claude: *"Add a new testing service: transmission_scan, $179.95, Transmission Scan, TRANS SCAN, category performance."* — Claude calls `upsert_testing_service` directly.

## Rules of thumb

- **Money is in cents** in the MD files. `4500` = $45.00. Never use decimals in the file.
- **Routine services have NO pricing.** Don't add a price column.
- **Concern categories are exactly 14** — `noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other`. Never invent new ones.
- **service_key is canonical** — lowercase + underscore (e.g. `brake_inspection`). Once set, don't change it — that breaks references in past appointments.
- **Re-uploading the same content is a safe no-op** — every upload is hash-checked.
- **Past closed_dates are immutable.** The upload tool ignores them entirely.
- **Audit logs every upload.** Look at `scheduler_admin_audit_log` if you ever need to see who changed what when.

## The chat agent's domain knowledge

The chat agent reads `docs/chat-instructions/scheduler.md` to know how
to handle scheduler-related requests (price confirmations, category
validation, etc.). That doc + this folder cover the full scheduler
admin surface.

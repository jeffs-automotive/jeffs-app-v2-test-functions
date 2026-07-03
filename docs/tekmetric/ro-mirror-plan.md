# Tekmetric RO mirror — plan (2026-07-03)

## Why

Tekmetric's `/repair-orders` API filters on very few parameters (dates, status, customer, vehicle).
Chris wants ROs mirrored into our own Postgres so we can filter on ANY field ("maximum
filterization") — the immediate driver is harvesting real customer concerns from ROs that carry
diagnostic-category jobs (LLM eval fixture), but the mirror is general-purpose.

## Evidence base

- 2,500-RO time-spread sample (recent / oldest / two middle bands) pulled 2026-07-03 via
  `tekmetric-api-testing` `list_ros`; 178 distinct field paths censused (types, null rates,
  max lengths). Census artifact: scratchpad `ro-census.json` + `ros-batch.jsonl`.
- The census found ~15 real fields absent from the API docs' example (`jobs[].parts[].partStatus`,
  tire attributes `loadRange/mileageWarranty/runFlat/sideWallStyle/temperature/tireCategory/
  tireType/traction/treadwear`, `sublets[].accountsPayable{...}`, `feeable`, `taxSublet`,
  `estimate/inspection/invoiceShareDate`, `estimate/inspection/invoiceUrl`, `leadSource`,
  `customerTimeOut`, `jobs[].sort`) — proving the unknown-field alarm is necessary, not paranoia.
- Corpus: 148,170 ROs at shop 7476. ~70% of sampled ROs have ≥1 customer concern line.
- `/repair-orders` supports `updatedDateStart/End` → incremental sync watermark. Max page size 100.

## Locked decisions (Chris, 2026-07-03)

1. Mirror ROs into the DB with **a column for every JSON field** (arrays → normalized child
   tables, one column per field — an RO is not 1NF, so "column per line item" = child tables).
2. **Fallback for missed fields:** ingest keeps the full raw payload (`raw` JSONB on the RO row)
   AND diff-checks every object's keys against per-level known-key whitelists; unknown keys are
   upserted into `tekmetric_ro_ingest_alerts` and surfaced in the run summary so we add columns.
3. Large-batch pulls via pagination (100/page) through the `tekmetric-api-testing` edge fn
   (`raw_get`), not one-call-per-RO.

## Schema (migration `20260703T…_tekmetric_ro_mirror.sql`)

11 mirror tables, all `tekmetric_` prefixed, Tekmetric BIGINT ids as natural PKs (intentional
departure from the app-table UUID+surrogate convention — mirrors upsert by provider id),
`shop_id INTEGER NOT NULL`, money `BIGINT` cents `_cents` suffix, `TIMESTAMPTZ`, `TEXT`,
fractional-capable numbers (`hours`, `quantity`, `ratio`, `diameter`, `miles`) as `NUMERIC`.
RLS ENABLED with **no policies** (deny-all; service-role only — internal analysis surface).

- `tekmetric_ros` — every RO scalar + flattened `repairOrderStatus`/`repairOrderLabel`
  (+ its nested status code)/`repairOrderCustomLabel` + `raw JSONB` + `synced_at`.
- `tekmetric_ro_jobs` — job scalars incl. `canned_job_id`, `job_category_name`, `note`.
- `tekmetric_ro_job_labor`, `tekmetric_ro_job_parts` (all tire/part attrs + flattened
  `partType`/`partStatus` + `dot_numbers TEXT[]`), `tekmetric_ro_job_fees`,
  `tekmetric_ro_job_discounts`.
- `tekmetric_ro_fees`, `tekmetric_ro_discounts` (RO level).
- `tekmetric_ro_customer_concerns` — `concern`, `tech_comment` (the harvest target).
- `tekmetric_ro_sublets` (flattened `vendor` + `accountsPayable`; `ap_payment_details JSONB`),
  `tekmetric_ro_sublet_items`.
- `tekmetric_ro_ingest_alerts` — `(level, unknown_keys TEXT[], ro_id, sample JSONB,
  first_seen, last_seen, occurrences)`, `UNIQUE (level, unknown_keys)`.
- Indexes: ros (posted_date, updated_date, customer_id, vehicle_id, appointment_id);
  jobs (ro_id, canned_job_id, job_category_name); children (ro_id / job_id); concerns (ro_id).

Child-row refresh semantics: per synced RO, children are DELETE-then-INSERT (Tekmetric can
remove/rearchive line items; PK upsert alone would strand deleted rows).

## Ingest runner (`scheduler-app/scripts/tekmetric/sync-ros.mjs` — ungated script path)

- Pages `raw_get /repair-orders?shop=7476` (100/page) through the edge fn; writes via
  `@supabase/supabase-js` + `SUPABASE_SECRET_KEY` (from `scheduler-app/.env.local`).
- Modes: `--backfill` (all ~1,482 pages, resumable via `--start-page`), `--since <ISO>` /
  default incremental (watermark = max `updated_date` in `tekmetric_ros`, minus 1h overlap,
  via `updatedDateStart`).
- Unknown-key detection at every level (RO / job / labor / part / fee / discount / concern /
  sublet / sublet_item / vendor / accountsPayable / partType / partStatus / status / label) →
  alert upserts + stderr summary; exit code stays 0 (data still landed; raw JSONB has it).
- Type surprises (e.g. string where number expected) surface as PostgREST insert errors →
  logged per-RO, RO retried into `tekmetric_ros` with scalars-only=false? NO — fail the row
  loudly, print, continue batch; failed RO ids listed in the run summary for re-run.

## Verification

- pgTAP: tables exist + RLS enabled + key columns typed as designed (spot checks).
- Backfill run: row counts vs `totalElements`; sample RO spot-diffed against `raw`.
- `/code-review` gate on the migration + script.

## Out of scope (this feature)

- No webhook/live sync (batch script only; cron can be added later).
- No customers/vehicles mirrors (RO payload's embedded ids suffice for filtering; join to
  Tekmetric on demand).
- No UI.

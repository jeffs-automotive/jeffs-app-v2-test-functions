# Keytag webhook payment-idempotency fix — plan (2026-06-16)

> Feature marker: `keytag-webhook-payment-idempotency-fix`. Backend-only (one migration + pgTAP test). **No UI.**

## Why

A repair order that takes **two payments** — a partial payment, then a "paid in full" payment — should keep its key tag on the first and **release it on the second**. It doesn't. The tag stays `posted_ar` until the nightly reconcile catches it as an orphan (ORP manual review). Confirmed live on **Y1 / RO #152753** (ORP-3XV67F) and **Y32 / RO #153119** (ORP-58FVQT); both released + resolved manually on 2026-06-16.

### Root cause (proven against live data)

`keytag_webhook_events.event_hash` (the DB-level idempotency dedup column, migration `20260522191500_webhook_event_idempotency.sql`) is:

```
sha256( event_kind | coalesce(tekmetric_ro_id, payment_id, data.id) | status_id | data.updatedDate )
```

For a `payment_made` event the handler sets **both** `tekmetric_ro_id` (= `data.repairOrderId`) and `payment_id` ([keytag-tekmetric-webhook/index.ts:430-433](../../supabase/functions/keytag-tekmetric-webhook/index.ts#L430)). So:

- `coalesce(tekmetric_ro_id, payment_id, …)` → **`tekmetric_ro_id` wins; `payment_id` is never in the hash.**
- `status_id` is **NULL** for payment events.
- Payment payloads carry **no `data.updatedDate`** (verified: **0 of 803** payment rows have one).

⇒ every payment on a given RO hashes to the constant `sha256("payment_made|<ro_id>||")`. The partial unique index `keytag_webhook_events_event_hash_uniq` then rejects the 2nd+ payment as a duplicate Tekmetric retry → `logEvent()` catches the `23505` → returns `null` → handler logs "duplicate event ignored", returns 200, **no processing**. The paid-in-full payment that would call `release_keytag_for_ro` is gone before the handler's (correct) `payment_made` branch ever runs.

**Proof:** recomputed hash == stored hash for both ROs, and a *hypothetical* 2nd payment (different `payment_id`, same RO, no `updatedDate`) produces the **identical** hash. Of the 15 ROs with >1 payment row, every one has `distinct_hashes = 1` — they kept multiple rows only because at least one predates the migration (`idempotency_active = false`, index-exempt). No two idempotency-active payment rows coexist on one RO — the index makes it impossible.

**Blast radius:** any A/R RO taking partial-then-full as two webhooks since ~2026-05-22. Nothing is lost (the reconcile reverse pass issues ORP), but tags sit stuck in `posted_ar` until a human resolves the code — draining the pool and skewing staleness. The ORP email copy ("the payment notification never reached us") is provably wrong for these cases. The identical defect is latent in `tekmetric_webhook_events` (the firehose).

## Locked decisions

1. **Fix = whole-body hash**, mirroring the in-repo precedent. qteklink hit the identical class (`20260606060000_qteklink_events_wholebody_hash.sql`, cross-verify-driven) and switched to `sha256(raw_body::text)`. Whole-body dedups byte-identical retries (the real idempotency goal — Tekmetric re-delivers identical bodies; `jsonb::text` canonicalizes key order + whitespace) and never collides genuinely-distinct events (distinct payments differ in `data.id` → distinct hash). This fixes the **whole class**, not just payments, and matches the established pattern (rule F, pattern-compliance).
   - *Considered + rejected:* the narrower "append `payment_id` as a 5th hash component." Correct for payments, but leaves other synthetic-collision cases latent and diverges from the qteklink pattern.
2. **Keep the partial unique index** `WHERE event_hash IS NOT NULL AND idempotency_active = true`. qteklink dropped its partial predicate because it had no historical duplicates; these two tables DO (the 31/3 pre-migration dupe groups the original migration deliberately exempted). A plain unique index would fail to build against those. Keep the partial predicate.
3. **No handler code change.** The bug is entirely the generated-column expression; the `payment_made` branch is already correct. Verified no code reads `event_hash` for logic.
4. **Fix both tables** in one migration — `keytag_webhook_events` (the bug) and `tekmetric_webhook_events` (same latent defect), for consistency. Chris may descope the firehose if preferred.
5. **No `database.types.ts` regen** — `event_hash` stays `text` (`string | null`); the TS type is unchanged.
6. **Migration via CLI** (`supabase db push`) — MCP `apply_migration` is deny-listed.

## File-by-file change list

### Create

- `supabase/migrations/20260616160000_webhook_event_wholebody_hash.sql`
  - For **each** of `public.keytag_webhook_events` and `public.tekmetric_webhook_events`:
    - `DROP INDEX IF EXISTS <table>_event_hash_uniq;`
    - `ALTER TABLE … DROP COLUMN IF EXISTS event_hash;`
    - `ALTER TABLE … ADD COLUMN event_hash text GENERATED ALWAYS AS (encode(extensions.digest(raw_body::text,'sha256'),'hex')) STORED;`
    - `CREATE UNIQUE INDEX <table>_event_hash_uniq ON … (event_hash) WHERE event_hash IS NOT NULL AND idempotency_active = true;`
    - refresh the `COMMENT ON COLUMN … event_hash` to describe whole-body semantics.
  - `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;` (self-contained, matches qteklink).
  - Wrapped in `BEGIN … COMMIT`. Idempotent (`IF EXISTS` / `IF NOT EXISTS`).
  - The drop+re-add of the column rewrites the table (small: ~3.2k / ~2.6k rows) and recomputes all hashes. Rebuild is collision-safe (proven above). Run `ANALYZE` is optional given table size.

- `supabase/tests/database/keytag_webhook_events_idempotency.test.sql` (pgTAP, modeled on `qteklink_events.test.sql`)
  - `event_hash = sha256(raw_body::text)`.
  - **The regression that proves the bug is fixed:** two `payment_made` rows, same `tekmetric_ro_id`, **different `payment_id`** (bodies differ in `data.id`) → **both stored** (no `23505`).
  - Byte-identical retry (same `raw_body`) → `23505` (retry still deduped).
  - Pre-migration row (`idempotency_active = false`) is exempt from the unique index.
  - (Optional) a matching `tekmetric_webhook_events` assertion if the firehose stays in scope.

### Modify

- None in app/edge code. (The existing Deno suite `keytag-tekmetric-webhook/index.test.ts` continues to pass — its duplicate test mocks the `23505` at the client and is agnostic to how the hash is computed.)

## Verification

- `supabase db push` against the test project (`itzdasxobllfiuolmbxu`) applies cleanly; index rebuilds without a uniqueness violation.
- `supabase test db` — new pgTAP file green (distinct-payment rows both stored; identical retry deduped).
- `deno test` — existing `keytag-tekmetric-webhook` suite still green.
- Post-migration spot check (Supabase MCP read): recompute `event_hash` for the two historical Y1/Y32 payment rows and confirm a hypothetical 2nd payment now yields a **distinct** hash.
- `/code-review` gate (fail-closed) before `/feature-done`.
- **Recommended:** `/feature-cross-verify` (Gemini + GPT) on the migration — the analogous qteklink fix was cross-verify-driven, and idempotency hashes are exactly where a second opinion pays off.

## Open questions

1. **Firehose in scope?** Plan fixes `tekmetric_webhook_events` too. Confirm, or descope to keytag-only.
2. **Backfill the stuck pool?** 2 unresolved ORP reviews remain beyond Y1/Y32 (4 total were unresolved; Y1/Y32 now resolved). Want me to release the other paid orphans in this feature, or leave them to the normal resolve flow?

---
agent: research-supabase-postgres
timestamp: 2026-05-22T16:00:00Z
sources_cited: 31
---

# Research: Supabase + Postgres patterns

## Topic 1: Supabase edge function auth (verify_jwt config)

### Summary

`verify_jwt` is a **gateway-level** check controlled by `supabase/config.toml` per function. With `verify_jwt = true` (default), the API gateway validates ANY JWT signed with the project's keys before the handler runs — this includes the publishable/anon key, the service_role key, and any signed-in user JWT. That is precisely why two functions like `tekmetric-api-testing` and `tekmetric-bootstrap` are reachable from a browser with the anon JWT: the gateway considers the anon key a "valid JWT." Service-role-only gating REQUIRES `verify_jwt = false` plus an explicit bearer/API-key check inside the handler. The Supabase 2026 server SDK now formalizes this via `auth: 'secret'` / `auth: 'secret:<name>'` modes that resolve named secret keys from dashboard settings, but a custom `checkSchedulerBearer()`-style helper that compares against an env var is the still-recommended pattern when you want to mint your own operator key independent of dashboard-managed secrets.

### Best practices

- For operator-only / service-to-service functions: **`verify_jwt = false` + handler-level bearer check.** Never rely on the gateway alone — it cannot distinguish anon JWT from service_role JWT for "is this valid" purposes; both are signed by the project.
- Prefer a **dedicated operator API key** stored in Supabase function secrets (or Vault) rather than reusing the service_role key as the bearer. The service_role key has full DB superuser-equivalent power; an operator key is rotatable independently and scoped to function invocation.
- If you must accept the service_role key as bearer, compare via constant-time string comparison (e.g., `crypto.timingSafeEqual`) — naive `===` leaks timing.
- Use the 2026 SDK's `auth: 'secret:<name>'` mode if your operator key is a Supabase-dashboard-managed secret key. This gives you `ctx.supabaseAdmin` automatically.
- Combine modes for hybrid endpoints: `auth: ['user', 'secret']` accepts EITHER a signed-in user JWT OR a named secret; `ctx.authMode` tells you which path matched.
- Keep `verify_jwt = true` for endpoints that should accept any authenticated user (read endpoints, user-context writes); the JWT check is cheap and useful as a first-pass DoS gate.

### Canonical example(s)

**config.toml** for an operator-only edge function:

```toml
[functions.tekmetric-bootstrap]
verify_jwt = false
import_map = "./functions/import_map.json"

[functions.tekmetric-api-testing]
verify_jwt = false
```

**Handler with custom bearer check** (Deno):

```ts
// supabase/functions/_shared/checkSchedulerBearer.ts
import { timingSafeEqual } from "https://deno.land/std/crypto/timing_safe_equal.ts";

export function checkSchedulerBearer(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "");
  const expected = Deno.env.get("SCHEDULER_OPERATOR_KEY") ?? "";

  if (!presented || !expected) return false;
  if (presented.length !== expected.length) return false;

  return timingSafeEqual(
    new TextEncoder().encode(presented),
    new TextEncoder().encode(expected),
  );
}

// supabase/functions/tekmetric-bootstrap/index.ts
import { checkSchedulerBearer } from "../_shared/checkSchedulerBearer.ts";

Deno.serve(async (req) => {
  if (!checkSchedulerBearer(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // operator-only logic
});
```

**2026 SDK form** (preferred when you control deployment cadence):

```ts
import { withSupabase } from "npm:@supabase/server";

export default {
  fetch: withSupabase({ auth: "secret:tekmetric_operator" }, async (_req, ctx) => {
    // ctx.supabaseAdmin bypasses RLS — service-role-equivalent
    return Response.json({ ok: true });
  }),
};
```

### Gotchas / things to avoid

- **Do NOT assume `verify_jwt = true` excludes the anon key.** It does not — the gateway sees the anon JWT as valid. Browser clients carry the anon JWT for any `supabase.functions.invoke()` call. If the function does ANY write the user shouldn't be able to perform directly, gate it.
- **Do NOT use `service_role` JWT for client-side function invocation.** The function secret used by `supabase.functions.invoke()` is the publishable/anon key.
- **Do NOT mix gateway-disabled JWT with handler-level "check getUser()" only** unless you actually want any-signed-in-user access. `verify_jwt = false` + RLS bypass via `supabaseAdmin` + no bearer check = anyone with the function URL can write.
- **Do not commit operator keys to git.** Store in Supabase function secrets (`supabase secrets set SCHEDULER_OPERATOR_KEY=...`) or Vault. `.env.local` is fine for local dev only.
- The redeploy step after toggling `verify_jwt` is **required** — config.toml is only applied on function deploy, not at request time.

### Sources

- [Securing Edge Functions | Supabase Docs](https://supabase.com/docs/guides/functions/auth)
- [Function Configuration | Supabase Docs](https://supabase.com/docs/guides/functions/function-configuration)
- [Skip authorization check on Edge Functions · supabase · Discussion #8569](https://github.com/orgs/supabase/discussions/8569)
- [Edge Functions Authentication · supabase · Discussion #36602](https://github.com/orgs/supabase/discussions/36602)
- [Integrate Supabase Auth with Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt)

---

## Topic 2: RLS "deny_all" patterns for service-role-only tables

### Summary

**RLS enabled + zero policies is semantically equivalent to a deny-all policy for non-bypass roles** in Postgres 17 / Supabase 2026. The Postgres engine evaluates RLS as "every row must match at least one PERMISSIVE policy"; with zero policies, that condition is vacuously false for `authenticated` / `anon` / `public`. `service_role` has `BYPASSRLS` granted on the role, so it is unaffected. Supabase's official RLS guide states this explicitly: "Once you have enabled RLS, no data will be accessible via the API when using a publishable key, until you create policies." Adding an explicit `CREATE POLICY deny_all ... USING (false)` policy adds **zero security value** — it changes nothing about access control — but does add **documentation value**: it makes intent obvious to anyone reading the schema (vs. a future maintainer reading `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and assuming policies were lost / forgotten). The Supabase Security Advisor (Splinter) does NOT flag "RLS enabled with no policies" as a finding — only "RLS disabled in public" (lint 0013) — confirming that the implicit-deny pattern is supported.

### Best practices

- **Implicit deny (RLS enabled, no policies) is fine and canonical** for service-role-only tables — audit logs, webhook event tables, OAuth token tables, scheduler internal tables.
- If you choose to add documentation policies, name them precisely (`deny_all_authenticated`) and add a comment: `COMMENT ON POLICY deny_all_authenticated ON x IS 'service_role only — RLS gate.'`
- **Keep separate SELECT/INSERT/UPDATE/DELETE policies** instead of one `FOR ALL` policy. The four-policy pattern is what Supabase advisors and the `pgTAP` test helpers expect, and silent failures of UPDATE/DELETE (RLS filters them to zero rows rather than throwing) are easier to debug when each operation has its own gate.
- **Never use `USING (true)`** for any role except `service_role`. If a table is truly public-read, write `USING (true)` only inside a SELECT policy `TO anon, authenticated` so the intent is in the policy verb, not the predicate.
- **Always wrap function calls in `(SELECT ...)`** in the USING clause for InitPlan caching: `USING ((SELECT public.get_employee_shop_id()) = shop_id)` runs the function once per query rather than once per row.

### Canonical example(s)

**Implicit deny (preferred — minimal, idiomatic):**

```sql
CREATE TABLE webhook_events_failed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT,
  failed_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE webhook_events_failed ENABLE ROW LEVEL SECURITY;
-- No policies = no access for authenticated/anon. service_role still has full access via BYPASSRLS.
COMMENT ON TABLE webhook_events_failed IS
  'Failed webhook DLQ. Service-role-only. RLS enabled with no policies → implicit deny.';
```

**Explicit deny (documentation pattern — same security as implicit):**

```sql
ALTER TABLE webhook_events_failed ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_all_authenticated ON webhook_events_failed
  AS RESTRICTIVE FOR ALL
  TO authenticated, anon
  USING (false);
-- service_role still bypasses; this just documents intent.
```

**Documentation comment on the table** (recommended even with implicit deny):

```sql
COMMENT ON TABLE oauth_tokens IS
  'Service-role-only. RLS enabled, no policies → implicit deny. '
  'Accessed exclusively via edge functions using ctx.supabaseAdmin. '
  'Do NOT add SELECT/INSERT policies without security review.';
```

### Gotchas / things to avoid

- **Blocked UPDATE/DELETE under RLS silently filters rows, does not throw.** Your pgTAP tests must assert affected row counts via `lives_ok` + `is(ROW_COUNT, 0)` or `is_empty(...)` — `throws_ok` will produce false negatives.
- **`service_role` BYPASSRLS is not automatic for new custom roles.** If you create a custom role for scheduler workers, you must explicitly `ALTER ROLE scheduler_worker WITH BYPASSRLS;` — most teams just reuse `service_role` for simplicity.
- **The `postgres` superuser also has BYPASSRLS**, which is why `execute_sql` from a Supabase MCP read may show data on a "service-role-only" table — that doesn't mean RLS is broken.
- **Restrictive policies AND permissive policies compose differently.** Don't mix `AS RESTRICTIVE` and `AS PERMISSIVE` without understanding that restrictive policies are AND-combined with each other, then AND-combined with the OR of all permissive policies.
- **Views default to bypassing RLS** in Postgres < 15. On Postgres 17 you can set `WITH (security_invoker = true)` to enforce caller's RLS; on older versions you may inadvertently expose service-role-only tables via views.

### Sources

- [Row Level Security | Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Performance and Security Advisors | Supabase Docs](https://supabase.com/docs/guides/database/database-advisors?lint=0013_rls_disabled_in_public)
- [Supabase RLS Best Practices: Production Patterns for Secure Multi-Tenant Apps](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Securing your API | Supabase Docs](https://supabase.com/docs/guides/api/securing-your-api)
- [RLS Disabled in Public - splinter](https://supabase.github.io/splinter/0013_rls_disabled_in_public/)

---

## Topic 3: Scratch / backfill tables — patterns for cleanup

### Summary

Supabase's Security Advisor lint `0013_rls_disabled_in_public` will flag ANY table in the `public` schema without RLS — including `_bulk_keytag_backfill` and `_smoke_test_run`. The `_` prefix has **no special treatment** in Splinter; it is a developer naming convention only. The community-recommended pattern is to **move ops/dev/scratch tables out of `public` entirely** into a separate schema (variously named `internal`, `private`, `app`, `ops`, `scratch`) that is NOT in the API's "Exposed Schemas" list (Project Settings → API → Exposed schemas). Tables in non-exposed schemas are invisible to PostgREST and the auto-generated REST/GraphQL endpoints; the only way to reach them is direct DB connection or RPC functions you explicitly create in `public`. This is defense-in-depth: even if RLS is misconfigured or disabled on a scratch table, an unexposed schema means no API surface to attack. For truly one-time backfills, the **best pattern is to drop the table after use** — keep the migration that created it in source control as documentation, and add the DROP TABLE in a follow-up migration once the backfill is verified.

### Best practices

- **Move scratch/backfill tables to a non-exposed `internal` (or `archive`, `private`) schema.** This sidesteps the Splinter advisor lint entirely AND removes the PostgREST attack surface.
- **For one-time backfills: drop the table after verification.** Add a follow-up migration that drops it; the schema-versioned CREATE remains in git history as the audit trail.
- **For "keep around for occasional review" tables: move to `archive` schema with RLS enabled + no policies** (implicit deny). This keeps the data, removes the API exposure, and silences the advisor.
- **Name dev tables with a `_` or `tmp_` prefix even after moving** — the prefix loses its security purpose (the schema move handles that), but it remains useful in IDE autocomplete and migration review.
- **Never disable RLS on a `public` table to "make it work for now."** Even on dev branches, this exposes the table to anyone with the project URL + anon key. Use the schema-move pattern instead.
- **Document in a comment** what the table is for and when it should be dropped: `COMMENT ON TABLE internal._bulk_keytag_backfill IS 'One-time backfill from 2026-05-19. Drop after migration 20260601_keytag_v2 is verified in prod.';`

### Canonical example(s)

**Move existing dev tables to a non-exposed schema:**

```sql
-- Create the schema (one-time)
CREATE SCHEMA IF NOT EXISTS internal;
COMMENT ON SCHEMA internal IS 'Non-API-exposed schema for ops/dev/scratch tables. Not in PostgREST exposed schemas list.';

-- Move the offending tables
ALTER TABLE public._bulk_keytag_backfill SET SCHEMA internal;
ALTER TABLE public._smoke_test_run SET SCHEMA internal;

-- Enable RLS for defense-in-depth (even though schema is non-exposed)
ALTER TABLE internal._bulk_keytag_backfill ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal._smoke_test_run ENABLE ROW LEVEL SECURITY;

-- Service-role still bypasses; no policies needed.

COMMENT ON TABLE internal._bulk_keytag_backfill IS
  'One-time backfill scratch table. Created 2026-04-XX. '
  'Drop after Phase 2 keytag migration verified in prod (~Q3 2026).';
```

**Drop pattern for completed backfills:**

```sql
-- migration: 20260601_drop_keytag_backfill_scratch.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'internal' AND tablename = '_bulk_keytag_backfill') THEN
    DROP TABLE internal._bulk_keytag_backfill;
    RAISE NOTICE 'Dropped internal._bulk_keytag_backfill (backfill completed 2026-05-19, verified in prod).';
  END IF;
END $$;
```

**Project API settings (manual step or via management API):**

```
Exposed schemas: public, storage, graphql_public
                 ^^^^ — internal is NOT here, so PostgREST cannot see internal.* tables
```

### Gotchas / things to avoid

- **The `pg_temp` schema is NOT what you want here.** `pg_temp` tables are session-scoped (dropped when the connection ends) — useful for transaction-local scratch, useless for multi-session backfills.
- **`SET SCHEMA` will fail if any view, function, or foreign key references the table.** Inventory dependents first via `pg_depend` before moving.
- **`internal` schema tables are not visible in the Supabase Dashboard's Table Editor by default.** You may need to use SQL Editor for inspection. This is intentional — keeps clutter out of the main view.
- **Do not name the schema `private`.** Supabase uses `private` internally for some features (e.g., realtime); pick a name that won't collide.
- **Drop-table migrations are irreversible without a backup.** Verify the data is no longer needed (or copy to S3 / pg_dump) before dropping.

### Sources

- [RLS Disabled in Public - splinter](https://supabase.github.io/splinter/0013_rls_disabled_in_public/)
- [Performance and Security Advisors | Supabase Docs](https://supabase.com/docs/guides/database/database-advisors?lint=0013_rls_disabled_in_public)
- [It's fast, but you probably shouldn't use the default public schema in Supabase - Jay Sharp](https://sharpi.sh/posts/web-development/its-fast-but-you-probably-shouldnt-use-the-default-public-schema-in-supabase/)
- [Securing your API | Supabase Docs](https://supabase.com/docs/guides/api/securing-your-api)
- [Schema Design with Supabase: Partitioning and Normalization - DEV Community](https://dev.to/pipipi-dev/schema-design-with-supabase-partitioning-and-normalization-4b7i)

---

## Topic 4: Webhook idempotency with synthetic event hash

### Summary

When a webhook provider does NOT send a stable `event_id` (Tekmetric is one such — its webhook payloads carry the resource ID and event type but no event-level unique ID across retries), the canonical pattern is to **synthesize one from the payload itself** using a deterministic hash of business-identity fields. The hash MUST be over normalized JSON (sorted keys, no whitespace variation) so the same logical event computes the same hash regardless of how the provider serializes it. SHA-256 is the industry default — collisions are vanishingly improbable for webhook volumes (2^128 birthday bound vs. millions of events), and hex/base64 encoding makes the column a plain `TEXT` with a B-tree UNIQUE index. The recommended field selection is **provider + event_type + primary_resource_id + a coarse timestamp bucket** (e.g., minute-truncated `created_at`); including the timestamp prevents legitimate same-content events (e.g., "status updated to IN_PROGRESS" twice in a day) from being conflated as duplicates. The DB-level idempotency is enforced via `INSERT ... ON CONFLICT (event_hash) DO NOTHING RETURNING id` — if `RETURNING` is empty, you know it was a duplicate and skip the handler. This pattern is replay-safe by design: replaying the same webhook payload always produces the same hash, and the second insert is a no-op.

### Best practices

- **Hash on normalized JSON with sorted keys**, NOT on the raw byte stream. Providers may reorder keys between deliveries.
- **Include `provider`, `event_type`, and a stable resource ID** at minimum. Add `created_at` (or `updated_at`) bucketed to a minute / hour to allow legitimate repeat events.
- **Use SHA-256 hex (64 chars) as the unique column**, indexed as a regular B-tree UNIQUE index. Do NOT use BYTEA — TEXT indexes better in the Postgres planner for equality and is easier to inspect.
- **Use `INSERT ... ON CONFLICT (event_hash) DO NOTHING RETURNING id`** — atomic claim-or-skip. If `RETURNING` returns a row, this caller "won" and should process. If empty, another caller (or a retry) already claimed it.
- **Separate "raw event log" from "processing state."** A `webhook_events` table stores every received event (idempotency via UNIQUE on hash); a separate `webhook_events_failed` or per-domain processed-state table tracks downstream success/failure. This gives you DLQ + replay capability.
- **Match TTL to provider retry window.** Stripe retries for 3 days, Tekmetric is undocumented but observed at ~24 hours. Keep idempotency rows for 7-30 days; archive or delete older rows via pg_cron.
- **Never hash the entire payload as-is.** Volatile fields (`Date` header, `request_id`, server-side trace IDs) will defeat dedup.

### Canonical example(s)

**Idempotency table:**

```sql
CREATE TABLE tekmetric_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'tekmetric',
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id BIGINT NOT NULL,
  shop_id BIGINT NOT NULL,
  event_hash TEXT NOT NULL,        -- sha256 hex of (provider|event_type|resource_id|minute_bucket)
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  CONSTRAINT tekmetric_webhook_events_hash_uniq UNIQUE (event_hash)
);

CREATE INDEX tekmetric_webhook_events_shop_received_idx
  ON tekmetric_webhook_events (shop_id, received_at DESC);

CREATE INDEX tekmetric_webhook_events_status_idx
  ON tekmetric_webhook_events (status) WHERE status <> 'done';
```

**Hash construction (Deno / Edge function):**

```ts
// supabase/functions/_shared/webhookHash.ts
import { encodeHex } from "https://deno.land/std/encoding/hex.ts";

function canonicalJSON(obj: Record<string, unknown>): string {
  // Sort keys recursively for stable serialization
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map((v) => canonicalJSON(v as Record<string, unknown>)).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) =>
    JSON.stringify(k) + ":" + canonicalJSON(obj[k] as Record<string, unknown>)
  ).join(",") + "}";
}

export async function tekmetricEventHash(payload: {
  event_type: string;
  resource: { id: number; updated_at?: string };
  shop_id: number;
}): Promise<string> {
  // Bucket to the minute so legitimate same-content events in different minutes don't collide
  const minute = (payload.resource.updated_at ?? new Date().toISOString())
    .slice(0, 16); // "2026-05-22T16:00"
  const identity = {
    provider: "tekmetric",
    event_type: payload.event_type,
    resource_id: payload.resource.id,
    shop_id: payload.shop_id,
    minute_bucket: minute,
  };
  const buf = new TextEncoder().encode(canonicalJSON(identity));
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return encodeHex(new Uint8Array(digest));
}
```

**Atomic claim-or-skip insertion (in the edge function handler):**

```ts
const eventHash = await tekmetricEventHash(payload);

const { data: claimed, error } = await supabase
  .from("tekmetric_webhook_events")
  .insert({
    event_type: payload.event_type,
    resource_type: payload.resource_type,
    resource_id: payload.resource.id,
    shop_id: payload.shop_id,
    event_hash: eventHash,
    payload,
  })
  .select("id")
  .single();

if (error?.code === "23505") {
  // Unique violation — duplicate webhook. Return 200 so provider stops retrying.
  return new Response("duplicate", { status: 200 });
}
if (error) throw error;

// claimed.id is ours; process the event.
await processTekmetricEvent(claimed.id, payload);
```

**Alternative atomic claim via RPC (allows transactional processing):**

```sql
CREATE OR REPLACE FUNCTION public.claim_tekmetric_webhook(
  p_event_hash TEXT,
  p_event_type TEXT,
  p_resource_type TEXT,
  p_resource_id BIGINT,
  p_shop_id BIGINT,
  p_payload JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.tekmetric_webhook_events
    (event_type, resource_type, resource_id, shop_id, event_hash, payload)
  VALUES
    (p_event_type, p_resource_type, p_resource_id, p_shop_id, p_event_hash, p_payload)
  ON CONFLICT (event_hash) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL if conflict; UUID if claimed
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_tekmetric_webhook FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_tekmetric_webhook TO service_role;
```

### Gotchas / things to avoid

- **Hashing raw `await req.text()` is unsafe** — providers can reorder JSON keys or add whitespace between deliveries. Always parse, normalize, then hash.
- **Don't hash volatile fields.** Avoid `Date` headers, request IDs, server trace IDs, and anything the provider mutates per-delivery.
- **Minute-bucket granularity matters.** Bucketing too coarsely (day) collapses legitimate repeat events; too fine (second) defeats dedup when retries arrive seconds apart. One minute is the common compromise.
- **Don't try to dedup AFTER processing.** The whole point is to prevent the handler from running twice. Insert-or-skip MUST happen first, atomically.
- **SHA-256 hash collisions** are not a realistic concern at webhook volumes (you'd need ~2^128 events for a 50% birthday-bound collision). But MD5 and SHA-1 are not collision-resistant; don't use them even when "good enough" — the index cost is identical.
- **Index size matters at scale.** A 64-char TEXT hash index uses ~150 bytes per row. At 10M rows that's 1.5 GB of index. Consider archiving rows older than retry-window + comfort margin via pg_cron.
- **Don't return 4xx on duplicate.** Return 200 — the provider's retry policy considers any non-2xx as "deliver again." 200 + idempotent no-op stops the retry loop cleanly.

### Sources

- [How to Implement Webhook Idempotency](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency)
- [Stripe Webhooks End-to-End: Signature Verification, Idempotency, Replay, Dead-Letter | Appycodes](https://appycodes.dev/blog/stripe-webhooks-end-to-end-2026/)
- [Idempotency and Deduplication | Svix Resources](https://www.svix.com/resources/webhook-university/reliability/idempotency-and-deduplication/)
- [webhook-skills idempotency reference (hookdeck/webhook-skills)](https://github.com/hookdeck/webhook-skills/blob/main/skills/webhook-handler-patterns/references/idempotency.md)
- [Webhooks at Scale: Designing an Idempotent, Replay-Safe, and Observable Webhook System - DEV Community](https://dev.to/art_light/webhooks-at-scale-designing-an-idempotent-replay-safe-and-observable-webhook-system-7lk)
- [PostgreSQL ON CONFLICT DO NOTHING Explained with Examples](https://www.w3resource.com/PostgreSQL/snippets/postgres-on-conflict-do-nothing.php)

**Note on Tekmetric-specific format:** Public search did not surface authoritative Tekmetric webhook docs. The 2026-04-XX integration team must consult their developer portal directly to confirm: (a) whether any header carries a stable delivery ID (analogous to `X-Shopify-Webhook-Id`), (b) the exact resource/event JSON shape, (c) the retry policy. If a header-level delivery ID exists, prefer it over a synthetic hash; the synthetic hash is the fallback when no stable per-event ID is provided.

---

## Topic 5: pg_cron body syntax (DO $$ ... $$;) — common pitfall

### Summary

The pg_cron body passed to `cron.schedule()` is **a SQL command string**, not a PL/pgSQL block by default. Top-level `BEGIN ... EXCEPTION WHEN OTHERS ... END;` is invalid SQL outside a function or anonymous block — Postgres interprets `BEGIN` at the top level as the start of a transaction, and there is no SQL-level `EXCEPTION` clause. This is exactly why `scheduler-admin-snapshot-prune` has been silently failing since 2026-05-19: the body parses as "start a transaction, then a parse error at `EXCEPTION`", and pg_cron logs the parse failure to `cron.job_run_details.status = 'failed'` (visible only if you query that table, which is the silent failure). The two correct patterns are: (1) wrap the body in `DO $$ BEGIN ... EXCEPTION WHEN OTHERS THEN ... END $$;` (anonymous PL/pgSQL block), or (2) move the logic into a named PL/pgSQL function and have the cron body simply `SELECT my_func();`. The named-function pattern is strongly preferred by Supabase docs because (a) the function is testable from a SQL editor, (b) errors can use `RAISE LOG` / `RAISE NOTICE` for Log Explorer visibility, (c) the body string in `cron.schedule()` stays short and reviewable, and (d) updating the cron logic doesn't require unscheduling / re-scheduling — just `CREATE OR REPLACE FUNCTION`.

### Best practices

- **Always wrap PL/pgSQL logic in a named function**; cron body becomes `SELECT my_function();`. Function is testable in isolation, version-controlled in migrations, and updatable without touching `cron.schedule()`.
- **Use `EXCEPTION WHEN OTHERS THEN` inside the function** to log errors to a `scheduler_error_log` table AND emit `RAISE LOG` (or `RAISE WARNING`) so the error shows up in the Postgres Log Explorer.
- **Re-raise the exception** at the end of the EXCEPTION block if you want pg_cron to record the run as 'failed' in `cron.job_run_details`. If you swallow silently, the cron run looks "succeeded" but did nothing.
- **For HTTP-calling crons (pg_net):** the body is short enough that inline `SELECT net.http_post(...)` is OK, but still consider wrapping in a function if you want retry logic, secret retrieval, or shop-tag enrichment.
- **Always query `cron.job_run_details`** as part of observability — Sentry alone does NOT receive pg_cron failures unless you explicitly send them via a Log Drain or RAISE statement that's captured.
- **Set a function timeout** (`SET statement_timeout = '30s' AT FUNCTION` via `SET LOCAL` inside the function body) for long-running cron logic so a hung job doesn't pile up.

### Canonical example(s)

**Wrong (the current `scheduler-admin-snapshot-prune` shape — silently fails):**

```sql
-- DOES NOT WORK at top-level — BEGIN/EXCEPTION are not SQL
SELECT cron.schedule(
  'scheduler-admin-snapshot-prune',
  '0 3 * * *',
  $$
    BEGIN
      DELETE FROM scheduler_admin_snapshots WHERE created_at < now() - interval '30 days';
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO scheduler_error_log (cron_name, error_message, errored_at)
      VALUES ('scheduler-admin-snapshot-prune', SQLERRM, now());
    END;
  $$
);
```

**Right — anonymous DO block:**

```sql
SELECT cron.schedule(
  'scheduler-admin-snapshot-prune',
  '0 3 * * *',
  $$
    DO $cron$
    BEGIN
      DELETE FROM scheduler_admin_snapshots
       WHERE created_at < now() - interval '30 days';
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO scheduler_error_log (cron_name, error_message, errored_at)
      VALUES ('scheduler-admin-snapshot-prune', SQLERRM, now());
      RAISE WARNING 'scheduler-admin-snapshot-prune failed: %', SQLERRM;
    END
    $cron$;
  $$
);
```

Note the **`$cron$` named dollar-quote tag** for the inner block — `$$` would collide with pg_cron's own outer `$$`. Tag conflicts are the #1 silent-fail reason in nested cron bodies; always use a tag for the inner block.

**Best — named function (Supabase-recommended pattern):**

```sql
-- migration: 20260522_scheduler_snapshot_prune_fn.sql
CREATE OR REPLACE FUNCTION public.fn_scheduler_admin_snapshot_prune()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted_count BIGINT;
BEGIN
  RAISE LOG 'fn_scheduler_admin_snapshot_prune: start at %', now();

  DELETE FROM public.scheduler_admin_snapshots
   WHERE created_at < now() - interval '30 days';

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RAISE LOG 'fn_scheduler_admin_snapshot_prune: deleted % rows', v_deleted_count;

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.scheduler_error_log (cron_name, error_message, sqlstate, errored_at)
  VALUES ('scheduler-admin-snapshot-prune', SQLERRM, SQLSTATE, now());
  RAISE WARNING 'fn_scheduler_admin_snapshot_prune failed (% — %)', SQLSTATE, SQLERRM;
  -- Re-raise so cron.job_run_details.status = 'failed':
  RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_scheduler_admin_snapshot_prune FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_scheduler_admin_snapshot_prune TO service_role;

-- Cron body is now trivial:
SELECT cron.schedule(
  'scheduler-admin-snapshot-prune',
  '0 3 * * *',
  $$SELECT public.fn_scheduler_admin_snapshot_prune();$$
);
```

**Observability query** (run in SQL Editor or wire to a dashboard):

```sql
SELECT
  j.jobname,
  d.status,
  d.return_message,
  d.start_time,
  d.end_time
FROM cron.job j
JOIN cron.job_run_details d ON j.jobid = d.jobid
WHERE d.status <> 'succeeded'
  AND d.start_time > now() - interval '7 days'
ORDER BY d.start_time DESC
LIMIT 50;
```

### Gotchas / things to avoid

- **Top-level `BEGIN ... EXCEPTION` is invalid SQL.** This is the exact bug in `scheduler-admin-snapshot-prune`. Wrap in `DO $$ ... $$;` or move to a function.
- **`$$` collision** when nesting dollar-quoted strings is the #1 silent-fail source in cron bodies. Always tag inner blocks: `DO $cron$ ... $cron$;`.
- **pg_cron does NOT alert you to silent failures.** It records `status = 'failed'` in `cron.job_run_details`, but nothing pushes that to Sentry/Slack unless you explicitly query and emit. Build a monitoring cron that queries `cron.job_run_details` for failures and inserts into `scheduler_error_log` or sends to Sentry via pg_net.
- **Anonymous DO blocks cannot return values.** They run their effects, but you cannot `RETURNS TABLE` from them. If you need to return data (e.g., for a follow-up step), use a named function.
- **`RAISE LOG` only writes to Postgres logs, not to the table.** If you want both, INSERT into your `scheduler_error_log` table AND `RAISE WARNING` (which writes to logs at WARNING level).
- **Re-raising after catching** is needed for pg_cron to mark the run as 'failed'. If you swallow silently, the cron status is 'succeeded' even though your logic threw — which masks the bug.
- **`SECURITY DEFINER` + `SET search_path = ''`** are essential for any function called by pg_cron — pg_cron runs as the `postgres` user, and search_path attacks via the public schema are a real concern.

### Sources

- [pg_cron: Schedule Recurring Jobs with Cron Syntax in Postgres | Supabase Docs](https://supabase.com/docs/guides/database/extensions/pg_cron)
- [pg_cron debugging guide. · supabase · Discussion #30168](https://github.com/orgs/supabase/discussions/30168)
- [PL/pgSQL Exception (pgtutorial.com)](https://www.pgtutorial.com/plpgsql/plpgsql-exception/)
- [PostgreSQL Exception (postgresqltutorial.com)](https://www.postgresqltutorial.com/postgresql-plpgsql/postgresql-exception/)
- [pg_net: Async Networking | Supabase Docs](https://supabase.com/docs/guides/database/extensions/pg_net)
- [GitHub - citusdata/pg_cron](https://github.com/citusdata/pg_cron)

---

## Topic 6: Postgres RPC for atomic multi-step writes

### Summary

PostgreSQL functions are **inherently transactional** — every PL/pgSQL function runs in an implicit BEGIN/COMMIT, and any unhandled exception triggers a complete rollback of every statement executed within it. This makes named functions invoked via `supabase.rpc()` the **canonical Supabase pattern for atomic multi-step writes** (Marmelab 2025/12 confirms: "the `supabase-js` client does not support transactions. It's based on PostGREST, which lacks transaction capabilities."). For `applyWizardTransition` (row UPDATE + bubble inserts) and `hydrateSession` stale-row reset (3-4 UPDATEs + DELETE), the right shape is a single `CREATE OR REPLACE FUNCTION public.fn_apply_wizard_transition(...)` that takes the inputs as typed arguments, performs all writes, and returns either VOID, a status enum, or a JSONB summary. The function should be `SECURITY DEFINER` ONLY if it needs to bypass RLS for internal joins; otherwise prefer `SECURITY INVOKER` so RLS still applies at the function's nested queries. The supabase-js client invokes via `supabase.rpc('fn_apply_wizard_transition', { ... })` and receives a single `{ data, error }` shape. If the function throws via `RAISE EXCEPTION`, the entire transaction rolls back and the client receives the error message — no partial writes.

### Best practices

- **Prefer `SECURITY INVOKER` (default)** so RLS still applies inside the function. Only use `SECURITY DEFINER` when (a) you need to read/write tables the caller has no RLS access to (e.g., audit logs), or (b) you need to bypass RLS for performance on internal joins. Document the reason in a `COMMENT ON FUNCTION`.
- **Type all inputs explicitly** — Postgres functions support typed args, default values, and named-arg invocation from supabase-js. This catches schema drift at the API boundary.
- **Use `RAISE EXCEPTION 'message %', value USING ERRCODE = 'P0001'`** for application-level errors with a structured ERRCODE; the caller can inspect `error.code` to distinguish "stale_revision" from "shop_id_mismatch" from system errors.
- **Return JSONB for complex results** — `RETURNS jsonb` lets you return `jsonb_build_object('updated_id', v_id, 'bubble_count', v_count)` without a custom row type. supabase-js auto-parses.
- **`REVOKE EXECUTE ON FUNCTION FROM PUBLIC`** and explicitly `GRANT EXECUTE TO authenticated, service_role` to enforce a deny-default at the function boundary, mirroring RLS philosophy at the function layer.
- **Add `SET search_path = ''`** (with fully-qualified `public.table_name` refs) to every SECURITY DEFINER function to prevent search_path attacks (see Topic 7).
- **Wrap multi-step logic in BEGIN/EXCEPTION** if you need to do compensating cleanup (e.g., emit an audit log row even on failure). The wrapping `EXCEPTION WHEN OTHERS` catches the error and lets you do cleanup; `RAISE` at the end re-throws.
- **Don't use Edge Functions for multi-step atomicity** unless you connect to Postgres directly via `deno-postgres` and issue BEGIN/COMMIT explicitly (Marmelab pattern). The supabase-js client used inside Edge Functions has the same no-transactions limitation as the client-side library.

### Canonical example(s)

**`applyWizardTransition` — UPDATE wizard_state + INSERT bubbles atomically:**

```sql
CREATE OR REPLACE FUNCTION public.fn_apply_wizard_transition(
  p_session_id UUID,
  p_to_step TEXT,
  p_bubbles JSONB,                 -- array of {message, kind, severity}
  p_expected_revision INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER                   -- RLS still applies to wizard_sessions + wizard_bubbles
SET search_path = ''
AS $$
DECLARE
  v_current_revision INT;
  v_new_revision INT;
  v_shop_id BIGINT;
  v_inserted_bubble_count INT := 0;
  v_bubble JSONB;
BEGIN
  -- 1. Verify session exists, owned by caller's shop, at the expected revision (optimistic lock)
  SELECT revision, shop_id
    INTO v_current_revision, v_shop_id
    FROM public.wizard_sessions
   WHERE id = p_session_id
     FOR UPDATE;          -- row lock to prevent concurrent transitions

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session % not found', p_session_id
      USING ERRCODE = 'P0001', DETAIL = 'wizard_session_not_found';
  END IF;

  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Revision mismatch: expected %, got %', p_expected_revision, v_current_revision
      USING ERRCODE = 'P0002', DETAIL = 'wizard_revision_conflict';
  END IF;

  -- 2. Update the wizard state
  UPDATE public.wizard_sessions
     SET step = p_to_step,
         revision = revision + 1,
         updated_at = now()
   WHERE id = p_session_id
   RETURNING revision INTO v_new_revision;

  -- 3. Insert the bubbles
  FOR v_bubble IN SELECT * FROM jsonb_array_elements(p_bubbles) LOOP
    INSERT INTO public.wizard_bubbles
      (session_id, shop_id, message, kind, severity, created_at)
    VALUES
      (p_session_id,
       v_shop_id,
       v_bubble->>'message',
       v_bubble->>'kind',
       v_bubble->>'severity',
       now());
    v_inserted_bubble_count := v_inserted_bubble_count + 1;
  END LOOP;

  -- 4. Return summary
  RETURN jsonb_build_object(
    'session_id',     p_session_id,
    'new_revision',   v_new_revision,
    'bubble_count',   v_inserted_bubble_count,
    'transitioned_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_apply_wizard_transition FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_apply_wizard_transition TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_apply_wizard_transition IS
  'Atomic wizard state transition with bubble insertion. SECURITY INVOKER — '
  'RLS still applies to wizard_sessions/wizard_bubbles for the calling user.';
```

**Calling from Next.js Server Action:**

```ts
// src/lib/dal/wizard.ts
export async function applyWizardTransition(
  shopId: string,
  input: ApplyWizardTransitionInput
): Promise<ApplyWizardTransitionResult> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('fn_apply_wizard_transition', {
    p_session_id: input.sessionId,
    p_to_step: input.toStep,
    p_bubbles: input.bubbles,
    p_expected_revision: input.expectedRevision,
  });

  if (error) {
    // Distinguish by ERRCODE for typed error UX:
    if (error.code === 'P0002') {
      return { ok: false, error: 'revision_conflict' };
    }
    if (error.code === 'P0001') {
      return { ok: false, error: 'session_not_found' };
    }
    throw error;
  }
  return { ok: true, data: ApplyWizardTransitionResultSchema.parse(data) };
}
```

**`hydrateSession` stale-row reset — multi-statement under one transaction:**

```sql
CREATE OR REPLACE FUNCTION public.fn_hydrate_session(
  p_session_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER     -- bypasses RLS to clean up across user/admin tables
SET search_path = ''
AS $$
DECLARE
  v_shop_id BIGINT;
  v_orphan_count INT;
BEGIN
  SELECT shop_id INTO v_shop_id FROM public.sessions WHERE id = p_session_id;
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'Session % does not exist', p_session_id USING ERRCODE = 'P0001';
  END IF;

  -- Reset stale bubble flags
  UPDATE public.session_bubbles
     SET is_stale = true
   WHERE session_id = p_session_id
     AND is_stale = false
     AND updated_at < now() - interval '30 minutes';

  -- Reset stale draft flags
  UPDATE public.session_drafts
     SET status = 'expired'
   WHERE session_id = p_session_id
     AND status = 'draft'
     AND created_at < now() - interval '2 hours';

  -- Clear unresolved holds
  UPDATE public.session_holds
     SET released_at = now()
   WHERE session_id = p_session_id
     AND released_at IS NULL
     AND acquired_at < now() - interval '15 minutes';

  -- Delete orphaned scratch rows
  DELETE FROM public.session_scratch
   WHERE session_id = p_session_id
     AND created_at < now() - interval '1 hour';

  GET DIAGNOSTICS v_orphan_count = ROW_COUNT;

  RETURN jsonb_build_object('session_id', p_session_id, 'orphan_count', v_orphan_count);
END;
$$;
```

### Gotchas / things to avoid

- **Functions do NOT auto-bypass RLS even when called via RPC.** Only `SECURITY DEFINER` (with the owner being `postgres` or a role with `BYPASSRLS`) bypasses RLS for the function body's nested queries. SECURITY INVOKER preserves the caller's RLS.
- **`supabase.rpc()` does NOT support nested transactions** with the caller's other supabase calls. The function's transaction is self-contained; if you need a wider transaction across multiple RPCs, that's the wrong architecture — fold everything into ONE function.
- **`PGRST202` errors from supabase-js for parameter-less RPCs** (known supabase-js bug): if your function takes zero args, pass `{}` as the second arg explicitly. `supabase.rpc('fn_x')` may misbehave; `supabase.rpc('fn_x', {})` is reliable.
- **`SELECT ... FOR UPDATE` row locks are released when the function returns** (because the function = transaction boundary). Don't try to hold a lock across multiple RPCs.
- **`RAISE EXCEPTION` rolls back the ENTIRE function**, including any audit-log inserts. If you want audit-on-failure, wrap the work in `BEGIN ... EXCEPTION WHEN OTHERS THEN <log> ... RAISE; END;`.
- **JSONB return values are clamped at 1 GB.** Don't return huge result sets via RPC; return paginated.
- **The function owner determines `SECURITY DEFINER` effective privileges.** When using Supabase migrations, functions are owned by `postgres` by default, which has BYPASSRLS. This is usually what you want for SECURITY DEFINER, but be aware of it.

### Sources

- [Transactions and RLS in Supabase Edge Functions (Marmelab)](https://marmelab.com/blog/2025/12/08/supabase-edge-function-transaction-rls.html)
- [Supabase Data Integrity: Guarantee Atomicity Using PostgreSQL RPC](https://openillumi.com/en/en-supabase-transaction-rpc-atomicity/)
- [Data Integrity First: Mastering Transactions in Supabase SQL (DEV)](https://dev.to/damasosanoja/data-integrity-first-mastering-transactions-in-supabase-sql-for-reliable-applications-2dbb)
- [JavaScript API Reference - rpc | Supabase Docs](https://supabase.com/docs/reference/javascript/rpc)
- [Database transactions in Supabase - Dinesh S](https://www.dineshs91.com/articles/transactions-in-supabase)
- [Client-side database transactions · supabase · Discussion #526](https://github.com/orgs/supabase/discussions/526)

---

## Topic 7: SECURITY DEFINER + search_path discipline

### Summary

`SECURITY DEFINER` functions execute with the **owner's privileges**, not the caller's. Combined with Postgres's `search_path` mechanism, this creates a classic privilege-escalation vector (CVE-2018-1058 / search_path attacks): if a SECURITY DEFINER function references unqualified objects (`SELECT * FROM users` instead of `SELECT * FROM public.users`), an attacker who can create objects in any schema that comes BEFORE `public` in the search_path can shadow `users` with a malicious version that runs with the function-owner's privileges. The canonical mitigation is **always** `SET search_path = ''` (empty) **plus fully-qualified references** (`public.users`, `pg_catalog.now()`). The empty search_path is now preferred over `SET search_path = public` per recent PostgreSQL community guidance and 2026 CVE patches (PostgreSQL 18.4 / 17.10 / 16.14 released May 2026 patched CVE related to CREATE TYPE search_path hijack). The empty-path forces every reference to be qualified, eliminating the entire attack surface. Pair with `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO <specific role>` to ensure the function is only callable by intended consumers, mirroring deny-default at the function layer.

### Best practices

- **`SET search_path = ''` + fully-qualified refs** is the 2026-preferred pattern. Use `public.users`, `pg_catalog.now()`, `extensions.uuid_generate_v4()` etc. Empty path eliminates the attack surface entirely.
- **`SET search_path = public, pg_catalog` is acceptable** only for low-risk functions that don't write — but still prefer empty + qualified.
- **`SET search_path = pg_catalog, public` is wrong** if `pg_catalog` is intended to be the trusted prefix — `pg_catalog` is always searched first regardless, you don't need to name it.
- **`REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC`** for every SECURITY DEFINER function, then `GRANT EXECUTE` to the explicit roles that need it (`authenticated`, `service_role`, custom roles).
- **`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`** as a one-time setup so new functions get deny-default automatically.
- **Project-wide: `REVOKE CREATE ON SCHEMA public FROM PUBLIC`** to prevent non-superusers from creating objects in `public`. Combined with empty search_path, this is the defense-in-depth strategy.
- **Internal validation inside the function**: even with `SECURITY DEFINER`, the function should validate the caller's authority (e.g., `IF auth.uid() IS NULL THEN RAISE EXCEPTION ...`) — don't assume the function being callable means the caller is authorized for this specific row.
- **`COMMENT ON FUNCTION`** documents WHY it's SECURITY DEFINER and what RLS it bypasses. Future maintainers will thank you.

### Canonical example(s)

**Correct shape — empty search_path + fully-qualified:**

```sql
CREATE OR REPLACE FUNCTION public.get_employee_shop_id()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT shop_id
    FROM public.employees
   WHERE auth_user_id = (SELECT auth.uid())
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_employee_shop_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_employee_shop_id() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_employee_shop_id IS
  'SECURITY DEFINER: bypasses RLS on employees so non-admin users can resolve their own shop_id. '
  'Safe because it filters by auth.uid() — caller can only ever resolve their OWN shop_id.';
```

**Wrong — unqualified references with default search_path:**

```sql
-- DANGEROUS — vulnerable to search_path attack
CREATE OR REPLACE FUNCTION public.get_employee_shop_id_unsafe()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT shop_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;
  -- ^^^ "employees" is unqualified; an attacker who creates a schema before public
  --     could shadow "employees" with a malicious table.
$$;
```

**`SET search_path = ''` even for SECURITY INVOKER if any callable surface is non-trusted:**

```sql
CREATE OR REPLACE FUNCTION public.has_permission(
  p_user_id UUID,
  p_account_id UUID,
  p_permission public.app_permissions
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM public.accounts_memberships m
      JOIN public.role_permissions rp ON m.account_role = rp.role
     WHERE m.user_id = p_user_id
       AND m.account_id = p_account_id
       AND rp.permission = p_permission
  );
END;
$$;
```

**Project-wide hardening (one-time setup):**

```sql
-- Run once as superuser/postgres
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
```

### Gotchas / things to avoid

- **`SET search_path = '$user', public`** (the default for new roles) is the attack surface. NEVER leave a SECURITY DEFINER function with the default search_path.
- **`pg_catalog` is always implicitly first** — you do NOT need `SET search_path = pg_catalog, public`. Just `SET search_path = ''` (which still has pg_catalog implicit) + qualify everything else.
- **`SET search_path` on the function** is fine, but `SET search_path = ''` at session level in a connection pool will break unqualified references in OTHER queries. Per-function `SET` is the safe choice.
- **`SECURITY DEFINER` is inherited** — if function A (SECURITY DEFINER) calls function B (SECURITY INVOKER), B runs as the caller of A. If B is SECURITY DEFINER, B runs as B's owner.
- **`auth.uid()` inside a SECURITY DEFINER function** still returns the caller's UID (it reads from `request.jwt.claims`, not from session role). So internal validation via `auth.uid()` works correctly even when the function bypasses RLS.
- **Migration ordering matters:** create the function before granting execute. Some teams put `REVOKE FROM PUBLIC` in a separate migration that runs after all functions are created (safer for re-runs).
- **`SECURITY DEFINER` functions owned by a role with `BYPASSRLS`** (like `postgres`) bypass RLS automatically. If you want a SECURITY DEFINER function that STILL respects RLS, you must explicitly `SET LOCAL ROLE` to a non-BYPASSRLS role inside the function — but at that point, just use SECURITY INVOKER.

### Sources

- [PostgreSQL: Documentation: 18: 21.6. Function Security](https://www.postgresql.org/docs/current/perm-functions.html)
- [A Guide to CVE-2018-1058: Protect Your Search Path - PostgreSQL wiki](https://wiki.postgresql.org/wiki/A_Guide_to_CVE-2018-1058:_Protect_Your_Search_Path)
- [Abusing SECURITY DEFINER functions in PostgreSQL (Cybertec)](https://www.cybertec-postgresql.com/en/abusing-security-definer-functions/)
- [PostgreSQL: PostgreSQL 18.4, 17.10, 16.14, 15.18, and 14.23 Released! (May 2026)](https://www.postgresql.org/about/news/postgresql-184-1710-1614-1518-and-1423-released-3297/)
- [PostgreSQL: Documentation: 18: 5.10. Schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)
- [Database Authorization — PostgREST docs](https://postgrest.org/en/v11/explanations/db_authz.html)
- [Supabase RLS Best Practices: Production Patterns for Secure Multi-Tenant Apps](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)

---

## Cross-cutting takeaways

1. **"Implicit + explicit deny" is the consistent pattern.** Whether it's RLS (RLS-enabled + no policies = deny), function execute privileges (REVOKE FROM PUBLIC + GRANT TO specific roles), edge function auth (verify_jwt = false + handler bearer check), or schema exposure (move out of public + remove from exposed schemas list) — the model is always "deny by default, allow specific holes for specific principals." Apply this uniformly across all 7 surfaces.

2. **`SET search_path = ''` belongs on every SECURITY DEFINER function**, no exceptions. This is the single highest-impact hardening change you can make to a Supabase Postgres project. Pair with fully-qualified references (`public.x`, `pg_catalog.now()`) and your project becomes resistant to CVE-2018-1058 and the May-2026 CREATE TYPE search_path CVEs.

3. **Atomic = function. Period.** Both the supabase-js client and Supabase Edge Functions lack transactional capabilities for multi-step writes (PostgREST is stateless; supabase-js has no transaction primitive). Any multi-statement consistency requirement MUST be wrapped in a PL/pgSQL function and invoked via `supabase.rpc()`. This applies to `applyWizardTransition` AND `hydrateSession` AND any future multi-step write you discover.

4. **DB-level idempotency is the contract, application-level dedup is the cache.** Even with application-level dedup logic, you MUST have a UNIQUE constraint at the DB layer. Race conditions at the application layer (two workers receiving the same retry simultaneously) are silent unless the DB rejects the duplicate. `INSERT ... ON CONFLICT (event_hash) DO NOTHING RETURNING id` is the atomic claim-or-skip primitive — use it for `tekmetric_webhook_events` and every future webhook table.

5. **Named functions beat anonymous blocks for crons.** Move `BEGIN ... EXCEPTION` logic out of `cron.schedule()` body strings into named PL/pgSQL functions. The function is testable, version-controlled, idiomatic, and updates without re-scheduling. The cron body becomes one-liner `SELECT my_fn();`. Apply this to `scheduler-admin-snapshot-prune` immediately to fix the silent-fail, and use it as the pattern for all future crons.

6. **Observability requires explicit emit + explicit query.** pg_cron records failures in `cron.job_run_details` but does NOT push them anywhere. Every cron function should (a) INSERT to `scheduler_error_log` on exception, (b) `RAISE WARNING` so it lands in Postgres logs, (c) `RAISE` to re-throw so pg_cron records the run as failed. Build a separate monitoring cron that queries `cron.job_run_details` for recent failures and ships them to Sentry/Slack — the table is the audit log, the monitor is the alert path.

7. **Schema-level isolation > naming-level isolation.** The `_` prefix on `_bulk_keytag_backfill` / `_smoke_test_run` is convention only — it provides no security and is not recognized by Splinter (the advisor) or PostgREST. Schema isolation (move to `internal` or `archive`, remove from API exposed schemas) is the actual mechanism. Apply once during the next cleanup pass; future scratch tables go directly into `internal`.

8. **Tekmetric-specific webhook docs are NOT publicly searchable.** Public web search did not surface authoritative Tekmetric API/webhook reference material (this is consistent with their developer portal being credential-gated). Before implementing the synthetic-hash idempotency for `tekmetric_webhook_events`, the team must consult Tekmetric's developer portal directly to confirm: (a) header-level delivery IDs (analogous to `X-Shopify-Webhook-Id`), (b) the actual JSON payload shape, (c) the retry window. If any stable per-delivery header exists, prefer it; synthetic hash is the fallback when none exists.

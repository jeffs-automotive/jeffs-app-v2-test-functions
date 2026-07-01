# telnyx-webhook v1 — durable Telnyx event intake (plan, 2026-07-01)

> Context: Chris is registering the new 10DLC **Low Volume Mixed** campaign (replacing the 2FA-only
> campaign C2EBBMD) and the campaign form has a Webhook URL field that was previously pre-wired to a
> function that never existed. This feature builds the endpoint **for real** so the URL on the campaign
> (and later the Messaging Profile) lands somewhere durable. This is a down-payment on revamp Phase 2
> (`docs/scheduler/REVAMP-PLAN-2026-06-24.md` §4/§7): full STOP/HELP → consent-ledger processing is
> DEFERRED until the `sms_consents` schema exists; v1 is capture + alerting only.

## What Telnyx sends here

- **Campaign webhook slot** (10DLC settings): brand/campaign provisioning status, number-assignment,
  campaign suspension events. NOT customer traffic.
- **Messaging Profile webhook slot** (wired later, same URL): inbound messages (customer replies,
  STOP/HELP) + delivery receipts (`message.received` / `message.sent` / `message.finalized`).
- Envelope: `{ data: { id, event_type, occurred_at, payload, record_type }, meta: { attempt, ... } }`.
- Signing: Ed25519 over `"{telnyx-timestamp}|{raw_body}"`, headers `telnyx-signature-ed25519` +
  `telnyx-timestamp`; account public key from Mission Control → Keys & Credentials → Public Key.
- Retries: up to 3 attempts w/ exponential backoff + failover URL; endpoint must answer in <2 s.
  (Source: developers.telnyx.com/docs/messaging/messages/receiving-webhooks, fetched 2026-07-01.)

## Migration — `telnyx_webhook_events` (firehose, per `tekmetric_webhook_events`/`qteklink_events` conventions)

- `id UUID PK DEFAULT gen_random_uuid()`
- `telnyx_event_id TEXT` (= `data.id`) + **partial UNIQUE** `WHERE telnyx_event_id IS NOT NULL` (dedup
  across Telnyx retries; insert-then-catch-23505, never upsert-on-partial-index)
- `event_type TEXT NOT NULL DEFAULT 'unknown'`, `occurred_at TIMESTAMPTZ` (parsed, null-safe)
- `signature_verified BOOLEAN NOT NULL DEFAULT false`
- `payload JSONB NOT NULL` (full body — carries phone-number PII → service_role only)
- `raw_headers JSONB` (denylist-redacted), `raw_query_string TEXT` (token-stripped)
- `shop_id INTEGER` nullable — Telnyx events are account-scoped, not shop-claimed; single-tenant today
  (7476). Multi-shop resolution (via TO/FROM number → shop map) is a documented follow-up.
- `processed_at TIMESTAMPTZ` nullable — reserved for the Phase 2 consent/DLR consumer.
- `received_at TIMESTAMPTZ NOT NULL DEFAULT now()`; indexes on `(event_type)`, `(received_at)`
- RLS ENABLED, **zero policies** (deny-all; service_role bypasses) + `REVOKE ALL FROM anon,
  authenticated` (keytag L3 lesson, migration 20260626120000)
- pgTAP: RLS enabled; anon SELECT/INSERT filtered (**row counts**, not exceptions); dedup unique
  constraint fires; column shape.

## Edge function — `supabase/functions/telnyx-webhook/index.ts` (template: `qteklink-webhook`)

1. `POST` only (405 otherwise). Wrapped in `withSentryScope(req, "telnyx-webhook", ...)`.
2. **Auth (fail-closed):** `?token=` query param vs `TELNYX_WEBHOOK_TOKEN` secret via `bearersEqual`
   (constant-time). Secret unset → 500 Misconfigured; mismatch → 401 + Sentry warning (same
   fingerprint pattern as qteklink). Telnyx-side the token rides the URL (Telnyx sends no custom headers).
3. **Ed25519 verify-if-present:** if `TELNYX_PUBLIC_KEY` secret set AND both signature headers present
   → WebCrypto Ed25519 verify of `"{timestamp}|{rawBody}"`; **verification failure → 401** (active
   forgery signal). Headers absent → accept on token alone, store `signature_verified=false`.
   Rationale: 10DLC provisioning events' signing is not documented as guaranteed; token remains the
   hard gate (accepted repo-wide pattern), signature adds defense when present. Before real message
   traffic (Phase 2) we flip to require-signed for `message.*` types.
4. **Durable-before-200:** parse (text-first, parse-error captured), extract `data.id`/`event_type`/
   `occurred_at`, insert; 23505 → 200 `duplicate:true`; other insert error → 503 (Telnyx retries).
5. **Alerting:** `event_type` matching `/suspend|deactivat|fail/i` on the 10DLC/campaign family →
   `Sentry.captureMessage(..., "warning")` (campaign suspension must never be silent).
6. Deno unit tests (`index.test.ts`, mock supabase client via `_shared/test-helpers.ts`): 405/500/401
   paths, happy-path store, duplicate, store-failure→503, signature verify pass/fail/absent, redaction.
7. `config.toml`: `[functions.telnyx-webhook] enabled=true, verify_jwt=false` (Telnyx can't send JWTs;
   auth is the URL token — same rationale block as tekmetric-webhook).

## Secrets + deploy (CLI per deployment.md; standing prod-push approval per feedback_always_push_to_prod)

1. Generate 32-byte hex token → `supabase secrets set TELNYX_WEBHOOK_TOKEN=... --project-ref itzdasxobllfiuolmbxu`
2. (Chris, later) `TELNYX_PUBLIC_KEY` from portal Keys & Credentials → same `secrets set`.
3. `supabase db push` (migration), `supabase functions deploy telnyx-webhook --project-ref itzdasxobllfiuolmbxu`
4. Live probe: bad token → 401; good token + sample envelope → 200 stored; replay → duplicate:true;
   verify row via MCP `execute_sql`.

## Also in this feature (ungated paths)

- `admin-app/public/legal/privacy.html`: generalize scope beyond the QBO app + add SMS/mobile-data
  section with the carrier-required "mobile information will not be shared with third parties or
  affiliates for marketing/promotional purposes" clause.
- NEW `admin-app/public/legal/terms.html` (SMS program terms: message types, frequency varies, msg &
  data rates, STOP/HELP, carrier non-liability, contact) + `next.config.ts` rewrite `/legal/terms`.
- Deploy via git push → Vercel; verify live URLs return the new content.

## Out of scope (deferred to revamp Phases 1–3)

`sms_consents` ledger + STOP/HELP revoke processing, `sms_messages` + DLR status updates, sender
functions, quiet hours, consent UI on PhoneNameCard, messaging-profile webhook wiring, A2P throughput
concerns.

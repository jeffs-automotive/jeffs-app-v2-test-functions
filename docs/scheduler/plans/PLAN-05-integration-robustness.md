---
plan: 05
title: Integration robustness
audit_findings: [I-INT-1, I-INT-2, I-INT-3, I-INT-4]
research_inputs: [research-integration-robustness, research-security-hardening]
estimated_effort: 5-6 days
prerequisites: [Plan-01 Phase 1A (edge fn auth pattern)]
risk_level: medium
---

# Plan 05 — Integration robustness

> Close the gaps where a vendor outage / delivery failure goes invisible. We currently know if Telnyx accepted a message but NOT whether the carrier delivered it. We know if Resend accepted a transcript email but NOT whether it bounced. Tekmetric outage = every wizard session burns retries then escalates. None of these are launch blockers but every one of them WILL bite us in production.

## Audit findings addressed

| # | Severity | Finding | Phase |
|---|---|---|---|
| **I-INT-1** | integration | No circuit breaker around Tekmetric | 3 |
| **I-INT-2** | integration | No Telnyx delivery-status webhook (we know "sent", not "delivered") | 1 |
| **I-INT-3** | integration | No Resend bounce/complaint webhook handler | 2 |
| **I-INT-4** | integration | No exponential backoff on transient Telnyx send failures | 4 |

> **I-INT-5 (A2P 10DLC verification)** is in **Plan 01 Phase 5** (research promoted it to launch-blocker).
> **I-INT-6 (Anthropic prompt cache hit-rate)** is in **Plan 02 Phase 4**.

## Research summary

- **`opossum` 9.x is Node de-facto** for circuit breakers. Critical anti-pattern: in-memory state is per-Vercel-instance — 50 invocations = 50 independent breakers. Unified Node+Deno pattern is **Upstash Redis as distributed state** (HTTP/REST works in both runtimes). Canonical config: `errorThresholdPercentage: 50`, `resetTimeout: 30000`, `volumeThreshold: 5`, `timeout: 3000`. Half-open via Redis `SETNX` claim. [integration-robustness §1]
- **Telnyx `message.finalized` is the delivery-status event.** Critical caveat: can arrive BEFORE `message.sent`; use `data.occurred_at` to sequence. Ed25519 signature in `telnyx-signature-ed25519` header; payload = `"{timestamp}|{raw_body}"`; 5-min replay window; **MUST verify on raw body before JSON parsing**. [§2]
- **Resend uses Svix (HMAC-SHA256).** 12 email events including `email.bounced` (with `bounce.type` = Permanent/Transient/Undetermined + `subType`), `email.complained`, `email.delivered`. Retry schedule: 5s, 5min, 30min, 2h, 5h, 10h. Dedup via `svix-id`. Preferred verification path is `resend.webhooks.verify()` SDK helper. [§3, security §6]
- **`p-retry` is canonical for backoff.** Formula: `delay = min(maxDelay, base * 2^attempt) * jitter`, jitter = `0.5 + Math.random()`. For Telnyx SMS: 3 retries, 200-2000ms backoff. Retry on 408/429/5xx; never on 4xx-validation. Telnyx transient codes: 40006, 40008. [§5]
- **Tekmetric realistic outage = 1-3 hours.** No partner-status webhook subscription path. Pattern: queue writes to `tekmetric_outbound_queue`, drain via pg_cron (existing `appointments-sync` already covers read backfill). UX: concrete time + clear save signal + callback path, NEVER "something went wrong" / infinite spinners. [§7]
- **Stripe Idempotency-Key model:** 24h retention, conflict-on-mismatch. For Tekmetric (no `Idempotency-Key` header support), use server-side dedup via `integration_request_dedup` table with payload hash. [§6]

---

## Phase 1 — Telnyx delivery-status webhook (I-INT-2, ~1.5 days)

**Goal:** Subscribe to `message.finalized` events. When carrier rejects/fails delivery, reclaim the per-phone OTP slot + alert.

### Phase 1A — Create the webhook receiver

**Files:**
- New `supabase/functions/telnyx-message-webhook/index.ts`
- New migration `supabase/migrations/20260522NNNNNN_telnyx_message_events.sql`

**Migration:**
```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.telnyx_message_events (
  id BIGSERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,                  -- Telnyx's event id (`id` field)
  event_type TEXT NOT NULL,                -- 'message.sent', 'message.finalized', 'message.delivery_updated'
  message_id TEXT NOT NULL,                -- Telnyx's message id
  to_phone TEXT NOT NULL,                  -- E.164
  status TEXT NOT NULL,                    -- 'queued','sending','sent','delivered','sending_failed','delivery_failed','delivery_unconfirmed'
  occurred_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, event_id) -- idempotency
);

ALTER TABLE public.telnyx_message_events ENABLE ROW LEVEL SECURITY;
-- service-role-only (implicit deny)

CREATE INDEX IF NOT EXISTS telnyx_message_events_message_id_idx
  ON public.telnyx_message_events (message_id);
CREATE INDEX IF NOT EXISTS telnyx_message_events_to_phone_status_idx
  ON public.telnyx_message_events (to_phone, status);

COMMIT;
```

**Edge function (canonical):**
```typescript
// supabase/functions/telnyx-message-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentryScope } from "../_shared/sentry-edge.ts";
import * as Sentry from "https://deno.land/x/sentry/index.mjs";
import { encodeHex } from "https://deno.land/std/encoding/hex.ts";

const PUBLIC_KEY = Deno.env.get("TELNYX_PUBLIC_KEY_BASE64")!; // from Telnyx dashboard
const SHOP_ID = 7476;

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) =>
  withSentryScope(req, "telnyx-message-webhook", async () => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const signature = req.headers.get("telnyx-signature-ed25519");
    const timestamp = req.headers.get("telnyx-timestamp");

    if (!signature || !timestamp) {
      Sentry.captureMessage("Telnyx webhook missing signature", "warning");
      return new Response("Missing signature", { status: 401 });
    }

    // 5-min replay window
    const tsMs = parseInt(timestamp) * 1000;
    if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      Sentry.captureMessage("Telnyx webhook timestamp out of window", "warning");
      return new Response("Stale timestamp", { status: 401 });
    }

    // CRITICAL: verify on RAW body before JSON parse
    const rawBody = await req.text();
    const signedPayload = `${timestamp}|${rawBody}`;
    const valid = await verifyEd25519(signedPayload, signature, PUBLIC_KEY);
    if (!valid) {
      Sentry.captureMessage("Telnyx webhook signature invalid", "warning");
      return new Response("Invalid signature", { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const eventId = payload.data?.id;
    const eventType = payload.data?.event_type; // 'message.sent', 'message.finalized', etc
    const message = payload.data?.payload;
    const messageId = message?.id;
    const status = message?.to?.[0]?.status; // delivered, delivery_failed, etc
    const toPhone = message?.to?.[0]?.phone_number;
    const occurredAt = payload.data?.occurred_at;

    // Idempotent insert
    const { error: insertErr } = await sb
      .from("telnyx_message_events")
      .insert({
        shop_id: SHOP_ID,
        event_id: eventId,
        event_type: eventType,
        message_id: messageId,
        to_phone: toPhone,
        status,
        occurred_at: occurredAt,
        raw_payload: payload,
      });

    if (insertErr && !insertErr.message.includes("duplicate key")) {
      Sentry.captureException(insertErr);
      return new Response("ok", { status: 200 }); // 200 to stop Telnyx retry
    }

    // Business logic: if delivery_failed, reclaim the OTP slot
    if (status === "delivery_failed" || status === "delivery_unconfirmed") {
      const { error: updateErr } = await sb
        .from("otp_codes")
        .update({ consumed_at: new Date().toISOString() })
        .eq("phone_e164", toPhone)
        .is("consumed_at", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (updateErr) Sentry.captureException(updateErr);

      Sentry.logger.warn("telnyx_delivery_failed", {
        message_id: messageId,
        to_phone: toPhone,
        status,
      });
    }

    return new Response("ok", { status: 200 });
  })
);

async function verifyEd25519(signedPayload: string, signature: string, publicKeyB64: string): Promise<boolean> {
  // ... use crypto.subtle.verify with Ed25519
  // Use crypto.subtle.importKey + crypto.subtle.verify
  // Cite Telnyx docs for exact byte-level format
}
```

**config.toml:**
```toml
[functions.telnyx-message-webhook]
verify_jwt = false
```

### Phase 1B — Configure Telnyx + verify

1. Telnyx dashboard → Messaging Profile → Webhook URL: `https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/telnyx-message-webhook`
2. Verify settings: `https://api.telnyx.com/v2/messaging_profiles/{id}/webhook_test`
3. Send a test SMS to a known number → expect `message.sent` + `message.finalized` events in `telnyx_message_events`
4. Send to an invalid number → expect `message.finalized` with `status: delivery_failed` + reclaimed otp_codes row

**Verification:**
1. Deploy: `npx supabase functions deploy telnyx-message-webhook`
2. Send a real OTP → verify webhook events arrive
3. Send to an invalid number → verify otp_codes row is consumed_at-stamped + Sentry warning fires

**Risk + rollback:**
- LOW. New function, additive. Rollback by removing webhook URL from Telnyx dashboard.

---

## Phase 2 — Resend bounce/complaint webhook (I-INT-3, ~1 day)

**Goal:** Detect when a transcript email bounces or gets marked spam.

### Phase 2A — Webhook receiver

**Files:**
- New `supabase/functions/resend-event-webhook/index.ts`
- New migration `supabase/migrations/20260522NNNNNN_resend_email_events.sql`

**Migration:**
```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.resend_email_events (
  id BIGSERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  svix_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'email.sent', 'email.delivered', 'email.bounced', 'email.complained', etc
  email_id TEXT NOT NULL,   -- Resend's message id
  recipient TEXT NOT NULL,
  bounce_type TEXT,         -- 'Permanent', 'Transient', 'Undetermined' for bounced
  bounce_subtype TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, svix_id) -- idempotency via Svix's stable event id
);

ALTER TABLE public.resend_email_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS resend_email_events_email_id_idx
  ON public.resend_email_events (email_id);
CREATE INDEX IF NOT EXISTS resend_email_events_recipient_status_idx
  ON public.resend_email_events (recipient, event_type);

-- For alerting on persistent bounces
CREATE INDEX IF NOT EXISTS resend_email_events_bounces_24h_idx
  ON public.resend_email_events (recipient, occurred_at)
  WHERE event_type = 'email.bounced';

COMMIT;
```

**Webhook:**
```typescript
// supabase/functions/resend-event-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentryScope } from "../_shared/sentry-edge.ts";
import * as Sentry from "https://deno.land/x/sentry/index.mjs";
// Resend's webhook helper isn't on Deno; use Svix's npm:svix or do manual verify
import { Webhook } from "https://esm.sh/svix";

const SVIX_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET")!;
const SHOP_ID = 7476;
const wh = new Webhook(SVIX_SECRET);

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) =>
  withSentryScope(req, "resend-event-webhook", async () => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      Sentry.captureMessage("Resend webhook missing svix headers", "warning");
      return new Response("Missing headers", { status: 401 });
    }

    const rawBody = await req.text();
    let payload: any;
    try {
      payload = wh.verify(rawBody, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch (e) {
      Sentry.captureMessage("Resend webhook signature invalid", "warning");
      return new Response("Invalid signature", { status: 401 });
    }

    const eventType = payload.type; // 'email.bounced', 'email.complained', etc
    const data = payload.data;

    const { error: insertErr } = await sb
      .from("resend_email_events")
      .insert({
        shop_id: SHOP_ID,
        svix_id: svixId,
        event_type: eventType,
        email_id: data.email_id,
        recipient: data.to?.[0] ?? "unknown",
        bounce_type: data.bounce?.type ?? null,
        bounce_subtype: data.bounce?.subType ?? null,
        occurred_at: data.created_at,
        raw_payload: payload,
      });

    if (insertErr && !insertErr.message.includes("duplicate key")) {
      Sentry.captureException(insertErr);
      return new Response("ok", { status: 200 });
    }

    // Alert on persistent bounces: 3+ bounces to same recipient in 24h
    if (eventType === "email.bounced") {
      const { count } = await sb
        .from("resend_email_events")
        .select("id", { count: "exact", head: true })
        .eq("recipient", data.to?.[0])
        .eq("event_type", "email.bounced")
        .gte("occurred_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if ((count ?? 0) >= 3) {
        Sentry.captureMessage("Persistent email bounces", "error", {
          tags: { recipient: data.to?.[0], bounce_type: data.bounce?.type },
        });
      }

      // If the bounce is for a transcript email, flag the row
      const { data: transcript } = await sb
        .from("transcript_emails")
        .select("id, session_id")
        .eq("resend_message_id", data.email_id)
        .single();

      if (transcript) {
        await sb
          .from("transcript_emails")
          .update({ status: "bounced", last_error: `${data.bounce?.type}: ${data.bounce?.subType}` })
          .eq("id", transcript.id);
      }
    }

    return new Response("ok", { status: 200 });
  })
);
```

### Phase 2B — Resend dashboard config

1. Resend dashboard → Webhooks → Add Endpoint: `https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/resend-event-webhook`
2. Subscribe to events: `email.bounced`, `email.complained`, `email.delivered`, `email.sent`, `email.delivery_delayed`
3. Copy the signing secret → set `RESEND_WEBHOOK_SECRET` via `npx supabase secrets set RESEND_WEBHOOK_SECRET=whsec_...`

**Verification:**
1. Send a transcript email to a known-bouncing address (Mailtrap or `simulator-bounce@resend.com`) → expect bounce row in DB
2. Sentry shows 1 warning per bounce; after 3 bounces, shows 1 error

**Risk + rollback:**
- LOW. New function. Disable in Resend dashboard to roll back.

---

## Phase 3 — Tekmetric circuit breaker via Upstash Redis (I-INT-1, ~2 days)

**Goal:** When Tekmetric is having an outage, fail fast (50ms) instead of timing out (15s × every concurrent request × every retry). Provide graceful fallback UX.

### Phase 3A — Distributed circuit breaker

**Files:**
- New `scheduler-app/src/lib/integrations/circuit-breaker.ts`
- New `supabase/functions/_shared/circuit-breaker.ts` (Deno mirror)
- `scheduler-app/src/lib/scheduler/tekmetric/*` (wrap calls)
- `supabase/functions/_shared/tekmetric-client.ts` (wrap calls)

**Code (Node side):**
```typescript
// scheduler-app/src/lib/integrations/circuit-breaker.ts
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

type BreakerState = "closed" | "open" | "half-open";

interface BreakerConfig {
  name: string;
  errorThresholdPercentage: number; // e.g. 50
  resetTimeoutMs: number;           // e.g. 30000
  volumeThreshold: number;          // min calls before opening (e.g. 5)
  timeoutMs: number;                // per-call timeout
  rollingWindowMs: number;          // e.g. 10000
}

const CONFIG: Record<string, BreakerConfig> = {
  tekmetric: {
    name: "tekmetric",
    errorThresholdPercentage: 50,
    resetTimeoutMs: 30_000,
    volumeThreshold: 5,
    timeoutMs: 8000, // Vercel function 10s budget
    rollingWindowMs: 10_000,
  },
};

export async function withCircuitBreaker<T>(
  breakerName: keyof typeof CONFIG,
  fn: () => Promise<T>
): Promise<T | { circuit_open: true }> {
  const cfg = CONFIG[breakerName];

  // 1. Read state from Redis
  const stateKey = `cb:${cfg.name}:state`;
  const state = (await redis.get<BreakerState>(stateKey)) ?? "closed";

  if (state === "open") {
    // Check if reset timeout elapsed
    const openedAt = await redis.get<number>(`cb:${cfg.name}:opened_at`);
    if (openedAt && Date.now() - openedAt > cfg.resetTimeoutMs) {
      // Try to claim half-open slot (single probe)
      const claimed = await redis.set(`cb:${cfg.name}:state`, "half-open", { nx: true, ex: 30 });
      if (!claimed) {
        // Another instance is probing; we fail fast
        return { circuit_open: true } as any;
      }
      // We are the prober; fall through to try the call
    } else {
      return { circuit_open: true } as any;
    }
  }

  // 2. Make the call with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const result = await fn();
    clearTimeout(timeoutId);

    // Success: increment success counter; close if half-open
    await redis.incr(`cb:${cfg.name}:success`);
    if (state === "half-open") {
      await redis.set(stateKey, "closed");
      await redis.del(`cb:${cfg.name}:opened_at`);
    }

    return result;
  } catch (e) {
    clearTimeout(timeoutId);

    // Failure: increment failure counter, check threshold
    const failures = await redis.incr(`cb:${cfg.name}:failure`);
    const successes = (await redis.get<number>(`cb:${cfg.name}:success`)) ?? 0;
    const total = failures + successes;

    if (total >= cfg.volumeThreshold) {
      const errorPct = (failures / total) * 100;
      if (errorPct >= cfg.errorThresholdPercentage) {
        await redis.set(stateKey, "open");
        await redis.set(`cb:${cfg.name}:opened_at`, Date.now());
        // Reset counters
        await redis.del(`cb:${cfg.name}:success`, `cb:${cfg.name}:failure`);
      }
    }

    // Expire counters on a rolling window
    await redis.expire(`cb:${cfg.name}:success`, Math.ceil(cfg.rollingWindowMs / 1000));
    await redis.expire(`cb:${cfg.name}:failure`, Math.ceil(cfg.rollingWindowMs / 1000));

    throw e;
  }
}
```

**Usage:**
```typescript
// scheduler-app/src/lib/scheduler/tekmetric/customer-create.ts
import { withCircuitBreaker } from "@/lib/integrations/circuit-breaker";

const result = await withCircuitBreaker("tekmetric", () =>
  tekmetricFetch("/v1/customers", { method: "POST", body: JSON.stringify(payload) })
);

if ("circuit_open" in result) {
  // Tekmetric breaker open — graceful degradation
  return { ok: false, error: "tekmetric_unavailable", fallback: "callback" };
}
```

### Phase 3B — Graceful fallback UX

**Goal:** When breaker is open, surface a customer-friendly message + offer callback path.

**Files:**
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-summary.ts` (and other actions that POST to Tekmetric)

**Customer copy:**
```
"We're having trouble reaching our booking system right now. Your information is saved — call us at (610) 253-6565 to finish booking, or we'll call you back within an hour."
```

**Action result:**
```typescript
if ("circuit_open" in result) {
  await applyWizardTransition({
    chatId,
    updates: { status: "escalated", escalated_at: new Date().toISOString(), escalation_reason: "tekmetric_outage" },
    assistantBubble: { content: "We're having trouble reaching our booking system... [callback CTA]" },
  });
  return { ok: true, nextStep: "escalated", timestamp: Date.now() };
}
```

### Phase 3C — Queue writes for replay (optional, ~1 day)

For longer outages (>1 hour), queue the write to `tekmetric_outbound_queue` table + drain via cron when Tekmetric recovers.

**Migration:**
```sql
CREATE TABLE IF NOT EXISTS public.tekmetric_outbound_queue (
  id BIGSERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'create_customer', 'create_vehicle', 'post_appointment', etc
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  last_error TEXT,
  drained_at TIMESTAMPTZ,
  drained_appointment_id INTEGER
);
```

**Drain cron:** `0 */15 * * *` (every 15 min) — call edge fn that retries queued writes.

**Decision:** Phase 3C is OPTIONAL. Start with breaker + fallback UX. Add queue if real outages show customers losing data.

**Verification:**
1. Force the breaker open by setting `cb:tekmetric:state` to `open` in Redis → next wizard summary submit returns `tekmetric_unavailable`
2. Wait 30 seconds → next request triggers half-open probe; if Tekmetric is healthy, breaker closes
3. Simulate Tekmetric outage (block in DNS) → after 5 failures, breaker opens; rest of requests fail fast

**Risk + rollback:**
- MEDIUM. Customer-visible UX change. Test with Chris before deploying.
- Rollback: remove `withCircuitBreaker` calls; restore direct fetch.

---

## Phase 4 — Exponential backoff for Telnyx send (I-INT-4, ~4 hours)

**Goal:** Retry transient Telnyx send failures (408/429/5xx) with exponential backoff before consuming the OTP slot.

**Files:**
- `supabase/functions/_shared/tools/scheduler-otp.ts:159-188` (the Telnyx send path)

**Approach:** Use `p-retry`-like pattern adapted for Deno (or vendor the small helper).

**Code:**
```typescript
// _shared/scheduler-otp.ts (new helper)
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries: number;     // 3
    minTimeout: number;  // 200
    maxTimeout: number;  // 2000
    factor: number;      // 2
    shouldRetry: (err: any) => boolean;
  }
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      attempt++;
      if (attempt > options.retries || !options.shouldRetry(e)) {
        throw e;
      }
      const baseDelay = Math.min(options.maxTimeout, options.minTimeout * Math.pow(options.factor, attempt - 1));
      const jitter = 0.5 + Math.random(); // 0.5 to 1.5
      const delay = Math.floor(baseDelay * jitter);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// In sendViaTelnyx:
const result = await withRetry(
  async () => {
    const res = await fetch(TELNYX_API_URL, { /* ... */ });
    if (!res.ok) {
      const err = new Error(`Telnyx ${res.status}`);
      (err as any).status = res.status;
      (err as any).body = await res.text();
      throw err;
    }
    return res.json();
  },
  {
    retries: 3,
    minTimeout: 200,
    maxTimeout: 2000,
    factor: 2,
    shouldRetry: (e) => {
      const s = (e as any).status;
      // Retry on transient: timeouts, 429, 5xx
      if (!s) return true; // network error
      if (s === 408 || s === 429) return true;
      if (s >= 500 && s < 600) return true;
      return false;
    },
  }
);
```

**Verification:**
1. Mock Telnyx to return 429 twice then 200 → succeeds on 3rd attempt
2. Mock to return 422 (invalid number) → fails immediately (no retry on 4xx-validation)
3. Mock to return 5xx 4 times → fails after 3 retries

**Risk + rollback:**
- LOW. Additive. Worst case: an OTP send takes a bit longer.
- Telnyx transient error codes (40006, 40008) — add explicit handling per research.

---

## Sequence with other plans

- **Plan 01 Phase 1A (edge fn auth)** preferred first — the bearer-check pattern for new webhook receivers.
- **Plan 01 Phase 3 (CI)** preferred first — so the new webhook fns get tests in CI.
- Independent of Plans 02, 03, 04, 06.

## Open questions for Chris

1. **Telnyx public key:** copy from Telnyx dashboard → set as `TELNYX_PUBLIC_KEY_BASE64` env var
2. **Resend webhook secret:** add new webhook in Resend → copy signing secret → set as `RESEND_WEBHOOK_SECRET`
3. **Upstash Redis account:** need to provision OR use existing keytag system's Redis (does that exist?). Verify `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars
4. **Queue-for-replay (Phase 3C):** ship now or wait for first real outage?
5. **Fallback UX wording:** wordsmith the "we're having trouble reaching" message before deploying

## Success criteria

- [ ] Telnyx delivery webhook fires events into `telnyx_message_events` table
- [ ] Delivery failure (carrier reject) reclaims the OTP slot + alerts Sentry
- [ ] Resend bounce/complaint webhook updates `transcript_emails.status` + alerts on persistent bounces
- [ ] Tekmetric breaker opens after 5 consecutive failures + 50% error rate
- [ ] Half-open probe restores breaker on successful retry
- [ ] When breaker is open, customers see "call us / we'll call you back" with no spinning
- [ ] Telnyx send retries transient failures up to 3x with exponential backoff before consuming OTP slot

**Estimated effort:** 5-6 days.

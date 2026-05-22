---
schema_version: "2.0"
agent: research-integration-robustness
tier: "01-research"
timestamp: "2026-05-22T16:00:00Z"
module_slug: null
module_short_code: null
module_number: null
run_id: null
parent_artifacts: []
sources_cited:
  - "https://github.com/nodeshift/opossum"
  - "https://www.npmjs.com/package/opossum"
  - "https://dev.to/axiom_agent/nodejs-circuit-breaker-pattern-in-production-opossum-fallbacks-and-resilience-engineering-1mj4"
  - "https://1xapi.com/blog/resilient-api-circuit-breaker-bulkhead-retry-nodejs-2026"
  - "https://developers.redhat.com/articles/2021/09/15/nodejs-circuit-breakers-serverless-functions"
  - "https://medium.com/@mdminhajgdr/building-a-distributed-circuit-breaker-in-node-js-with-redis-ed40852101cc"
  - "https://oneuptime.com/blog/post/2026-01-21-redis-circuit-breaker/view"
  - "https://upstash.com/docs/redis/overall/getstarted"
  - "https://github.com/upstash/redis-js"
  - "https://supabase.com/docs/guides/functions/examples/upstash-redis"
  - "https://github.com/netflix/hystrix/wiki/how-it-works"
  - "https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks"
  - "https://github.com/hypnoticproductions/telnyx-webhook"
  - "https://developers.telnyx.com/docs/v1/messaging/webhooks/inbound-message-signature"
  - "https://developers.telnyx.com/docs/messaging/10dlc/quickstart"
  - "https://telnyx.com/resources/10dlc-brand-registration"
  - "https://support.telnyx.com/en/articles/6325747-10dlc-trust-scores-use-cases"
  - "https://tuco.ai/a2p-10dlc"
  - "https://support.telnyx.com/en/articles/6505121-telnyx-messaging-error-codes"
  - "https://resend.com/docs/webhooks/introduction"
  - "https://resend.com/docs/dashboard/webhooks/event-types"
  - "https://resend.com/docs/dashboard/emails/email-bounces"
  - "https://docs.svix.com/receiving/verifying-payloads/how-manual"
  - "https://resend.com/docs/dashboard/domains/dmarc"
  - "https://dev.to/whoffagents/email-deliverability-for-saas-spf-dkim-dmarc-setup-and-resend-integration-1hpd"
  - "https://www.npmjs.com/package/exponential-backoff"
  - "https://github.com/lifeomic/attempt"
  - "https://dev.to/young_gao/retry-patterns-that-actually-work-exponential-backoff-jitter-and-dead-letter-queues-75"
  - "https://oneuptime.com/blog/post/2026-01-06-nodejs-retry-exponential-backoff/view"
  - "https://stripe.com/blog/idempotency"
  - "https://docs.stripe.com/api/idempotent_requests"
  - "https://brandur.org/idempotency-keys"
  - "https://brandur.org/fragments/is-transient"
  - "https://status.tekmetric.com/"
  - "https://isdown.app/status/tekmetric/api"
  - "https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html"
  - "https://sre.google/sre-book/addressing-cascading-failures/"
  - "https://isdown.app/blog/how-to-reduce-mttr-when-third-party-services-go-down"
  - "https://vercel.com/docs/ai-gateway"
  - "https://vercel.com/docs/ai-gateway/models-and-providers/provider-options"
  - "https://vercel.com/docs/ai-gateway/capabilities/observability"
  - "https://nerdleveltech.com/mastering-vercel-ai-sdk-v6-building-smarter-scalable-ai-apps"
status: "complete"
open_questions:
  - "Resend's exact JSON payload for email.complained event was not retrievable directly. Recommend confirming bounce.subType field structure via a live test webhook before relying on specific subType values."
  - "Telnyx's idempotency-key header is documented in v1 but v2 SMS API uses standard request IDs. Confirm 2026 behavior via Telnyx support before adopting."
  - "Tekmetric does not publish an SLA or status webhook subscription path for partner integrators. Status page is read-only HTML scrape."
next_tier_consumers:
  - "orchestrator (adapts findings into implementation plans separately)"
---

# Integration Robustness — Research Findings

> Eight topics. Best-practice patterns, vendor specifics, gotchas, code examples.
> No implementation plans here — pure research feedstock for the orchestrator.

---

## 1. Circuit Breaker Patterns — opossum (Node) + Upstash Redis (Deno-compatible)

### Summary

`opossum` 9.x (June 2025+) is the de-facto Node.js circuit breaker (maintained by the Node.js Foundation's nodeshift team). It tracks success/failure counts in a **rolling time window** (not cumulative) — a service that failed an hour ago but is healthy now naturally heals. However, on Vercel serverless (Node 24.x), opossum's in-memory state is **per-instance**, which is the fundamental anti-pattern: "At 50 concurrent invocations you don't have one circuit breaker watching 50 calls. You have 50 circuit breakers each watching one call." This applies equally to Vercel Fluid compute — when functions scale to zero, breaker state is lost.

For our Deno edge functions (Supabase), opossum is unusable (Node-only). The unified pattern across Vercel + Deno is: **Upstash Redis as a distributed counter** holding circuit state. Upstash works over HTTP/REST (not TCP), which is required for both Vercel Edge Functions and Deno Deploy/Supabase Edge — environments where persistent TCP connections aren't viable.

### Production opossum configuration (2026 baseline)

From the most-cited 2026 production write-up (axiom_agent on dev.to):

```typescript
import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(callTekmetric, {
  timeout: 3000,                  // 3s — below Vercel's 15s function timeout
  errorThresholdPercentage: 50,   // 50% failure rate trips open
  resetTimeout: 30000,            // 30s before HALF_OPEN probe
  rollingCountTimeout: 10000,     // 10s rolling window
  rollingCountBuckets: 10,        // 10 buckets of 1s each
  volumeThreshold: 5,             // do not open until 5+ requests sampled
  errorFilter: (err) => err.code === 'AbortError', // ignore client-cancels
});

breaker.fallback((shopId) => ({
  ok: false,
  degraded: true,
  source: 'fallback',
  retryAfter: 30,
}));

breaker.on('open',   () => Sentry.captureMessage('tekmetric circuit opened', 'warning'));
breaker.on('close',  () => Sentry.captureMessage('tekmetric circuit closed', 'info'));
breaker.on('halfOpen', () => Sentry.captureMessage('tekmetric circuit half-open probe', 'info'));
```

**Threshold tuning notes:** Payment-grade services use 30 percent (stricter); general API integration sits at 50 percent (default). Netflix Hystrix's production default is 50 percent over a 10s window, same as opossum. `volumeThreshold` is critical for cold starts — without it, the first failed request out of 1 would trip the circuit at 100 percent error rate.

### Upstash Redis distributed circuit breaker (canonical shape)

```typescript
// Works in both Deno (supabase functions) and Node (Vercel)
// Uses @upstash/redis HTTP client - no TCP required
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

async function fireWithBreaker<T>(
  key: string,           // e.g. 'cb:tekmetric'
  call: () => Promise<T>,
  opts = { failThreshold: 5, openTtlSec: 30, windowSec: 60 }
): Promise<T | { degraded: true }> {
  const state = await redis.get<CircuitState>(`${key}:state`) ?? 'CLOSED';

  if (state === 'OPEN') {
    return { degraded: true };  // fail fast
  }
  // HALF_OPEN allows exactly one probe — we use SETNX to claim it
  if (state === 'HALF_OPEN') {
    const claimedProbe = await redis.set(`${key}:probe`, '1', { nx: true, ex: 5 });
    if (!claimedProbe) return { degraded: true };
  }

  try {
    const result = await call();
    if (state === 'HALF_OPEN') {
      // success — close the circuit
      await redis.multi()
        .set(`${key}:state`, 'CLOSED')
        .del(`${key}:failures`)
        .exec();
    }
    return result;
  } catch (err) {
    const failures = await redis.incr(`${key}:failures`);
    await redis.expire(`${key}:failures`, opts.windowSec);
    if (failures >= opts.failThreshold) {
      await redis.set(`${key}:state`, 'OPEN', { ex: opts.openTtlSec });
      // After openTtlSec, key naturally expires → next read returns null → CLOSED.
      // Better: when key expires, write HALF_OPEN.
    }
    throw err;
  }
}
```

The shape: state in a string key (TTL-driven), failure counter as INCR with windowed expiry, HALF_OPEN claim via SETNX so only one in-flight probe is allowed across all instances.

### Half-Open Recovery Semantics

When the breaker is OPEN and `resetTimeout` elapses, it transitions to HALF_OPEN. **Exactly one request** is allowed through (in distributed form: SETNX claim). If that probe succeeds, the breaker closes; if it fails or times out, it re-opens for another `resetTimeout` cycle. Netflix Hystrix's default is the same; Hystrix additionally allows tuning the half-open probe interval.

### Fallback UX patterns

The opossum fallback function receives the same arguments as the wrapped action. Three patterns proven in production:

1. **Queue for async retry** — enqueue payload to Supabase table (`integration_retry_queue`) for a cron job to drain when the circuit closes
2. **Safe defaults with degraded signal** — return `{ ok: false, degraded: true, source: 'fallback' }` so callers can render a banner
3. **Failover to alternative** — `primaryDB.fallback((q) => queryReplica(q))` (not applicable to our stack — Tekmetric has no failover)

### Production case studies referenced

Netflix Hystrix (origin of the pattern, now archived but its semantics live on in opossum/Resilience4j). Stripe uses circuit breakers + idempotency keys + exponential backoff as the composed pattern.

### Sources

- [nodeshift/opossum on GitHub](https://github.com/nodeshift/opossum)
- [opossum on npm](https://www.npmjs.com/package/opossum)
- [Node.js Circuit Breaker Pattern in Production (dev.to)](https://dev.to/axiom_agent/nodejs-circuit-breaker-pattern-in-production-opossum-fallbacks-and-resilience-engineering-1mj4)
- [Node.js circuit breakers for serverless functions (Red Hat)](https://developers.redhat.com/articles/2021/09/15/nodejs-circuit-breakers-serverless-functions)
- [Building a Distributed Circuit Breaker in Node.js with Redis (Medium)](https://medium.com/@mdminhajgdr/building-a-distributed-circuit-breaker-in-node-js-with-redis-ed40852101cc)
- [Hystrix Wiki - How It Works](https://github.com/netflix/hystrix/wiki/how-it-works)

---

## 2. Telnyx Delivery-Status Webhook

### Summary

Telnyx fires three primary SMS webhook events:

- **`message.received`** — inbound SMS/MMS arrives
- **`message.sent`** — outbound message accepted by carrier (NOT yet delivered)
- **`message.finalized`** — outbound message reached terminal state (delivered, failed, etc.)

**Critical ordering caveat:** `message.finalized` may arrive **before** `message.sent`. Logic must be agnostic to arrival order — use `data.occurred_at` ISO-8601 timestamp inside the payload to sequence.

### Status field semantics (`to[].status`)

The `to[].status` field on `message.finalized` carries the terminal outcome:

| Status | Meaning |
|---|---|
| `queued` | Message queued on Telnyx infra |
| `sending` | Being transmitted to upstream carrier |
| `sent` | Carrier accepted (mid-flight) |
| `delivered` | Carrier confirmed receipt by recipient handset |
| `sending_failed` | Telnyx-to-carrier handoff failed |
| `delivery_failed` | Carrier-to-recipient delivery failed |
| `delivery_unconfirmed` | No DLR received (no carrier confirmation, but no explicit failure) |
| `webhook_delivered` | Webhook delivered (not a message status — internal) |

The state to treat as **success for OTP slot accounting** is `delivered`. The states to treat as **failures that should NOT consume the OTP-per-hour slot** are `sending_failed`, `delivery_failed`, and `delivery_unconfirmed` (carrier silently dropped). Reclaiming the slot is module-level business logic.

### Ed25519 signature verification

Telnyx API v2 webhooks (which all 2026 SMS webhooks use) sign with **EdDSA / Ed25519**, NOT HMAC-SHA256 (that's v1 — sunset). Headers:

- `telnyx-signature-ed25519` — base64-encoded Ed25519 signature
- `telnyx-timestamp` — Unix timestamp (seconds)

The signed payload is the concatenation `"{timestamp}|{raw_json_body}"` (pipe-delimited). Public key is fetched from Mission Control Portal → Keys & Credentials → Public Key (single key per messaging profile).

```typescript
// Reference impl (works in Deno + Node 24)
import nacl from 'tweetnacl';
import { decodeBase64 } from 'tweetnacl-util';

function verifyTelnyxWebhook(
  rawBody: string,
  signatureB64: string,
  timestampUnix: string,
  publicKeyB64: string,
): boolean {
  // Reject replays >5min old
  const ageSec = Math.floor(Date.now() / 1000) - parseInt(timestampUnix, 10);
  if (ageSec > 300 || ageSec < -60) return false;

  const signedPayload = `${timestampUnix}|${rawBody}`;
  return nacl.sign.detached.verify(
    new TextEncoder().encode(signedPayload),
    decodeBase64(signatureB64),
    decodeBase64(publicKeyB64),
  );
}
```

### Replay attack prevention

Reject webhooks where `telnyx-timestamp` is more than **5 minutes (300 seconds)** old — the documented Telnyx tolerance window. Also reject negative-age (clock skew >60s in the future).

### Sample finalized payload shape

```json
{
  "data": {
    "event_type": "message.finalized",
    "id": "<event-uuid>",
    "occurred_at": "2026-05-22T15:00:00.123Z",
    "record_type": "event",
    "payload": {
      "id": "<message-uuid>",
      "to": [
        { "phone_number": "+15551234567", "status": "delivered", "carrier": "Verizon" }
      ],
      "from": { "phone_number": "+15559876543" },
      "received_at": "2026-05-22T14:59:55Z",
      "sent_at": "2026-05-22T14:59:56Z",
      "completed_at": "2026-05-22T15:00:00Z"
    }
  },
  "meta": { "attempt": 1, "delivered_to": "https://your-endpoint.com/webhooks" }
}
```

### Gotchas

- 2-second response budget: Telnyx requires `2xx` within 2 seconds or it retries (up to 3 attempts per URL).
- v1 webhooks (HMAC) are sunset — confirm you're on v2 endpoints.
- Production webhook handler reference: [hypnoticproductions/telnyx-webhook](https://github.com/hypnoticproductions/telnyx-webhook) (Ed25519 + Resend notifications combo).
- Signature verification MUST run on the **raw body** before any JSON parsing — re-serialization changes byte order and breaks the signature.

### Sources

- [Receiving Webhooks for Messaging - Telnyx Developers](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)
- [hypnoticproductions/telnyx-webhook (production-ready handler)](https://github.com/hypnoticproductions/telnyx-webhook)
- [Inbound Message Signature - Telnyx Developer Documentation](https://developers.telnyx.com/docs/v1/messaging/webhooks/inbound-message-signature)
- [How to Leverage Webhooks - Telnyx Help Center](https://support.telnyx.com/en/articles/4334722-how-to-leverage-webhooks)

---

## 3. Resend `email.bounced` / `email.complained` Webhook

### Summary

Resend uses **Svix** as its webhook delivery infrastructure (same provider Clerk, Plaid, and others use). The signing mechanism is **HMAC-SHA256** keyed on the webhook's signing secret (the part after `whsec_` prefix). Three headers carry the signature:

- `svix-id` — unique event delivery ID (use for dedup, at-least-once semantics)
- `svix-timestamp` — Unix timestamp
- `svix-signature` — `v1,<base64-hmac-sha256>` (may have multiple comma-separated values during key rotation)

The signed payload is `{svix-id}.{svix-timestamp}.{raw_body}` (period-delimited).

### Event types

Resend supports **12 email events** (per-recipient delivery split was added 2025 — each recipient now gets its own event):

`email.bounced`, `email.clicked`, `email.complained`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.opened`, `email.received`, `email.scheduled`, `email.sent`, `email.suppressed`, plus domain (3) and contact (3) events.

### Bounce types and subtypes

Resend normalizes bounces to SES-style categories:

- **`Permanent`** (hard) — recipient address invalid; immediately suppress
  - Subtypes: `General`, `NoEmail`, `Suppressed`, `OnAccountSuppressionList`
- **`Transient`** (soft) — retry-able; suppress after N consecutive
  - Subtypes: `General`, `MailboxFull`, `MessageTooLarge`, `ContentRejected`, `AttachmentRejected`
- **`Undetermined`** — bounce occurred but reason unparseable; treat as soft

### Bounced payload shape

```json
{
  "type": "email.bounced",
  "created_at": "2026-05-22T15:00:00.000Z",
  "data": {
    "broadcast_id": "<uuid>",
    "email_id": "<uuid>",
    "from": "Acme <service@jeffsautomotive.com>",
    "to": ["customer@example.com"],
    "subject": "Your transcript",
    "template_id": "<uuid>",
    "bounce": {
      "message": "550 5.1.1 The email account does not exist",
      "subType": "General",
      "type": "Permanent"
    },
    "tags": [{ "name": "kind", "value": "transcript" }]
  }
}
```

### Retry / delivery semantics

Resend retries failed webhook deliveries at: **5s, 5min, 30min, 2h, 5h, 10h** — at-least-once. The handler MUST be idempotent via `svix-id` dedup. Store processed IDs (e.g., in `webhook_events` keyed on `(provider='resend', event_id=svix-id)`) and skip duplicates.

### Persistent-bounce alerting

Pattern: count `Permanent` bounces in a rolling 24h window keyed on `(shop_id, from_address)`. At threshold >=3, raise a `Sentry.captureMessage(..., 'warning')` and flag the sending domain for human review (DKIM/SPF may be drifting). `email.complained` events should ALWAYS be Sentry-tagged + the recipient added to the shop's internal suppression list immediately.

### DMARC / SPF / DKIM for `service@jeffsautomotive.com`

In 2026, Google, Yahoo, and Microsoft **reject at SMTP** any unauthenticated mail from domains sending more than 5000/day. Resend's verified-domain flow auto-handles SPF + DKIM; DMARC requires a separate DNS TXT record:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@jeffsautomotive.com; pct=100; adkim=s; aspf=s
```

Use `-all` (hard fail) in SPF, NOT `~all` (soft fail). Strict alignment (`s` not `r`) prevents subdomain spoofing. Monitor the dmarc-reports inbox for failures.

### Gotchas

- The Svix HMAC compares on the FULL `whsec_<base64>` secret minus prefix; many implementations strip the prefix incorrectly.
- Multiple signatures in `svix-signature` mean rotation is in progress — verify against all space-delimited versions; pass if ANY match.
- `email.delivered` only means delivered to recipient's mail server, NOT to inbox (could be in spam). For real delivery quality, watch the complaint+bounce ratio over time on the Resend reputation dashboard.

### Sources

- [Managing Webhooks - Resend](https://resend.com/docs/webhooks/introduction)
- [Event Types - Resend](https://resend.com/docs/dashboard/webhooks/event-types)
- [Email Bounces - Resend](https://resend.com/docs/dashboard/emails/email-bounces)
- [Verifying Webhooks Manually - Svix Docs](https://docs.svix.com/receiving/verifying-payloads/how-manual)
- [Implementing DMARC - Resend](https://resend.com/docs/dashboard/domains/dmarc)
- [Email Deliverability for SaaS: SPF, DKIM, DMARC Setup and Resend Integration](https://dev.to/whoffagents/email-deliverability-for-saas-spf-dkim-dmarc-setup-and-resend-integration-1hpd)

---

## 4. Tekmetric A2P 10DLC Registration Status

### Summary

**Unregistered A2P 10DLC SMS traffic is permanently blocked as of February 4, 2025** — not throttled, fully blocked. Carriers (AT&T, T-Mobile, Verizon) coordinate through TCR (The Campaign Registry) and require every 10-digit-long-code sender to be registered. The previous "filtering + pass-through fees" tier is gone.

For shops sending OTP SMS (which is what Jeff's-app does), the registration applies to **Telnyx as the carrier**, not Tekmetric. The Tekmetric question in the request is a misdirection — Tekmetric does not send SMS via 10DLC for our flows; Telnyx does. The registration must be Jeff's Automotive's brand + a campaign on Telnyx's TCR integration.

### TCR Trust Score (0-100)

Every brand registered through TCR gets a **Trust Score** in [0, 100]. The score directly governs **MPS (messages per second) throughput** the carriers will permit. Score factors:

- Business age + size
- Online presence + reputation
- EIN verification accuracy
- Industry vertical classification
- Domain age + WHOIS history
- Lawsuit/regulatory history (enhanced vetting only)

| Score Range | Interpretation |
|---|---|
| 75-100 | High trust — high throughput, low filtering |
| 50-74 | Standard trust — moderate throughput |
| <50 | Low trust — heavy filtering, low throughput |

**Enhanced Vetting** (~$40 fee) is a deeper review that can move a brand from the 1-49 band into 75-100 in a single step, but there's no guarantee. Worth doing for any production transactional SMS use case.

### Campaign Use Cases (Telnyx auto-categorizes)

Of the 10 documented categories, the ones relevant to our wizard:

- **`2FA`** — two-factor authentication (OUR OTP send fits here)
- **`CUSTOMER_CARE`** — support/service messaging
- **`ACCOUNT_NOTIFICATION`** — account alerts (transcript-ready notifications could fit here, but transcript is email — N/A for SMS)

OTP SMS for verification on the wizard flow is unambiguously `2FA`. Telnyx's TCR integration auto-applies the highest-throughput template for `2FA` campaigns.

### How to verify registration status via API

```
GET https://api.telnyx.com/v2/10dlc/brand/{brandId}
GET https://api.telnyx.com/v2/10dlc/campaign/{campaignId}
GET https://api.telnyx.com/v2/10dlc/phoneNumberCampaign?phone_number={e164}
```

A `status` field of `REGISTERED` (campaign) + `VETTED` (brand) plus a non-null Trust Score = good. `PENDING` or `FAILED` = traffic will be blocked.

### Registration flow

1. **Create Brand** — `POST /v2/10dlc/brand` (instant)
2. **Vet Brand** — `POST /v2/10dlc/brand/{brandId}/vetting` (1-7 business days; **+ Enhanced Vetting** recommended)
3. **Create Campaign** — `POST /v2/10dlc/campaignBuilder` with use case `2FA` (instant; carrier approval pending up to 7 days)
4. **Assign Numbers** — `POST /v2/10dlc/phoneNumberCampaign` linking numbers to the campaign

### Gotchas

- Sole proprietors get a special simplified registration path — but throughput is capped at 1000 messages/24h regardless of Trust Score.
- Re-vetting a brand resets the Trust Score; only vet once per year unless score is below 50.
- Carriers can reject a campaign for reasons that aren't surfaced clearly — auto-retry is NOT recommended.
- Sample messages in the campaign registration MUST match real production traffic — if you send messages that don't match the registered samples, carrier filtering kicks in.

### Sources

- [Compliant 10DLC brand registration in 6 easy steps - Telnyx](https://telnyx.com/resources/10dlc-brand-registration)
- [A2P 10DLC in 2026: What It Costs, Who Needs It (Tuco AI)](https://tuco.ai/a2p-10dlc)
- [Getting Started with 10DLC - Telnyx Developers](https://developers.telnyx.com/docs/messaging/10dlc/quickstart)
- [10DLC: Trust Scores & Use Cases - Telnyx Help Center](https://support.telnyx.com/en/articles/6325747-10dlc-trust-scores-use-cases)
- [Creating 10DLC Brands and Campaigns for A2P Messaging](https://developers.telnyx.com/docs/v2/messaging/10dlc)

---

## 5. Exponential Backoff for Transient SMS / API Failures

### Summary

Two libraries dominate 2026 Node retry practice: `p-retry` (Sindre Sorhus, used by Vercel internally) and `@lifeomic/attempt`. Both implement the canonical exponential-backoff-with-jitter pattern. For our Vercel function timeout budget (15s default), the rule of thumb is **2-3 retries max, total wait <10s** before escalating to fallback.

### Canonical formula (with jitter)

```
delay_ms = min(maxDelay, baseDelay * 2 ^ attempt) * jitter
jitter   = 0.5 + Math.random()   // "full jitter" or "decorrelated jitter"
```

For Telnyx SMS send (the immediate use case): **base=200ms, factor=2, max=2000ms, attempts=3**.

```
attempt 1: 200ms  * (0.5..1.5) = 100..300ms
attempt 2: 400ms  * (0.5..1.5) = 200..600ms
attempt 3: 800ms  * (0.5..1.5) = 400..1200ms
total worst case: ~2100ms before escalating to fallback (well under 15s Vercel budget)
```

### Why jitter

Without jitter, every client retrying on the same incident converges on the same retry times (the "thundering herd"). 50 clients all retrying at exactly 200ms, 400ms, 800ms compounds load on a service already struggling. Even +/-100-300ms of randomization eliminates the herd.

### Reference implementation with p-retry

```typescript
import pRetry, { AbortError } from 'p-retry';

await pRetry(
  async () => {
    const res = await sendTelnyxOTP(payload);
    if (res.status === 400 || res.status === 401) {
      // Do not retry permanent errors — abort
      throw new AbortError(`Telnyx ${res.status}: ${res.error}`);
    }
    if (!res.ok) throw new Error(`Telnyx transient: ${res.status}`);
    return res;
  },
  {
    retries: 3,
    factor: 2,
    minTimeout: 200,
    maxTimeout: 2000,
    randomize: true,  // applies 1x to 2x jitter
    onFailedAttempt: (err) => {
      Sentry.addBreadcrumb({
        category: 'telnyx-retry',
        message: `attempt ${err.attemptNumber} failed: ${err.message}`,
        level: 'warning',
      });
    },
  },
);
```

### Retry vs escalate — status code rules

| HTTP Code | Retry? | Why |
|---|---|---|
| 408, 429, 500, 502, 503, 504 | YES | Transient |
| 400, 401, 403, 404, 422 | NO | Permanent — won't change on retry |
| Network errors (ECONNRESET, ETIMEDOUT) | YES | Transient |

For Telnyx specifically: error codes **40006, 40008** are transient (retry); **40001, 40003, 40010, 40300, 40314, 40322** are permanent (escalate, don't burn OTP slot).

### Idempotency + retry composition

When retrying, REUSE the same Idempotency-Key (don't generate a new one per attempt). Otherwise duplicate requests with different keys will each be processed. See Topic 6 for key construction.

### Gotchas

- `p-retry` counts the first call as attempt 1, not 0. `retries: 3` = total 4 calls.
- Don't retry on `AbortController` errors — that's caller intent to cancel.
- The `onFailedAttempt` callback runs synchronously and blocks the retry — keep it fast (Sentry breadcrumb is fine; full Sentry capture is not).
- Vercel function timeout is per-invocation, NOT per-retry. A 3-retry chain that takes 2s + 2s + 4s = 8s leaves 7s for the rest of the handler.

### Sources

- [How to Implement Retry Logic with Exponential Backoff in Node.js (OneUptime)](https://oneuptime.com/blog/post/2026-01-06-nodejs-retry-exponential-backoff/view)
- [Retry Patterns That Work: Exponential Backoff, Jitter, and Dead Letter Queues (2026)](https://dev.to/young_gao/retry-patterns-that-actually-work-exponential-backoff-jitter-and-dead-letter-queues-75)
- [exponential-backoff on npm](https://www.npmjs.com/package/exponential-backoff)
- [lifeomic/attempt on GitHub](https://github.com/lifeomic/attempt)
- [Telnyx Messaging Error Codes](https://support.telnyx.com/en/articles/6505121-telnyx-messaging-error-codes)

---

## 6. Idempotency-Key Best Practices Across Integrations

### Summary

The canonical model is Stripe's, dating to 2017 and now adopted by Resend, AWS SDK, and many others (Svix's webhook delivery uses the same semantics in reverse). The contract:

1. Client generates a key (UUID v4 or composed string with sufficient entropy)
2. Client sends `Idempotency-Key: <key>` header with the request
3. Server caches the response (status code + body) keyed on `<key>`
4. If client retries with the same key, server returns the cached response (no re-execution)
5. If client retries with the same key + different params, server returns an error (mismatch — protects against accidental misuse)
6. Server prunes keys after some retention period (Stripe: 24h)

### Key construction

Three valid strategies, each with tradeoffs:

| Strategy | Format example | When to use |
|---|---|---|
| Pure UUID v4 | `7c8a4d9e-...` | Default, max entropy, no semantic meaning |
| Business-domain composed | `transcript:session_42:v1` | Action is bound to a business entity that is naturally idempotent |
| Action + entity + timestamp bucket | `staff_notif:session_42:2026-05-22T15` | Multiple safe re-sends within a time bucket |

**Avoid:** sensitive data (emails, phone numbers), pure timestamps (collisions on burst), unbounded length (Stripe caps at 255 chars).

### Per-vendor retention + behavior (2026)

| Vendor | Header | Retention | Conflict semantics |
|---|---|---|---|
| Stripe | `Idempotency-Key` | 24h minimum | 400 error on same key + different params |
| Resend | `Idempotency-Key` | 24h documented | Returns original response on match |
| Telnyx | Not in v2 docs (was v1) | Unknown — confirm via support | TBD |
| Tekmetric | Not documented | Use request-level dedup via our `webhook_events` table | N/A |
| Anthropic (via Gateway) | Built-in via Gateway request ID | Per Gateway | Gateway handles |

### Composing keys for our flows

Recommended composition pattern for jeffs-app-v2:

```
<action_kind>:<business_entity_id>[:<version>]

Examples:
  transcript:session_42                     ← already implemented
  staff_notif:session_42                    ← add for parity
  otp_send:session_42:attempt_1             ← attempt suffix when retrying explicit attempts
  tekmetric_post:repair_order_123:v1        ← Tekmetric outbound mutations
```

The `attempt_N` suffix on OTP send is intentional: each OTP "attempt" the user makes is genuinely a new request (resend after typo); but the underlying Telnyx send within that attempt should reuse the same key across retries.

### Multi-vendor strategy when provider doesn't support Idempotency-Key

For Tekmetric (which doesn't document an Idempotency-Key header), implement **request-side dedup** via a Supabase table:

```sql
CREATE TABLE integration_request_dedup (
  request_key TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  request_payload_hash TEXT NOT NULL,
  response_status INT,
  response_body JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON integration_request_dedup (vendor, created_at DESC);
-- TTL via pg_cron: DELETE WHERE created_at < now() - INTERVAL '24 hours';
```

Wrap the Tekmetric call: lookup by `request_key`; if present + payload hash matches, return cached response; else execute + insert.

### Brandur's `is_transient` insight

When a request fails with a TRANSIENT error (network blip, 503, etc.), the idempotency record should be DELETED so retry can re-execute. Otherwise the next retry returns the cached transient failure response, which is worse than just retrying. Pattern:

```typescript
const result = await call();
if (result.error && result.is_transient) {
  await redis.del(`idem:${key}`);  // allow re-execution on next retry
}
```

### Sources

- [Designing robust and predictable APIs with idempotency (Stripe Blog)](https://stripe.com/blog/idempotency)
- [Idempotent requests - Stripe API Reference](https://docs.stripe.com/api/idempotent_requests)
- [Implementing Stripe-like Idempotency Keys in Postgres (brandur.org)](https://brandur.org/idempotency-keys)
- [Idempotency: The `is_transient` property (brandur.org)](https://brandur.org/fragments/is-transient)
- [Idempotency and Retry Logic (stripe/stripe-node DeepWiki)](https://deepwiki.com/stripe/stripe-node/3.5-idempotency-and-retry-logic)

---

## 7. Tekmetric Outage / Fallback UX

### Summary

Tekmetric's last reported outage was April 8 and April 14, 2026 — "Latency in production environment" — with median incident duration of 53 minutes (6 incidents in 90 days; 4 major, 2 minor). Webhook uptime is 100 percent over 90 days; the integration API itself is 99.98 percent. The realistic worst-case planning horizon is a **1-3 hour outage**.

Tekmetric does NOT publish a status webhook for partner integrators — you must poll `status.tekmetric.com` (HTML) or use a third-party status aggregator (IsDown, StatusGator). This is a structural limitation; the integration cannot "subscribe" to learn of outages — it discovers them via its own failures (which is exactly what the circuit breaker is for).

### "Read-mostly fallback" pattern

Per Google SRE Book on cascading failures + AWS Well-Architected REL05-BP01 graceful-degradation pattern: transform **hard dependencies** into **soft dependencies** where possible. For our flows:

| Flow | Hard dep on Tekmetric? | Fallback option |
|---|---|---|
| Wizard reads existing customer | Soft — Supabase mirror is cached daily | Serve from Supabase mirror with "data as of" timestamp |
| Wizard reads vehicle history | Soft — same mirror | Serve from Supabase mirror |
| Wizard reads existing RO | Hard — must be current | Queue for replay; show "we'll confirm by SMS in N min" |
| Wizard creates new RO | Hard — must persist authoritatively | Queue for replay; CTA to call shop |
| Customer status updates | Soft — read-only consumer | Show cached + "last updated X min ago" |

### Queueing writes for replay

```sql
CREATE TABLE tekmetric_outbound_queue (
  id BIGSERIAL PRIMARY KEY,
  shop_id UUID NOT NULL,
  action_kind TEXT NOT NULL,           -- e.g., 'create_ro', 'update_customer'
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  enqueued_at TIMESTAMPTZ DEFAULT now(),
  attempted_at TIMESTAMPTZ,
  attempt_count INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|in_flight|completed|failed
  failure_reason TEXT,
  completed_at TIMESTAMPTZ
);
```

A pg_cron job (every minute when circuit is OPEN; every 5 min when CLOSED) drains the queue, respecting the circuit breaker. Failed entries past N attempts move to `tekmetric_outbound_dlq` for human review.

### Honest customer-facing UX patterns

Based on production resilience write-ups (IsDown blog + AWS Reliability Pillar):

**DO:**
- "We're having trouble reaching our system. Your appointment has been saved and we'll confirm by SMS in 5 minutes." (Concrete time + clear save signal)
- Offer alternative contact path: phone callback link, "we'll call you back" form.
- Show service-status banner pulled from `status.tekmetric.com` when known.

**DON'T:**
- "Something went wrong" (vague, panic-inducing)
- Infinite spinner ("the silence makes it worse")
- Generic 500 page (kills trust)

### Cron reconciliation

Already have `appointments-sync` every 10 min. When Tekmetric returns to healthy (circuit closes), the existing sync naturally backfills appointment data. The QUEUE drain (above) handles writes; the SYNC handles reads. Two independent loops, both pg_cron driven.

### Booking-industry references

Cal.com and Calendly are themselves SaaS with their own status pages — but their UX during their OWN outages doesn't help us much (we're the integrator, not the integratee). The more relevant patterns are from OpenTable's "queue-for-replay" behavior on POS integrations and DoorDash's pattern of accepting orders while restaurant POS is down + reconciling on recovery.

### Sources

- [Tekmetric Status](https://status.tekmetric.com/)
- [Is Tekmetric API Down? (IsDown)](https://isdown.app/status/tekmetric/api)
- [How to Reduce MTTR When Third-Party Services Go Down (IsDown blog)](https://isdown.app/blog/how-to-reduce-mttr-when-third-party-services-go-down)
- [Cascading Failures (Google SRE Book)](https://sre.google/sre-book/addressing-cascading-failures/)
- [REL05-BP01 Implement graceful degradation (AWS Well-Architected)](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html)

---

## 8. AI Gateway Model Fallback + 2026 Features

### Summary

Vercel AI Gateway 2026 has matured into a genuine alternative to bespoke routing logic. It bundles: provider routing, model fallback, automatic caching, observability dashboards, BYOK (bring your own key), spend monitoring, and per-request budgets. Zero markup on tokens (same price as direct provider).

### Provider routing options

```typescript
providerOptions: {
  gateway: {
    order: ['bedrock', 'anthropic'],  // try Bedrock first, fall back to Anthropic
    only:  ['bedrock', 'anthropic'],  // only these two (no other providers tried)
    sort:  'cost' | 'ttft' | 'tps',   // rank by cost, latency, or throughput
    caching: 'auto',                  // auto-apply provider-specific caching
  },
},
```

`order` is the explicit priority list. `sort` lets the gateway dynamically rank by metric. They can compose: `only` filters the pool, `sort` ranks within the pool, `order` overrides ranking.

### Model fallback chain

For model-level (NOT provider-level) failover, the AI SDK v6 supports a fallback array:

```typescript
import { generateText } from 'ai';

const { text } = await generateText({
  model: ['anthropic/claude-opus-4.7', 'anthropic/claude-sonnet-4.7', 'openai/gpt-5.5'],
  prompt: 'Diagnose this concern...',
});
// If claude-opus-4.7 fails (rate limit, timeout, error), gateway tries claude-sonnet-4.7,
// then gpt-5.5. Failover is fast — no exponential wait — because the gateway has
// already classified the failure as terminal for that model.
```

This matches our current `diagnose-concern` configuration shape.

### Automatic caching behavior

`caching: 'auto'` applies provider-specific cache markers:
- **Anthropic**: inserts cache-control breakpoints on system prompts and tool definitions (matches the manual `cache_control` annotations)
- **MiniMax**: uses their explicit cache API
- **Others**: provider-default

Cache TTL is per-provider (Anthropic: 5 min for ephemeral, 1 hour for extended); the gateway doesn't override.

### Per-stage routing (the "cheaper Stage 1, better Stage 3" question)

**Not built-in.** The gateway doesn't have a concept of "stages" — that's application logic. To achieve per-stage routing, instantiate different `model: '...'` strings per stage:

```typescript
// Stage 1 — classify intent, low-cost
const stage1 = await generateText({
  model: ['openai/gpt-5.5-mini', 'anthropic/claude-haiku-4.6'],
  prompt: classifyPrompt,
});

// Stage 3 — final diagnosis, high-quality
const stage3 = await generateText({
  model: ['anthropic/claude-opus-4.7', 'anthropic/claude-sonnet-4.7'],
  prompt: diagnosisPrompt,
});
```

The Gateway does this transparently — no extra infrastructure.

### Observability

The dashboard shows: per-request logs, token counts (prompt + completion + cache hit/miss), time-to-first-token (TTFT), tokens-per-second (TPS), and per-model spend over time. Filterable by tags (passed via `experimental_telemetry` in AI SDK v6). For our app: tag every call with `shop_id`, `feature` (e.g., `diagnose-concern`, `transcript-summary`), and `attempt_n`.

### Budgets + spending caps

The dashboard supports **monthly spend caps** at the team level and **per-key spend caps** at the API-key level. Caps trigger 429 responses when exceeded (NOT silent drops). Alert via email + webhook at 75 percent / 90 percent / 100 percent of cap.

### Failover cascade timing

The gateway's failover is NOT exponential-backoff retry; it's **fast-fail-and-try-next**. When a model errors (rate-limit, 5xx, timeout), the gateway immediately tries the next entry in the fallback chain. There's no inter-attempt wait. For a 3-model chain, worst-case latency is `provider_timeout * 3` + overhead. Provider timeouts can be set per-provider via `providerTimeouts`.

### BYOK (Bring Your Own Key)

Pass your own provider key per-request (overrides gateway default):

```typescript
providerOptions: {
  gateway: {
    byok: {
      anthropic: [{ apiKey: process.env.ANTHROPIC_API_KEY }],
    },
  },
}
```

Useful for: distinguishing dev/prod traffic at provider level, separate billing buckets, isolating cost by feature.

### Gotchas

- Cache caching is NOT shared across requests with different `system` prompts — be intentional about prompt structure.
- `sort: 'cost'` only ranks; it doesn't enforce a budget. Use spend caps for hard limits.
- Gateway adds ~50-150ms of latency vs direct provider. For latency-critical paths, weigh against the resilience gain.
- BYOK keys are still rate-limited by the provider — the gateway is a passthrough.

### Sources

- [AI Gateway - Vercel Docs](https://vercel.com/docs/ai-gateway)
- [Provider Options - Vercel AI Gateway](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options)
- [Observability - Vercel AI Gateway](https://vercel.com/docs/ai-gateway/capabilities/observability)
- [Vercel AI SDK v6 in Practice: AI Gateway, Streaming & Tools](https://nerdleveltech.com/mastering-vercel-ai-sdk-v6-building-smarter-scalable-ai-apps)
- [How to Use Vercel AI Gateway (2026): Multi-Provider Setup Guide](https://open-techstack.com/blog/how-to-use-vercel-ai-gateway-2026/)

---

## Cross-topic synthesis (orchestrator quick reference)

**Compose ALL of these for any vendor integration:**
1. Circuit breaker (Upstash Redis, distributed) — fail fast when vendor is down
2. Retry with exponential backoff + jitter — handle transient blips
3. Idempotency-Key on every mutation — safe retries
4. Webhook signature verification + replay protection — trust inbound events
5. Webhook event dedup by `provider_event_id` — at-least-once safety
6. Graceful degradation UX — honest customer-facing copy + queue-for-replay
7. Observability — Sentry breadcrumbs on every attempt, captureMessage on state transitions

**Vendor-specific signature schemes (don't confuse them):**
- Telnyx (v2): Ed25519, `telnyx-signature-ed25519` + `telnyx-timestamp`, 5min replay window, payload = `"{ts}|{body}"`
- Resend / Svix: HMAC-SHA256, `svix-id` + `svix-timestamp` + `svix-signature`, payload = `"{id}.{ts}.{body}"`
- Stripe: HMAC-SHA256, `stripe-signature: t=...,v1=...`, payload = `"{ts}.{body}"`

**Per-vendor retry/budget guidance:**
- Telnyx SMS send: 3 retries, 200-2000ms backoff, transient codes 40006/40008 only
- Resend send: 3 retries, 500-2000ms (already has Idempotency-Key support)
- Tekmetric: 2 retries (it's slower; longer budget) + circuit breaker in front
- Anthropic via Gateway: gateway handles failover natively; no app-level retry needed

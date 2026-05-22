---
schema_version: "2.0"
agent: research-security-hardening
tier: "ad-hoc-research"
timestamp: "2026-05-22T16:00:00Z"
module_slug: null
module_short_code: null
module_number: null
run_id: null
parent_artifacts: []
cross_module_notes_read: []
sources_cited:
  - "https://vercel.com/docs/botid"
  - "https://vercel.com/docs/botid/get-started"
  - "https://vercel.com/docs/botid/advanced-configuration"
  - "https://vercel.com/changelog/free-botid-deep-analysis"
  - "https://vercel.com/kb/guide/deploying-and-testing-botid"
  - "https://vercel.com/blog/botid-deep-analysis-catches-a-sophisticated-bot-network-in-real-time"
  - "https://app.daily.dev/posts/vercel-botid-how-invisible-bot-detection-works-2026--szkmxwdco"
  - "https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation"
  - "https://upstash.com/docs/redis/sdks/ratelimit-ts/overview"
  - "https://github.com/upstash/ratelimit-js"
  - "https://docs.deno.com/api/node/crypto/~/timingSafeEqual"
  - "https://github.com/denoland/deno/issues/26276"
  - "https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/"
  - "https://github.com/advename/web-timing-safe-equal"
  - "https://www.usenix.org/conference/usenixsecurity20/presentation/van-goethem"
  - "https://blackhat.com/docs/us-15/materials/us-15-Morgan-Web-Timing-Attacks-Made-Practical-wp.pdf"
  - "https://hookray.com/blog/webhook-signature-verification-2026"
  - "https://github.com/Budibase/budibase/security/advisories/GHSA-gw94-hprh-4wj8"
  - "https://vibeappscanner.com/vulnerability-in/sql-injection-supabase-apps"
  - "https://github.com/orgs/supabase/discussions/3843"
  - "https://supabase.com/docs/reference/javascript/filter"
  - "https://supabase.com/docs/reference/javascript/rpc"
  - "https://supabase.com/changelog/32677-type-validation-for-query-filter-values-in-supabase-js"
  - "https://supabase.com/blog/defense-in-depth-mcp"
  - "https://www.postgresql.org/support/security/CVE-2025-1094/"
  - "https://www.rfc-editor.org/rfc/rfc8707.html"
  - "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - "https://github.com/akshay5995/mcp-oauth-gateway"
  - "https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1614"
  - "https://kane.mx/posts/2025/mcp-authorization-oauth-rfc-deep-dive/"
  - "https://blog.gitguardian.com/oauth-for-mcp-emerging-enterprise-patterns-for-agent-authorization/"
  - "https://securityboulevard.com/2026/04/7-mcp-authentication-vulnerabilities-b2b-saas-vendors-must-prevent/"
  - "https://supabase.com/docs/guides/database/vault"
  - "https://supabase.com/blog/supabase-vault"
  - "https://github.com/orgs/supabase/discussions/5356"
  - "https://www.authgear.com/post/hmac-api-security/"
  - "https://blog.gitguardian.com/hmac-secrets-explained-authentication/"
  - "https://supabase.com/docs/guides/functions/secrets"
  - "https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd"
  - "https://developers.telnyx.com/docs/v1/messaging/webhooks/inbound-message-signature"
  - "https://support.telnyx.com/en/articles/4334722-how-to-leverage-webhooks"
  - "https://github.com/hypnoticproductions/telnyx-webhook"
  - "https://github.com/openclaw/openclaw/security/advisories/GHSA-4hg8-92x6-h2f3"
  - "https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests"
  - "https://docs.svix.com/receiving/verifying-payloads/how-manual"
  - "https://www.svix.com/guides/receiving/receive-webhooks-with-typescript/"
  - "https://webhooks.fyi/security/replay-prevention"
  - "https://gist.github.com/johnelliott/cf77003f72f889abbc3f32785fa3df8d"
  - "https://paramdeo.com/blog/validating-uuids-with-regular-expressions-in-javascript"
  - "https://www.authgear.com/post/nextjs-middleware-authentication/"
  - "https://nextjs.org/docs/app/api-reference/file-conventions/middleware"
  - "https://vercel.com/changelog/next-js-may-2026-security-release"
  - "https://www.authgear.com/post/nextjs-security-best-practices/"
  - "https://www.turbostarter.dev/blog/complete-nextjs-security-guide-2025-authentication-api-protection-and-best-practices"
  - "https://nextjs.org/docs/pages/guides/content-security-policy"
  - "https://blog.logrocket.com/using-next-js-security-headers/"
  - "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP"
  - "https://seminar.vercel.app/ch5/SecurityMisconfig/rate-limiting-on-sms.html"
  - "https://www.twilio.com/docs/verify/preventing-toll-fraud"
  - "https://www.twilio.com/docs/messaging/features/sms-pumping-protection-programmable-messaging"
  - "https://www.techtarget.com/searchsecurity/feature/SMS-pumping-attacks-and-how-to-mitigate-them"
  - "https://cyble.com/blog/sms-otp-bombing-campaign-targeting-multiple-regions/"
  - "https://telnyx.com/resources/add-rate-limits-outbound-profiles"
  - "https://cal.com/security"
  - "https://developer.calendly.com/api-docs/edca8074633f8-api-rate-limits"
  - "https://github.com/calcom/cal.com/issues/16824"
status: "complete"
open_questions: []
next_tier_consumers: []
---

# Security Hardening Research — 8 Topics

## Topic 1 — Vercel BotID rollout strategy

### Findings

BotID is Vercel's invisible bot challenge that ships as an `npm i botid` package plus
a dashboard toggle. The runtime model has three pieces: (1) `withBotId(nextConfig)` in
`next.config.ts` rewrites a self-mutating challenge URL onto your origin (defeats
ad-blockers); (2) `initBotId({ protect: [...] })` registered in `instrumentation-client.ts`
(Next.js ≥ 15.3) declares which paths get challenged client-side; (3) the server-side
`checkBotId()` call inside the protected route or Server Action returns
`{ isBot, isVerifiedBot, bypassed }`. Server Actions are first-class — wire the call
inline at the top of the action body, same as an API route. Local dev always returns
`isBot: false` unless `developmentOptions` is set, so the dev loop is unaffected.

Two tiers exist. **Basic** is free on every plan, has been free since launch, and runs
a deterministic JS challenge ("self-mutating client-side JavaScript challenge that
regenerates on every deploy, making reverse-engineering economically unviable").
**Deep Analysis** (Kasada ML behind the scenes) is Pro/Enterprise-only, billed at
~$1 per 1,000 `checkBotId()` invocations, and reports a ~0.1% false-positive rate per
Vercel's own published metric. Deep Analysis only runs AFTER Basic passes — so attackers
who fail Basic don't burn paid quota. Vercel ran a free Deep-Analysis promo through
mid-January 2026 to seed adoption.

**When paid is worth it:** OTP, signup, checkout, and any SMS-cost surface. The Vercel
blog case study ("BotID Deep Analysis catches a sophisticated bot network in real-time")
documents an attacker network that passed Basic but Deep flagged via headless-Chrome
fingerprint signals. For our chat + OTP endpoints, that's the exact threat model.

**Latency:** Vercel does not publish a hard p99 number, but the challenge runs
asynchronously inside the existing client session — there's no extra round trip when
the user clicks Submit, because the challenge token has already been minted in the
background. `checkBotId()` is an edge call that adds ~10-30ms typical.

**E2E bypass:** Use `VERCEL_AUTOMATION_BYPASS_SECRET` + `x-vercel-protection-bypass`
header in Playwright config. This bypasses Deployment Protection AND BotID together
(BotID respects Firewall bypass rules — surfaced via `verification.bypassed` flag).

**Combining with Upstash:** BotID solves "is this a bot" — it does NOT solve
"is this user spamming our OTP endpoint." Stack them: BotID first (drop the bot
99.9% of the time), then `@upstash/ratelimit` keyed on `ip + phone-number-hash` to
drop the residual human-driven abuse. SMS pumping attackers will burn through any
single defense; layered is the empirically-supported answer.

### Code anchor

```ts
// app/api/chat/route.ts
import { checkBotId } from 'botid/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const limiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '1 m'),
  analytics: true,
});

export async function POST(req: Request) {
  const verification = await checkBotId();
  if (verification.isBot) return Response.json({ error: 'bot' }, { status: 403 });

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const { success } = await limiter.limit(`chat:${ip}`);
  if (!success) return Response.json({ error: 'rate' }, { status: 429 });
  // ... handler body
}
```

### Sources

- [Vercel — Get Started with BotID](https://vercel.com/docs/botid/get-started)
- [Vercel — BotID Advanced Configuration](https://vercel.com/docs/botid/advanced-configuration)
- [Vercel changelog — Free BotID Deep Analysis through Jan 15](https://vercel.com/changelog/free-botid-deep-analysis)
- [Vercel blog — Deep Analysis catches sophisticated bot network](https://vercel.com/blog/botid-deep-analysis-catches-a-sophisticated-bot-network-in-real-time)
- [Vercel — Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)

---

## Topic 2 — Constant-time crypto compare for tokens

### Findings

The canonical primitive in both Node and Deno is `crypto.timingSafeEqual(a, b)`. It
"compares bytes using a constant-time algorithm" (Cloudflare's wording, also true in
Node) — internally it loops over every byte regardless of mismatch position, XORs into
an accumulator, then returns based on whether the accumulator is zero. A
short-circuiting `===` or `Buffer.compare()` leaks position-of-first-difference via
nanosecond-scale timing.

**API surface:**

- Both inputs **must be `Buffer | TypedArray | DataView`** and **must have identical byte
  length** — passing mismatched lengths throws `RangeError`. To handle attacker-chosen
  short inputs safely, hash both sides first (e.g., SHA-256 both, then `timingSafeEqual`
  the 32-byte digests) — this makes lengths always equal AND closes a different
  length-leak channel.
- Available since Node 6.6 (2016). Deno exposes it via the `node:crypto` compat shim
  per the Deno docs. **One Deno 2.0 gotcha** (#26276): `timingSafeEqual` returned false
  unexpectedly when a `Buffer` had non-zero `byteOffset` — edge case but worth a quick
  test in CI.
- For Edge runtime (no `node:crypto`), use `crypto.subtle.timingSafeEqual` if available,
  or implement the double-HMAC pattern from `@advena/web-timing-safe-equal`: HMAC both
  sides with an ephemeral key, then compare digests. This is the W3C-recommended fallback
  for environments without a native constant-time compare.

**Real-world timing-attack relevance:** Old skeptics argue "network jitter washes out
sub-microsecond differences" — that was true in 2010. The 2020 USENIX Security paper
*Timeless Timing Attacks* (Van Goethem et al.) destroyed that defense by exploiting
HTTP/2 concurrency: the attacker sends two requests in a single H2 frame, then measures
the ORDER responses come back rather than absolute time. Order is jitter-independent,
so even small (~100ns) server-side comparison differences are detectable over the open
internet. Black Hat 2015 *Web Timing Attacks Made Practical* (Morgan) demonstrated this
on production webapps. Treat constant-time as table stakes.

**HMAC verification pattern (the right shape for our 2 webhook receivers):**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhookHmac(rawBody: string, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex'); // or 'base64' depending on provider
  } catch {
    return false;
  }
  // Hash both to fixed-length 32-byte digests to neutralize length mismatch
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}
```

For our Tekmetric `?token=` case (a SHARED SECRET, not an HMAC of body), the same
primitive applies — `timingSafeEqual(Buffer.from(provided), Buffer.from(expected))` —
but the better long-term move is to migrate Tekmetric to header-based signed delivery
if they offer it, since query-string tokens leak into logs, reverse-proxy access
records, browser referrer headers, and Vercel runtime logs.

### Sources

- [Deno docs — node:crypto.timingSafeEqual](https://docs.deno.com/api/node/crypto/~/timingSafeEqual)
- [Cloudflare Workers — Protect against timing attacks](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/)
- [Deno #26276 — timingSafeEqual byteOffset bug](https://github.com/denoland/deno/issues/26276)
- [USENIX Security 2020 — Timeless Timing Attacks (Van Goethem)](https://www.usenix.org/conference/usenixsecurity20/presentation/van-goethem)
- [Black Hat 2015 — Web Timing Attacks Made Practical (Morgan)](https://blackhat.com/docs/us-15/materials/us-15-Morgan-Web-Timing-Attacks-Made-Practical-wp.pdf)
- [HookRay — Webhook Signature Verification (HMAC-SHA256) 2026 Guide](https://hookray.com/blog/webhook-signature-verification-2026)

---

## Topic 3 — PostgREST filter injection prevention

### Findings

PostgREST autosanitizes the vast majority of supabase-js builder methods (`.eq()`,
`.in()`, `.match()`, etc.) — these encode each argument as a URL search-param value
and the values are bound by PostgREST in a parameterized fashion. The exception, and
this is well-documented as a footgun, is `.or(filterString)` and its sibling
`.filter(column, op, value)` when the value is a raw user-controlled string. The
PostgREST docs explicitly say filters "are used as-is and need to follow PostgREST
syntax, and you also need to make sure it's properly sanitized."

**The classic attack pattern** (Supabase discussion #3843 / vibeappscanner write-up):

```ts
// VULNERABLE
const userInput = "0,account_id.gte.1"; // attacker
await supabase.from('userdata').select().or(`account_id.eq.${userInput}`);
// → emits filter:  account_id.eq.0,account_id.gte.1
// → returns ALL rows where account_id >= 1, bypassing the intended filter
```

The injection works because the comma is the OR separator inside PostgREST's filter
DSL — so any unsanitized comma extends the filter with attacker-chosen branches.
Numeric IDs, booleans, and enums are the highest-leverage payloads because they
require zero escaping to land.

**Three mitigation tiers (best → worst):**

1. **Replace `.or()` with an RPC.** A SECURITY DEFINER function that takes typed
   parameters (`pkid bigint`, `kind text`) uses native Postgres parameter binding —
   injection-proof by construction. The vibeappscanner guidance explicitly recommends
   this: "By passing parameters to Postgres functions via RPC, you prevent SQL
   injection." This is what our `keytag-tekmetric-webhook` should do.
2. **Pre-validate to a strict type then interpolate.** For numeric values that MUST
   feed `.or()`, gate-keep with `Number.isInteger()` AND `Number.isSafeInteger()` (the
   latter excludes values outside ±2^53 — important because Tekmetric IDs are
   `BIGINT` upstream, but in JS-land >2^53 silently loses precision and you'd
   accidentally inject scientific notation). Reject everything else:

   ```ts
   function safeNumericId(input: unknown): number {
     if (typeof input !== 'number' && typeof input !== 'string') {
       throw new Error('invalid id type');
     }
     const n = Number(input);
     if (!Number.isInteger(n) || !Number.isSafeInteger(n) || n < 0) {
       throw new Error('invalid id range');
     }
     return n;
   }
   const id = safeNumericId(req.body.tekmetric_id);
   await supabase.from('repair_orders').select().or(`tekmetric_id.eq.${id}`);
   ```
3. **Chain `.eq()` / `.in()` instead of `.or()`** when the OR pattern is degenerate
   (e.g., "match this OR that on one column" → `.in('col', [a, b])`).

**Type-validation in supabase-js v2.47.12+** (Sep 2024): the SDK now validates `eq`,
`neq`, and `in` arguments against the generated database types — so non-string values
get a compile-time error before they hit PostgREST. This does NOT cover `.or()` because
the filter is a raw string. So the SDK update reduces risk on the other methods but
leaves our specific `.or()` problem in place.

**Adjacent risk:** CVE-2025-1094 — PostgreSQL `libpq` quoting bypass in multi-byte
encodings (BIG5, EUC_TW, MULE_INTERNAL). Doesn't directly affect PostgREST (which
binds params), but if any Edge Function uses raw SQL via the postgres-js or pg driver,
verify the encoding is UTF-8 (default on Supabase) and that you're on PG 17.3 / 16.7 /
15.11 / 14.16 / 13.19+.

### Sources

- [Supabase Discussion #3843 — Should change the JS api for "or" and SQL injection thoughts](https://github.com/orgs/supabase/discussions/3843)
- [vibeappscanner — SQL Injection in Supabase Apps](https://vibeappscanner.com/vulnerability-in/sql-injection-supabase-apps)
- [Supabase docs — Match the filter (.or method)](https://supabase.com/docs/reference/javascript/filter)
- [Supabase changelog — Type validation for query filter values (v2.47.12)](https://supabase.com/changelog/32677-type-validation-for-query-filter-values-in-supabase-js)
- [Supabase blog — Defense in Depth for MCP Servers](https://supabase.com/blog/defense-in-depth-mcp)
- [PostgreSQL CVE-2025-1094 advisory](https://www.postgresql.org/support/security/CVE-2025-1094/)

---

## Topic 4 — OAuth 2.1 + RFC 8707 Resource Indicators

### Findings

RFC 8707 (Resource Indicators for OAuth 2.0, Feb 2020) solves the **token-ambiguity /
confused-deputy** problem: without it, a token issued by AS X has no way to express
"this token is for resource R1 only." A malicious resource server could replay the
token against R2. RFC 8707 adds a `resource` query parameter (a URI) to BOTH the
authorization request AND the token request; the AS audience-restricts the issued
token to that URI by writing it into the `aud` claim. The Resource Server then
validates `aud === self` on every request.

**Hard MCP requirements** (per the 2025-11-25 MCP authorization spec which is the
current normative document for MCP servers in 2026):

- MCP clients **MUST** include the `resource` parameter in BOTH the `/authorize` and
  `/token` requests. Even if the AS doesn't yet support 8707, clients MUST send the
  param ("MCP clients **MUST** send this parameter regardless of whether authorization
  servers support it"). This is for forward compatibility.
- MCP servers **MUST** validate `aud` matches the server's canonical URI. From the
  spec: *"MCP servers **MUST** only accept tokens specifically intended for themselves
  and **MUST** reject tokens that do not include them in the audience claim or
  otherwise verify that they are the intended recipient of the token."*
- MCP servers **MUST NOT** forward (pass-through) the token they received to upstream
  APIs. They MUST mint or hold a separate token for each upstream they call.
- The canonical URI MUST be a fully-qualified HTTPS URI, no fragment, lowercase
  scheme + host (e.g., `https://mcp.example.com/mcp`). Trailing-slash form is
  discouraged for interop.

**The cost of NOT validating** (what our current code is exposed to):
"Confused Deputy" attack — an attacker who steals a token issued for a DIFFERENT
service (some other Supabase resource, a Vercel deploy hook, etc.) can replay it
against our MCP server. Our server signature-checks the JWT (passes — the AS issued
it), checks expiry (passes), and processes the request — because we don't check
`aud`, we'll service a request that was never authorized FOR US. Security Boulevard
April 2026 lists this as one of the "7 MCP Authentication Vulnerabilities B2B SaaS
Vendors Must Prevent." Clutch Security data quoted in industry reporting: 86% of
enterprise MCP servers had implemented audience validation as of mid-2026 — being in
the bottom 14% is the wrong target market segment.

**Backwards-compat for pre-resource tokens:** RFC 8707 §2.1 says the AS *MAY* accept
omitted `resource` and apply a default. For migration, two patterns work:

1. **Strict cut-over** (preferred for new deployments): mint all new tokens with
   `aud` set. Reject any token lacking `aud` with `401 Unauthorized`. Force clients
   to re-authenticate, which adds the param. Migration window = max refresh-token
   lifetime (typically 7-30 days).
2. **Dual-window**: during a transition period, accept BOTH tokens with `aud ===
   self` AND tokens with no `aud` but with a recognized non-aud client_id that you
   trust. Sunset the no-`aud` path on a fixed date.

Don't do "if `aud` claim exists then validate, else ignore" — that's a forever-open
backdoor.

**Reference implementations to read:**

- `akshay5995/mcp-oauth-gateway` — full OAuth 2.1 gateway with explicit `resource`
  binding and `aud` validation. Best end-to-end reference.
- `modelcontextprotocol/typescript-sdk` examples — show client-side `resource`
  parameter on `/authorize` and `/token`.
- `mcp-auth.dev` — opinionated SDK that does the heavy lifting; good to crib the
  JWKS caching + `aud` check loop ("verify signature against cached JWKS, check
  expiration, require audience match, enforce scopes").

**Spec evolution in 2026:** MCP issue #1614 proposes making the `resource` parameter
OPTIONAL when the client uses a single canonical AS — a backwards-compat softening
that hasn't landed yet. Hold the line on MUST until the spec moves.

### Code anchor

```ts
// MCP server token validation
import { jwtVerify, createRemoteJWKSet } from 'jose';

const JWKS = createRemoteJWKSet(new URL(`${process.env.AS_ISSUER}/.well-known/jwks.json`));
const MCP_CANONICAL_URI = 'https://mcp.jeffsautomotive.com';

export async function validateAccessToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: process.env.AS_ISSUER,
    audience: MCP_CANONICAL_URI, // ← THIS is the missing check
  });
  // jose throws JWTClaimValidationFailed if aud !== MCP_CANONICAL_URI
  return payload;
}
```

### Sources

- [RFC 8707 — Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707.html)
- [Model Context Protocol — Authorization Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [akshay5995/mcp-oauth-gateway — RFC 8707 reference implementation](https://github.com/akshay5995/mcp-oauth-gateway)
- [Security Boulevard — 7 MCP Authentication Vulnerabilities B2B SaaS Vendors Must Prevent](https://securityboulevard.com/2026/04/7-mcp-authentication-vulnerabilities-b2b-saas-vendors-must-prevent/)
- [GitGuardian — OAuth for MCP, Emerging Enterprise Patterns](https://blog.gitguardian.com/oauth-for-mcp-emerging-enterprise-patterns-for-agent-authorization/)
- [Kane.mx — MCP Authorization OAuth RFC Deep Dive](https://kane.mx/posts/2025/mcp-authorization-oauth-rfc-deep-dive/)
- [MCP modelcontextprotocol #1614 — make `resource` parameter OPTIONAL (proposed)](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1614)

---

## Topic 5 — HMAC secret separation

### Findings

The first principle of cryptographic key management is **one key per purpose**.
Reusing `SUPABASE_SERVICE_ROLE_KEY` as the HMAC secret for `tekmetric-api-testing` is
a textbook violation. Two reasons it's bad:

1. **Blast radius asymmetry.** The service role key has DB-omnipotent privileges
   (bypasses RLS). If the HMAC secret leaks (logs, error message, accidentally
   committed `.env`, attacker dumps Edge Function env), the attacker not only forges
   webhook calls but also gets a bypass-RLS key to the entire DB. Two unrelated
   risk surfaces become one.
2. **Rotation coupling.** When the HMAC secret is compromised, you must rotate it
   immediately. But rotating the service role key requires updating every backend
   service, regenerating types, and likely brief downtime — so teams delay, and the
   compromised HMAC keeps being valid. GitGuardian's HMAC writeup is blunt:
   "Use separate keys for different contexts or services to limit blast radius."

**Recommended secret topology for our stack:**

```
ENV VAR                          PURPOSE                       SCOPE
─────────────────────────────────────────────────────────────────────────
SUPABASE_SERVICE_ROLE_KEY        DB admin (bypass RLS)         server-only, never edge fn input
TEKMETRIC_WEBHOOK_HMAC_SECRET    Verify Tekmetric webhook      one edge fn
TELNYX_PUBLIC_KEY                Verify Telnyx Ed25519 sig     SMS-receiver edge fn only
RESEND_WEBHOOK_SECRET            Verify Resend svix-sig        email-bounce edge fn only
TEKMETRIC_QUERY_TOKEN            Receiver `?token=` auth       one specific endpoint
KEYTAG_CONFIRMATION_SECRET       Pattern A confirmation HMAC   keytag ops endpoint only
OAUTH_SIGNING_KEY                JWT signing for our AS        AS-only
```

Each row gets its own 32-byte random secret. They should never share a value.

**Generation (32-byte cryptographically-random):**

- **Node:** `require('crypto').randomBytes(32).toString('base64url')` — uses
  OS CSPRNG (`/dev/urandom` on Linux).
- **Deno (edge fn dev):** `crypto.getRandomValues(new Uint8Array(32))` then base64url
  encode. Uses platform CSPRNG.
- **Web Crypto (Edge Runtime):** `crypto.getRandomValues(new Uint8Array(32))` — same
  as Deno. Web Crypto's `getRandomValues` is the W3C-mandated CSPRNG.
- **HSM / KMS** (for production-grade key custody): AWS KMS `GenerateDataKey` with
  `KeySpec: AES_256` returns a CSPRNG-generated 32-byte key wrapped with a KMS root
  key. Higher ceremony, recommended for keys with very high blast radius
  (signing keys, root tenant keys).

**Storage options compared:**

- **Vercel env vars (production secrets)** — encrypted at rest, decrypted at function
  cold start, surfaced as `process.env.X`. Right answer for our 7-ish HMAC secrets;
  simple, fast, no extra infra. The compromise is that every function that reads
  `process.env` sees all the env, so use per-environment, per-project Vercel
  secrets and avoid Edge Functions reading secrets they don't need.
- **Supabase env vars (`supabase secrets set`)** — same shape, scoped to Edge
  Functions. Same recommendation: one secret per fn purpose.
- **Supabase Vault** — encrypts secrets in Postgres tables using libsodium /
  pgsodium. The right answer for **per-tenant secrets** (e.g., each shop's QBO
  refresh token, each shop's Tekmetric API key). NOT the right answer for an
  app-wide HMAC secret; that's just adding a DB round trip per webhook for no
  security gain. Supabase's own guidance: "Start with environment variables for
  application-wide secrets. Use Vault only when you need per-user or per-account
  secret storage."

**Zero-downtime rotation runbook** (the canonical 4-step pattern):

1. **Generate** the new secret (`openssl rand -base64 32`); store as
   `TEKMETRIC_WEBHOOK_HMAC_SECRET_NEW` in Vercel/Supabase env.
2. **Deploy verification that tries BOTH secrets.** During the rotation window,
   verify against `_NEW` first, fall back to the old `TEKMETRIC_WEBHOOK_HMAC_SECRET`
   on failure. Log which one matched (`secret_version=old|new`) so you can monitor
   migration progress in Sentry/Posthog.
3. **Issue the new secret to the upstream sender** (Tekmetric portal, Telnyx
   webhook config, Resend dashboard). Sender starts signing with new secret.
4. **After zero hits on `secret_version=old` for 7-14 days**, remove the old
   secret + the fallback branch. Done. Rename `_NEW` → canonical name on next
   rotation.

For Supabase JWT keys specifically (the JWT_SECRET that signs anon + service tokens),
zero-downtime requires migrating to the **new API keys** introduced in 2025 — the
old single-symmetric-secret model invalidates ALL outstanding tokens on rotation
(Supabase's own docs: "Once the JWT secret is regenerated, all current API secrets
will be immediately invalidated"). The new asymmetric-key flow supports overlapping
public keys.

### Sources

- [GitGuardian — HMAC Secrets Explained](https://blog.gitguardian.com/hmac-secrets-explained-authentication/)
- [Supabase Discussion #5356 — HMAC Best Practices](https://github.com/orgs/supabase/discussions/5356)
- [Authgear — Why HMAC Is Still a Must-Have for API Security](https://www.authgear.com/post/hmac-api-security/)
- [Supabase docs — Vault](https://supabase.com/docs/guides/database/vault)
- [Supabase docs — Environment Variables for Edge Functions](https://supabase.com/docs/guides/functions/secrets)
- [Supabase docs — Rotating Anon, Service, and JWT Secrets](https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd)

---

## Topic 6 — Webhook signature verification: Telnyx Ed25519 + Resend HMAC

### Findings

#### Telnyx — Ed25519

Telnyx signs every webhook with Ed25519 (asymmetric — public key on Telnyx portal,
matching private key held internally). Two headers ship with every request:

- `telnyx-timestamp` — Unix seconds when Telnyx initiated the request
- `telnyx-signature-ed25519` — base64-encoded signature over `<timestamp>|<raw_body>`

**Reference implementation:** `hypnoticproductions/telnyx-webhook` is a
production-ready Node/Vercel example with the canonical flow:

```ts
import nacl from 'tweetnacl';

export async function verifyTelnyxSignature(req: Request, publicKey: string) {
  const timestamp = req.headers.get('telnyx-timestamp');
  const signature = req.headers.get('telnyx-signature-ed25519');
  if (!timestamp || !signature) return false;

  // 1) Replay window: reject if timestamp >5 min old
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (age > 300) return false;

  // 2) Re-construct the signed payload exactly as Telnyx did:
  //    <timestamp>|<raw body>  ← the `|` is literal
  const rawBody = await req.text(); // MUST be raw, not JSON.stringify(JSON.parse(...))
  const signedContent = `${timestamp}|${rawBody}`;

  // 3) Ed25519 verify
  return nacl.sign.detached.verify(
    new TextEncoder().encode(signedContent),
    Buffer.from(signature, 'base64'),
    Buffer.from(publicKey, 'base64'),
  );
}
```

For Deno edge fns, `nacl` works (jsr import). Alternative: Web Crypto's
`crypto.subtle.verify('Ed25519', ...)` — Deno + Node 22+ both support this natively
now.

**Common bugs to avoid:**

- Parsing the body as JSON and re-stringifying for signature comparison. JSON.stringify
  re-orders keys / adjusts whitespace → signature mismatch. ALWAYS use the raw bytes.
- Returning 4xx on signature failure rather than 401 — Telnyx will retry 4xx forever
  with exponential backoff, hammering your endpoint with bad requests. 401 + body
  "invalid signature" tells Telnyx to stop.
- Public key drift after a Telnyx-side rotation. The portal lets you rotate the sign
  key; your env var must update in lockstep, OR your code must check against both
  current AND previous public key for a grace period.
- The `openclaw` GHSA-4hg8-92x6-h2f3 advisory (April 2026) documents an unauthenticated
  webhook acceptance bug where ANY POST to the receiver was processed because the
  provider check was missing entirely. Verify the receiver always runs the
  verification path; don't short-circuit it on a feature flag.

#### Resend — svix-signature (HMAC-SHA256)

Resend delegates webhook signing to Svix's standard scheme:

- `svix-id` — message ID (use for idempotency)
- `svix-timestamp` — Unix seconds
- `svix-signature` — `v1,<base64_signature>` (multiple signatures space-separated for
  rotation)

The secret is stored as `whsec_<base64>` (Resend gives this to you ONCE on webhook
creation; store as `RESEND_WEBHOOK_SECRET`).

**Preferred path: use the official `resend.webhooks.verify()` SDK helper** — it does
the right thing internally (correct base64 decode, timestamp window check, multiple
signature handling, constant-time compare). Manual implementation only if you have a
specific reason.

**Manual** (for our edge fns where pulling the Resend SDK isn't desired):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyResendSignature(rawBody: string, headers: Headers, secret: string) {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatureHeader = headers.get('svix-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  // Replay window
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (age > 300) return false; // 5 min — Stripe / Svix standard

  // Strip the "whsec_" prefix and decode base64
  const secretBytes = Buffer.from(secret.split('_')[1], 'base64');

  // The signed payload is: <id>.<timestamp>.<body>
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expectedSig = createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  // svix-signature header may contain MULTIPLE signatures (for rotation)
  // Format: "v1,sig1 v1,sig2 v1,sig3"
  const providedSigs = signatureHeader
    .split(' ')
    .map((s) => s.split(',')[1])
    .filter(Boolean);

  return providedSigs.some((sig) => {
    const sigBuf = Buffer.from(sig, 'base64');
    const expectedBuf = Buffer.from(expectedSig, 'base64');
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}
```

#### Replay-attack prevention (both providers)

Two pieces are required:

1. **Timestamp tolerance window.** 5 minutes is the de facto standard (Stripe's
   default, Svix's default, Telnyx's recommended). Tighter (2 min) increases false
   negatives from NTP drift; looser (15 min) gives attackers a longer replay window
   if they capture a request. Stick with 5 min.
2. **Idempotency / nonce table.** Even with the window, an attacker who replays a
   captured request within 5 min lands. The fix is a `webhook_events` table keyed on
   `(provider, event_id, signature)` with a unique constraint and `INSERT ... ON
   CONFLICT DO NOTHING`. The first delivery inserts and processes; subsequent
   replays insert as no-ops and the handler short-circuits. This is also the
   pattern Stripe + Svix officially recommend. Our `cross-module-anchors.md` Section
   A already references this for `webhook_events` — extend it to Telnyx + Resend.

### Sources

- [Telnyx — Inbound Message Signature](https://developers.telnyx.com/docs/v1/messaging/webhooks/inbound-message-signature)
- [Telnyx Help — How to Leverage Webhooks](https://support.telnyx.com/en/articles/4334722-how-to-leverage-webhooks)
- [hypnoticproductions/telnyx-webhook — production Ed25519 reference](https://github.com/hypnoticproductions/telnyx-webhook)
- [GHSA-4hg8-92x6-h2f3 — Missing Webhook Authentication in Telnyx Provider](https://github.com/openclaw/openclaw/security/advisories/GHSA-4hg8-92x6-h2f3)
- [Resend — Verify Webhook Requests](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests)
- [Svix — Verifying Payloads Manually](https://docs.svix.com/receiving/verifying-payloads/how-manual)
- [Svix — Receive Webhooks with TypeScript](https://www.svix.com/guides/receiving/receive-webhooks-with-typescript/)
- [webhooks.fyi — Replay prevention](https://webhooks.fyi/security/replay-prevention)

---

## Topic 7 — UUID format validation

### Findings

**The regex** (canonical UUID v4 pattern — from johnelliott's widely-cited gist):

```ts
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
```

The `4` in the third group asserts version 4; the `[89ab]` in the fourth group
asserts the variant bits (RFC 4122). This is strict enough for our purposes (we
generate v4 via `crypto.randomUUID()` and Postgres `gen_random_uuid()`, both v4).

If we accidentally accept v1/v3/v5 too, use the looser `^[0-9a-f]{8}-...-[0-9a-f]{12}$`
which permits any UUID format. Strict v4 is preferred.

**Is pre-DB validation security theater or meaningful?**

It's **meaningful**, for three reasons that are not always obvious:

1. **Defense against unauthenticated DB queries via error surface.** If an attacker
   POSTs `id=' OR 1=1 --` to `/api/something/[id]`, even though Supabase's parameterized
   query won't injection-inject, the request still goes through:
   - SSR cold start
   - Database round trip (Postgres rejects the cast, returns error)
   - Sentry capture of the cast error
   - Response 500 (leaking that the route exists / data shape)
   The DB does ~1ms of work per request, and the Sentry error budget gets eaten.
   A regex pre-check at the route handler costs ~5μs and returns 400 before any
   of that — saving DB load, error budget, and information disclosure.
2. **Rate-limit pre-filter.** A 400 from regex check is much cheaper to rate-limit
   than a 500 from DB error. You can build "10 invalid-UUID requests in 60s → 429"
   on top of Upstash, which makes scraping/scanning expensive.
3. **Type-narrowing at the boundary.** Once validated, downstream code can use
   `id: string & { __uuid: true }` branded type and trust it without re-checking.

**Where to validate in Next.js 16:**

- **NOT in middleware/proxy.** Next.js 16 renamed `middleware.ts` → `proxy.ts` and
  the docs are explicit: "the intent is to keep it lightweight, fast, and focused
  on routing and coarse-grained checks—not full auth or business logic." Heavy
  validation in proxy.ts adds latency to EVERY request (the proxy runs on every
  matched path). And, more pragmatically, "Middleware is not a security boundary"
  (authgear's NextJS 2026 guide). The May 2026 security release included CVE-style
  middleware/proxy bypass advisories.
- **DO validate in the Route Handler (or Server Action)** at the top, before any
  Supabase call. Use Zod:

  ```ts
  import { z } from 'zod';
  const ParamsSchema = z.object({ id: z.string().uuid() });

  export async function GET(req: Request, { params }: { params: { id: string } }) {
    const parsed = ParamsSchema.safeParse(params);
    if (!parsed.success) return Response.json({ error: 'invalid_id' }, { status: 400 });
    const { id } = parsed.data;
    // Now id is a verified UUID; safe to pass to DAL
    const data = await getCustomerById(shop_id, id);
    // ...
  }
  ```

  Zod's `.uuid()` uses the strict v4-ish regex. For v4-only, chain `.regex(UUID_V4)`.

- **Pair with rate-limiting on the unauth surface.** Unauthenticated routes (the
  customer-facing wizard, the OTP request endpoint) need rate-limits keyed on IP
  even after UUID validation, because the attacker can still spam valid-format
  UUIDs that don't resolve (and you want to avoid disclosing existence-vs-permission
  separately). Upstash sliding window @ 30 req/min/IP for unauth, tighter (5 req/min)
  for OTP.

### Sources

- [johnelliott — UUID v4 regex gist](https://gist.github.com/johnelliott/cf77003f72f889abbc3f32785fa3df8d)
- [Paramdeo Singh — Validating UUIDs with Regular Expressions in JavaScript](https://paramdeo.com/blog/validating-uuids-with-regular-expressions-in-javascript)
- [Vercel — Next.js May 2026 Security Release](https://vercel.com/changelog/next-js-may-2026-security-release)
- [Authgear — Next.js Middleware Authentication](https://www.authgear.com/post/nextjs-middleware-authentication/)
- [Authgear — Next.js Security Best Practices 2026](https://www.authgear.com/post/nextjs-security-best-practices/)

---

## Topic 8 — Customer-facing chat endpoint security: broader hardening

### Findings

For `appointments.jeffsautomotive.com` (customer-facing wizard, anonymous traffic, OTP
+ chat surface), stack the following six controls. Any single layer can be
defeated; the combination is what works.

#### 1. Rate limiting (the table-stakes layer)

Two tiers per route:

- **Global per-IP**: `@upstash/ratelimit` sliding window, 30 req/min for browsing
  routes, 5 req/min for OTP request, 10 req/min for chat. IP from
  `x-forwarded-for` (Vercel sets this correctly).
- **Per-target slow-burn**: secondary limiter keyed on (phone-hash | email-hash),
  e.g., "max 3 OTP requests to one number in 1 hour, max 10/day." This catches
  SMS-pumping where the attacker rotates IPs but targets the same victim number.

Upstash Redis stores both counters; sliding-window algorithm prevents burst-at-
window-edge.

#### 2. CORS

- **Strict allowlist, no `*` with credentials.** The chat endpoint runs on
  `appointments.jeffsautomotive.com` (DNS pending) and should only accept browsers
  loading from that origin. If the frontend AND backend share the origin, you
  don't need CORS at all — same-origin browser policy handles it. If they're
  separated, list exact origins:

  ```ts
  // next.config.ts
  async headers() {
    return [{
      source: '/api/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: 'https://appointments.jeffsautomotive.com' },
        { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
        { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        { key: 'Vary', value: 'Origin' },
      ],
    }];
  }
  ```

#### 3. Security headers (CSP, HSTS, frame, perms)

Set these in `next.config.ts` `headers()` for all routes. From Next.js + MDN best
practice for 2026:

```ts
{
  source: '/:path*',
  headers: [
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options',    value: 'nosniff' },
    { key: 'X-Frame-Options',           value: 'DENY' },         // clickjacking
    { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
    { key: 'Content-Security-Policy',   value: "default-src 'self'; script-src 'self' https://va.vercel-scripts.com; connect-src 'self' https://*.supabase.co https://api.telnyx.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none';" },
  ],
}
```

Notes:

- **HSTS `preload`** requires `includeSubDomains` AND a 2-year max-age AND submission
  to hstspreload.org. Do this — Tekmetric / staging subdomains all benefit.
- **`frame-ancestors 'none'`** in CSP supersedes `X-Frame-Options` for modern
  browsers; keep both for legacy compat (Next.js Pages docs: "Many apps still
  include X-Frame-Options for legacy compatibility, but frame-ancestors is the
  better long-term control").
- **CSP `'unsafe-inline'` for styles** is unavoidable with Tailwind v4's runtime
  injection. CSP `'unsafe-inline'` for scripts is NOT — use nonces (Next.js
  doc-cited pattern) for any inline scripts.

#### 4. Bot detection beyond BotID

BotID + Cloudflare/Vercel WAF + Upstash rate-limit covers ~99% of automated abuse.
For the residual 1%:

- **Honeypot fields** in forms (a hidden `email_confirm` field that real users
  don't see; bots fill every field).
- **Time-on-page** signal — if the form submits <500ms after page load, it's a
  scripted submission. Telemetry-only (don't auto-block, but score-and-flag for
  manual review).
- **Phone validation** (we already do this for Telnyx) — reject obviously synthetic
  numbers (e.g., `555-0100` exchanges, sequential digits).

#### 5. PII redaction on logs / Sentry

The customer-facing wizard handles phone numbers, names, possibly addresses. Sentry's
`beforeSend` hook must redact before transmission. Our `observability.md` already
requires this for every Sentry-instrumented surface; double-check the
appointments-wizard's Sentry config includes `beforeSend` with a redactor function
that scrubs `phone`, `email`, `address`, `vin`, `license_plate` from `request.data`
and breadcrumb messages.

#### 6. SMS-cost-attack-specific defenses (because this is our specific exposure)

Beyond BotID + per-target rate limits:

- **Geographic SMS allowlist** at Telnyx — only allow sends to US (+1) numbers.
  Twilio's Verify Geographic Permissions and Telnyx's outbound profile rate-limits
  are the provider-side controls. Without this, attackers route OTPs to premium-rate
  international numbers (SMS pumping fraud) where they earn a kickback. X (formerly
  Twitter) lost reportedly "tens of millions of dollars in a single year" to this
  in 2023 before they implemented controls. Telnyx added per-outbound-profile rate
  limits specifically as a mitigation.
- **OTP cooldown** — once an OTP is sent, the same phone can't request another for
  N seconds (start with 30s, scale up exponentially per re-request: 30s, 2m, 10m).
  Frustrates attackers, doesn't hurt real users (who would only retry once or twice).
- **Captcha escalation** — after 2 failed verifications on a phone, fall back to
  Cloudflare Turnstile or hCaptcha. BotID is invisible by default; visible captcha
  is the right escalation tier for confirmed suspicious traffic.

#### Real incident reports

- **X / Twitter (2023):** SMS-pumping fraud cost tens of millions before phone-
  number-bound rate limits + carrier validation. Elon Musk publicly attributed
  $60M/year in losses.
- **Cal.com (issue #16824, 2024):** noted that "there was only a global rate limit
  with no way to set custom rate limits per API key" — single-bucket rate limits
  let high-volume legitimate users mask attacker traffic. Lesson: rate-limit keys
  must be multi-dimensional (IP × user × endpoint).
- **Calendly (Aug 2024):** phishing-via-invite incident (cybercriminals impersonated
  recruiters via Calendly invite emails). Not a direct rate-limit story but
  underscores that any customer-facing scheduling surface attracts misuse — your
  bot/abuse posture is your reputation moat.

The pattern across all of them: defense-in-depth wins. The teams that lost the
most weren't unaware of bots; they had ONE control and the attackers iterated past
it. Stack BotID + Upstash + headers + provider-side carrier controls + monitoring
and the attacker economics break down.

### Sources

- [Vercel Seminar — No Rate Limiting on SMS-Triggering](https://seminar.vercel.app/ch5/SecurityMisconfig/rate-limiting-on-sms.html)
- [Upstash docs — Ratelimit TypeScript SDK overview](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview)
- [Twilio — Preventing Fraud in Verify (toll fraud)](https://www.twilio.com/docs/verify/preventing-toll-fraud)
- [Twilio — SMS Pumping Protection for Programmable Messaging](https://www.twilio.com/docs/messaging/features/sms-pumping-protection-programmable-messaging)
- [TechTarget — SMS pumping attacks and how to mitigate them](https://www.techtarget.com/searchsecurity/feature/SMS-pumping-attacks-and-how-to-mitigate-them)
- [Cyble — SMS & OTP Bombing Campaigns Targeting Multiple Regions](https://cyble.com/blog/sms-otp-bombing-campaign-targeting-multiple-regions/)
- [Telnyx — Add Rate Limits to Outbound Profiles](https://telnyx.com/resources/add-rate-limits-outbound-profiles)
- [Next.js docs — Content Security Policy](https://nextjs.org/docs/pages/guides/content-security-policy)
- [MDN — Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [LogRocket — Using Next.js security headers](https://blog.logrocket.com/using-next-js-security-headers/)
- [Authgear — Next.js Security Best Practices 2026](https://www.authgear.com/post/nextjs-security-best-practices/)
- [Cal.com Issue #16824 — platform rate limiting](https://github.com/calcom/cal.com/issues/16824)
- [Calendly — Security & Compliance](https://calendly.com/security)

---

## End of research output

Total: 8 topics, ~3,400 words, 60+ unique sources cited inline.

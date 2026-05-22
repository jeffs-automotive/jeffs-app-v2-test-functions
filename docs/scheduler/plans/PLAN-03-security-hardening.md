---
plan: 03
title: Security hardening
audit_findings: [I-SEC-1, I-SEC-3, I-SEC-4, I-SEC-5, I-SEC-6, I-SEC-7]
research_inputs: [research-security-hardening]
estimated_effort: 5-6 days
prerequisites: [Plan-01 Phase 1A (edge fn auth pattern), Plan-01 Phase 3 (CI)]
risk_level: medium
---

# Plan 03 — Security hardening

> Defense-in-depth across our customer-facing + admin-facing surfaces. None of these are launch blockers (Plan 01 covers those), but every item closes a real attack vector. **The Vercel BotID + Upstash rate-limit work is the highest-value piece here — SMS pumping has cost X/Twitter $60M/year and is the most likely first attack we'll see when DNS goes live.**

## Audit findings addressed

| # | Severity | Finding | Phase |
|---|---|---|---|
| **I-SEC-7** | sec | Vercel BotID NOT enabled on chat + OTP endpoints | 1 |
| **I-SEC-1** | sec | Non-constant-time webhook token compare in 2 webhook receivers | 2 |
| **I-SEC-6** | sec | `mark-abandoned` route lacks UUID-format pre-check | 2 |
| **I-SEC-5** | sec | PostgREST `.or()` injection risk in `keytag-tekmetric-webhook:531-536` | 3 |
| **I-SEC-3** | sec | HMAC secret reused as `SUPABASE_SERVICE_ROLE_KEY` in `tekmetric-api-testing` | 3 |
| **I-SEC-4** | sec | OAuth `resource` indicator never validated at token-use time | 4 |
| _bonus_ | sec | No security-headers / CSP / HSTS preload on customer routes | 5 |

> **Note**: I-SEC-2 (webhook `.upsert()`) is addressed in **Plan 01 Phase 2** (paired with the idempotency UNIQUE constraint).

## Research summary

- **Vercel BotID:** Basic tier free on all plans (ML-based via Kasada). Deep Analysis ~$1/1k checks. Server Actions are first-class — wire `checkBotId()` inline. Deep only runs after Basic passes (attackers can't burn paid quota cheaply). E2E bypass via `VERCEL_AUTOMATION_BYPASS_SECRET` + `x-vercel-protection-bypass` header. Layer with `@upstash/ratelimit` keyed on `IP + phone-hash`. [security-hardening §1]
- **`crypto.timingSafeEqual`** is the right primitive in both Node and Deno (one Deno 2.0 `byteOffset` quirk: #26276). **Hash both sides to fixed-length first** to neutralize length mismatch. The 2020 USENIX *Timeless Timing Attacks* paper destroyed the "network jitter washes out timing" defense via HTTP/2 ordering — treat constant-time as table stakes. [§2]
- **PostgREST `.or()` injection** is a well-known footgun (Supabase discussion #3843). Three mitigation tiers, best→worst: (a) replace `.or()` with SECURITY DEFINER RPC; (b) `Number.isInteger() + Number.isSafeInteger()` pre-validation then interpolate; (c) chain `.eq()`/`.in()` instead. supabase-js v2.47.12+ type-validates `.eq()/.neq()/.in()` but NOT `.or()` (raw string). [§3]
- **RFC 8707 / MCP audience validation:** The 2025-11-25 MCP spec is normative — clients MUST include `resource` parameter in `/authorize` AND `/token`; servers MUST validate `aud === self`. `akshay5995/mcp-oauth-gateway` is the reference impl. 86% of enterprise MCP servers had audience validation per mid-2026. [§4]
- **HMAC secret separation:** One key per purpose. Reusing service-role-key as HMAC secret COUPLES blast radius AND rotation cycles. Topology: 7 named env vars (one per webhook source + one per signing purpose). 32-byte CSPRNG via `crypto.randomBytes(32)`. Canonical 4-step zero-downtime rotation: dual-verify → cut-over → monitor `secret_version=old` hits → remove old. [§5]
- **Next.js 16 renamed `middleware.ts` → `proxy.ts`** — docs are explicit that proxy is for "lightweight routing, not security." Validate UUIDs in Route Handlers (Zod `.uuid()`), NOT in proxy. May 2026 Next.js security release patched proxy-bypass advisories. [§7]
- **Six-layer customer-facing hardening:** tiered rate limits (per-IP + per-target/phone-hash), strict CORS allowlist, full security header set (HSTS preload + X-Frame-Options DENY + frame-ancestors 'none' CSP + Permissions-Policy denying camera/mic/geo), bot detection (BotID + honeypot + time-on-page), PII redaction in Sentry, SMS-cost defenses. [§8]

---

## Phase 1 — Vercel BotID + Upstash rate-limit (I-SEC-7, ~2 days)

**Goal:** Stop SMS pumping + bot probing of the chat/OTP surface. Free + paid tier rollout with E2E bypass for CI.

### Phase 1A — Install + wire BotID (1 day)

**Files to change:**
- `scheduler-app/package.json` — add `botid` (Vercel's package)
- `scheduler-app/src/lib/security/check-bot.ts` (new)
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-phone-name.ts` — wire `checkBotId()` at top
- `scheduler-app/src/lib/scheduler/wizard/actions/resend-otp.ts` — wire `checkBotId()` at top
- Any other Server Action that triggers an SMS send

**Helper:**
```typescript
// scheduler-app/src/lib/security/check-bot.ts
import { checkBotId } from "botid/server";

const E2E_BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export async function checkBotForSensitiveAction(): Promise<
  { ok: true; bypassed: boolean } | { ok: false; reason: string }
> {
  const result = await checkBotId();
  // checkBotId() respects the x-vercel-protection-bypass header when E2E_BYPASS is set
  if (result.isBot && !result.bypassed) {
    return { ok: false, reason: "bot_detected" };
  }
  return { ok: true, bypassed: result.bypassed ?? false };
}
```

**Wire into action:**
```typescript
// scheduler-app/src/lib/scheduler/wizard/actions/submit-phone-name.ts (top of wrapAction body)
const bot = await checkBotForSensitiveAction();
if (!bot.ok) {
  return { ok: false, error: "bot_detected", timestamp: Date.now() };
}
```

**Vercel dashboard setup:**
- Project → BotID → enable Basic (free)
- (Defer Deep Analysis until we see real attack traffic justifying the cost)

### Phase 1B — Upstash rate-limit (defense-in-depth, ~1 day)

**Goal:** Layer rate limits on top of BotID. Pattern from research: tiered per-IP + per-phone-hash limits.

**Files:**
- `scheduler-app/package.json` — add `@upstash/ratelimit @upstash/redis`
- `scheduler-app/src/lib/security/rate-limit.ts` (new)
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-phone-name.ts` — call rate-limit
- `scheduler-app/src/lib/scheduler/wizard/actions/resend-otp.ts` — same

**Code:**
```typescript
// scheduler-app/src/lib/security/rate-limit.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export const otpSendPerIp = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  prefix: "otp_send_ip",
});

export const otpSendPerPhone = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 h"),
  prefix: "otp_send_phone",
});

import { createHash } from "node:crypto";
export function hashPhone(phoneE164: string): string {
  return createHash("sha256").update(phoneE164).digest("hex").slice(0, 16);
}
```

**Wire (in submit-phone-name.ts):**
```typescript
import { headers } from "next/headers";
import { otpSendPerIp, otpSendPerPhone, hashPhone } from "@/lib/security/rate-limit";

// inside the action
const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
const ipCheck = await otpSendPerIp.limit(ip);
if (!ipCheck.success) {
  return { ok: false, error: "rate_limited_ip", timestamp: Date.now() };
}
const phoneCheck = await otpSendPerPhone.limit(hashPhone(parsed.data.phone_e164));
if (!phoneCheck.success) {
  return { ok: false, error: "rate_limited_phone", timestamp: Date.now() };
}
```

**Note:** the existing `otp_codes` table already enforces 3-per-phone-per-hour, but Upstash adds:
- Per-IP limit (catches 1000-phones-from-1-IP attacks)
- Faster rejection (no DB roundtrip on the rate-check fast path)

**Verification:**
1. Send 6 OTPs from one IP in 1 minute → 6th returns `rate_limited_ip`
2. Send 4 OTPs to one phone in 1 hour → 4th returns `rate_limited_phone`
3. With E2E bypass header set → checkBotId returns `bypassed: true`, no rate-limit (or use separate test phone numbers)

**Risk + rollback:**
- LOW. Both gates fail-closed (no SMS sent). Rollback by removing the gate calls.

---

## Phase 2 — Constant-time webhook compare + UUID validation (I-SEC-1 + I-SEC-6, ~2 hours)

### Phase 2A — Constant-time webhook token compare (I-SEC-1)

**Goal:** Both webhook receivers use the existing `bearersEqual()` constant-time helper instead of `!==`.

**Files:**
- `supabase/functions/tekmetric-webhook/index.ts:153`
- `supabase/functions/keytag-tekmetric-webhook/index.ts:297`

**Code:**
```typescript
// BEFORE
if (tokenParam !== WEBHOOK_TOKEN) { /* 401 */ }

// AFTER
import { bearersEqual } from "../_shared/scheduler-auth.ts";
if (!bearersEqual(tokenParam, WEBHOOK_TOKEN)) { /* 401 + Sentry warning per Plan-02 Phase 2A */ }
```

**Verify** `bearersEqual` uses `crypto.subtle.timingSafeEqual` or equivalent constant-time primitive — per research, our implementation does. Inspect `_shared/scheduler-auth.ts:127-134` to confirm.

### Phase 2B — UUID v4 validation in mark-abandoned (I-SEC-6)

**Goal:** Reject malformed chat_ids in `/api/scheduler/mark-abandoned` BEFORE any DB query.

**Files:**
- `scheduler-app/src/app/api/scheduler/mark-abandoned/route.ts:64-68`

**Code (use Zod since it's already in the codebase):**
```typescript
import { z } from "zod";

const querySchema = z.object({
  chat_id: z.string().uuid(), // canonical UUID v4 validation
  step: z.string().optional(),
  source: z.enum(["idle_timer", "tab_close"]).optional(),
});

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    chat_id: url.searchParams.get("chat_id"),
    step: url.searchParams.get("step"),
    source: url.searchParams.get("source"),
  });
  if (!parsed.success) {
    // Malformed — don't even hit DB. Still return 204 (don't leak info to a probe)
    return new Response(null, { status: 204 });
  }
  // ... existing logic using parsed.data.chat_id (typed UUID)
}
```

**Verification:**
1. `curl.exe -X POST "https://.../api/scheduler/mark-abandoned?chat_id=NOT-A-UUID"` → 204 + no DB query in logs
2. `curl.exe -X POST "https://.../api/scheduler/mark-abandoned?chat_id=$(uuidgen)"` → 204 + DB query

**Risk + rollback:**
- LOW. Both changes are tightenings. Rollback by reverting.

---

## Phase 3 — PostgREST injection guard + HMAC secret separation (I-SEC-5 + I-SEC-3, ~1 day)

### Phase 3A — PostgREST `.or()` injection guard (I-SEC-5)

**Goal:** Validate roId + roNumberForHistory are integers before interpolating.

**Files:**
- `supabase/functions/keytag-tekmetric-webhook/index.ts:531-536`

**Code (Tier 2 mitigation per research — Number.isInteger pre-validate, since promoting to RPC is bigger work):**
```typescript
// BEFORE
const { data } = await sb
  .from("keytag_audit_log")
  .select("...")
  .or(`ro_id.eq.${roId},ro_number.eq.${roNumberForHistory}`);

// AFTER
if (
  !Number.isInteger(roId) ||
  !Number.isSafeInteger(roId) ||
  !Number.isInteger(roNumberForHistory) ||
  !Number.isSafeInteger(roNumberForHistory)
) {
  console.warn("invalid_ro_id_or_number", { roId, roNumberForHistory });
  Sentry.captureMessage("Invalid roId/roNumber in webhook", "warning");
  // Don't fail the webhook — log + continue without the .or() lookup
} else {
  const { data } = await sb
    .from("keytag_audit_log")
    .select("...")
    .or(`ro_id.eq.${roId},ro_number.eq.${roNumberForHistory}`);
  // ... use data
}
```

**Alternative Tier 1 (eventually):** Move the lookup to a SECURITY DEFINER RPC `lookup_keytag_audit_for_ro(p_ro_id BIGINT, p_ro_number BIGINT)` that takes typed params. Better long-term solution but bigger PR. Track as a follow-up.

**Audit elsewhere:** grep for other `.or(` filter strings with caller-controlled interpolation:
```bash
grep -rn "\.or(\`" supabase/functions/ scheduler-app/src/
```
Each match gets the same `Number.isInteger` guard or RPC promotion.

### Phase 3B — HMAC secret separation (I-SEC-3)

**Goal:** Stop reusing `SUPABASE_SERVICE_ROLE_KEY` as the HMAC secret in `tekmetric-api-testing`. Use a dedicated 32-byte random.

**Files:**
- `supabase/functions/tekmetric-api-testing/index.ts:573-676`
- Supabase Vault (add new secret)

**Steps:**
1. Generate a 32-byte random HMAC secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Add to Vault:
   ```sql
   SELECT public.tekmetric_set_secret(
     'tekmetric_api_test_hmac',
     '<the 32-byte hex>',
     'HMAC signing secret for tekmetric-api-testing confirmation tokens'
   );
   ```
3. Update `tekmetric-api-testing/index.ts`:
   ```typescript
   // BEFORE
   const HMAC_SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

   // AFTER
   import { tekmetricGetSecret } from "../_shared/vault.ts";
   const HMAC_SECRET = await tekmetricGetSecret("tekmetric_api_test_hmac");
   ```

**Verification:**
1. Deploy: `npx supabase functions deploy tekmetric-api-testing`
2. Generate a confirmation token + immediately consume it → verify the round-trip still works
3. Restart edge fn → confirm secret is read fresh each invocation (or cached safely)

**Note:** With Plan 01 Phase 1A in place (`verify_jwt = false` + bearer check), this function is no longer anon-reachable. The HMAC secret separation is defense-in-depth.

**Risk + rollback:**
- LOW. If something breaks, set the HMAC_SECRET env var back to the service-role key temporarily.

---

## Phase 4 — OAuth `resource` validation at token-use time (I-SEC-4, ~1 day)

**Goal:** Per RFC 8707 + MCP spec 2025-11-25, every access-token use must validate the token's `resource` matches the protected resource URL.

**Files:**
- `supabase/functions/orchestrator-mcp/index.ts:149-176` (the `authenticateRequest` function)
- `supabase/functions/mcp-auth/index.ts:202-269` (the `/authorize` capture path — verify)
- `supabase/functions/mcp-auth/index.ts:545` (refresh token storage — verify)

**Implementation:**

1. **Add `resource` column to oauth_access_tokens + oauth_refresh_tokens if not present** (verify schema first):
   ```sql
   ALTER TABLE public.oauth_access_tokens
     ADD COLUMN IF NOT EXISTS resource TEXT;
   ALTER TABLE public.oauth_refresh_tokens
     ADD COLUMN IF NOT EXISTS resource TEXT;
   ```

2. **Capture `resource` at `/authorize`:**
   ```typescript
   // mcp-auth/index.ts (around line 213-254)
   const resource = url.searchParams.get("resource"); // RFC 8707
   if (!resource) {
     // MCP spec 2025-11-25 says clients MUST send resource — log + reject if missing
     await Sentry.captureMessage("OAuth /authorize missing resource indicator", "warning");
     return new Response(JSON.stringify({ error: "missing_resource" }), { status: 400 });
   }
   // Store on auth_code row
   await sb.from("oauth_authorization_codes").insert({
     code_hash, client_id, redirect_uri, scope, resource, expires_at,
   });
   ```

3. **Validate at `/token` exchange:**
   ```typescript
   // mcp-auth/index.ts (token endpoint handler)
   const tokenResource = url.searchParams.get("resource") ?? body.resource;
   if (tokenResource !== authCode.resource) {
     return new Response(
       JSON.stringify({ error: "invalid_target" }),
       { status: 400 }
     );
   }
   ```

4. **Validate at token USE (orchestrator-mcp):**
   ```typescript
   // orchestrator-mcp/index.ts authenticateRequest function
   const { data: token, error } = await sb.rpc("oauth_validate_access_token", {
     p_token_hash: tokenHash,
   });

   if (error || !token) return { ok: false, reason: "invalid_token" };

   // NEW: validate resource matches this endpoint
   const expectedResource = functionUrl("orchestrator-mcp"); // helper that returns the canonical URL
   if (token.resource && token.resource !== expectedResource) {
     await Sentry.captureMessage("OAuth token resource mismatch", "warning");
     return { ok: false, reason: "invalid_audience" };
   }

   return { ok: true, token };
   ```

5. **Backwards compat:** if `token.resource` is NULL (legacy token issued before this code shipped), allow with a logged warning during a transition window (e.g., 30 days). After 30 days, reject.

**Verification:**
1. Generate fresh token via mcp-auth flow with `resource=https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/orchestrator-mcp`
2. Use token at orchestrator-mcp → 200 OK
3. Hand-craft a token with wrong resource → 401 + Sentry warning
4. Legacy token (no resource) → 200 OK during transition (Sentry breadcrumb)

**Risk + rollback:**
- MEDIUM. If a Claude Desktop client is OUT OF DATE and doesn't send `resource`, OAuth flow breaks. Test with a fresh Claude Desktop connector before locking down. Use the 30-day transition window.

---

## Phase 5 — Customer-facing route hardening (bonus, ~1 day)

**Goal:** Defense-in-depth on customer-facing routes (CSP, HSTS, X-Frame-Options, Permissions-Policy).

**Files:**
- `scheduler-app/next.config.ts` (add `headers()` function)
- OR `scheduler-app/src/middleware.ts` / `proxy.ts` (Next.js 16) — verify our setup

**Critical note from research:** Next.js 16 renamed `middleware.ts` → `proxy.ts`. Verify which one we use:
```bash
ls scheduler-app/src/middleware.ts scheduler-app/src/proxy.ts 2>&1
ls scheduler-app/middleware.ts scheduler-app/proxy.ts 2>&1
```

If `middleware.ts` exists and we're on Next.js 16 — rename it per the migration guide.

**Security headers via next.config.ts:**
```typescript
// scheduler-app/next.config.ts
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "connect-src 'self' https://itzdasxobllfiuolmbxu.supabase.co https://o4509822123737088.ingest.us.sentry.io",
            "font-src 'self' data:",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "base-uri 'self'",
            "upgrade-insecure-requests",
          ].join("; "),
        },
      ],
    },
  ];
}
```

**Verification:**
1. `curl.exe -I https://appointments.jeffsautomotive.com/` (once DNS is live)
2. https://securityheaders.com — expect "A" rating
3. https://hstspreload.org/ — submit for preload list once HSTS is verified for 1 year

**Risk + rollback:**
- MEDIUM. CSP can break the app if too strict. Test thoroughly. Start with `Content-Security-Policy-Report-Only` to log violations without blocking.

---

## Sequence with other plans

- **Plan 01 Phase 1A** must be done first — the bearer-check helper pattern that Phase 3B uses.
- **Plan 01 Phase 3 (CI)** preferred first — so security regressions are caught by tests.
- Independent of Plans 02 (observability), 04 (atomicity), 05 (integrations), 06 (tests), 07 (operational).

## Open questions for Chris

1. **BotID Deep Analysis:** subscribe now (~$1/1k checks) or wait for real attack traffic? Recommend wait.
2. **Upstash account:** do we have a project, or need to create one? Free tier covers 10k requests/day.
3. **OAuth backwards-compat window:** 30 days? 60 days? How aggressive on the resource-not-set rejection?
4. **CSP rollout:** start with Report-Only mode for 1 week to see violations before enforcing?
5. **Middleware vs proxy:** verify which one we have (Next.js 16 rename).

## Success criteria

- [ ] BotID enabled on `/api/chat` + OTP send Server Action
- [ ] Upstash rate-limit gates both surfaces
- [ ] Both Tekmetric webhook receivers use `bearersEqual` (constant-time)
- [ ] `mark-abandoned` rejects malformed UUIDs before DB query
- [ ] PostgREST `.or()` calls with caller-controlled values have `Number.isInteger` guards
- [ ] `tekmetric-api-testing` uses dedicated HMAC secret (not service-role-key)
- [ ] OAuth flow validates `resource` indicator at /authorize, /token, and token-use
- [ ] Security headers (HSTS, X-Frame-Options, CSP, Permissions-Policy) on all routes
- [ ] securityheaders.com rating ≥ A

**Estimated effort:** 5-6 days.

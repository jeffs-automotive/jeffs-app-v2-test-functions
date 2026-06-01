// confirmation-gate — tekmetric-api-testing module.
// Extracted from tekmetric-api-testing/index.ts (file-size-refactor). Mechanical split.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Sentry } from "../_shared/sentry-edge.ts";
import { SUPABASE_SERVICE_ROLE_KEY } from "./config.ts";

// ─── Two-step confirmation gate (write ops) — stateless HMAC tokens ─────────
//
// Token format: `<expires_at_ms>.<body_hash_hex>.<hmac_hex>`
//   • expires_at_ms: epoch ms when this token is no longer valid (5 min TTL)
//   • body_hash_hex: sha256 of canonicalized request scope (op + body)
//   • hmac_hex:     HMAC-SHA256(SUPABASE_SERVICE_ROLE_KEY, expires_at_ms +
//                   "." + body_hash_hex)
//
// Stateless by design — survives isolate cold starts / pg_net's parallel
// invocations. No DB or in-memory cache. The HMAC ensures the token can't
// be forged without the secret; the body_hash ensures changing the body
// between step 1 and step 2 voids the token.

const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * PLAN-03 Phase 3B (I-SEC-3) — HMAC secret separation.
 *
 * The two-step confirmation token format embeds an HMAC signature.
 * Previously the HMAC secret was reused as `SUPABASE_SERVICE_ROLE_KEY`,
 * which coupled the rotation cycles + blast radius of two unrelated
 * secrets:
 *   - Service role key leaks → DB write access AND ability to forge
 *     two-step confirmation tokens (bypassing the write-op gate).
 *   - HMAC secret leaks → no DB access, only token forgery.
 *
 * Now we read a dedicated env var. If unset, we FALL BACK to the
 * service role key + log a Sentry warning — this keeps the migration
 * safe to deploy BEFORE Chris sets the dedicated secret. The warning
 * stops once `TEKMETRIC_API_TEST_HMAC_SECRET` is set via
 * `supabase secrets set TEKMETRIC_API_TEST_HMAC_SECRET=<32-byte hex>`.
 *
 * Rotation: token TTL is 5 minutes, so rotating the secret invalidates
 * all in-flight tokens after 5 min. No coordinated cut-over needed for
 * this scale.
 *
 * Tracked as a manual step in docs/scheduler/DEFERRED-AUDIT-ITEMS.md
 * (SEC-3).
 */
const DEDICATED_HMAC_SECRET = Deno.env.get("TEKMETRIC_API_TEST_HMAC_SECRET");
const HMAC_SECRET = DEDICATED_HMAC_SECRET && DEDICATED_HMAC_SECRET.length >= 32
  ? DEDICATED_HMAC_SECRET
  : SUPABASE_SERVICE_ROLE_KEY;
if (!DEDICATED_HMAC_SECRET || DEDICATED_HMAC_SECRET.length < 32) {
  // Fires once per cold isolate — Sentry dedupes via fingerprint. Stops
  // once the dedicated secret is set on the test/prod Supabase project.
  console.warn(
    "tekmetric-api-testing: TEKMETRIC_API_TEST_HMAC_SECRET unset or <32 chars; " +
    "falling back to SUPABASE_SERVICE_ROLE_KEY for HMAC (Plan 03 Phase 3B migration window). " +
    "Set via: supabase secrets set TEKMETRIC_API_TEST_HMAC_SECRET=$(node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")",
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonicalize a JSON-ish value for hashing — sort object keys at every
 * level. Arrays preserve their order. Primitives pass through. Ensures
 * two semantically-identical objects always hash the same regardless of
 * key insertion order.
 */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = canonicalize((v as Record<string, unknown>)[key]);
    }
    return out;
  }
  return v;
}

async function hashScope(scope: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalize(scope)));
}

let cachedHmacKey: CryptoKey | null = null;

async function getHmacKey(): Promise<CryptoKey> {
  if (cachedHmacKey) return cachedHmacKey;
  cachedHmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedHmacKey;
}

async function hmacSignHex(payload: string): Promise<string> {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function issueToken(
  scope: unknown,
  _scope_summary: string,
): Promise<{ token: string; expires_at: string }> {
  const expires_at_ms = Date.now() + TOKEN_TTL_MS;
  const body_hash = await hashScope(scope);
  const payload = `${expires_at_ms}.${body_hash}`;
  const signature = await hmacSignHex(payload);
  return {
    token: `${payload}.${signature}`,
    expires_at: new Date(expires_at_ms).toISOString(),
  };
}

export async function consumeToken(
  token: string,
  scope: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed_token" };
  }
  const [expires_at_str, body_hash_str, signature] = parts;
  const expires_at_ms = Number(expires_at_str);
  if (!Number.isFinite(expires_at_ms)) {
    return { ok: false, reason: "malformed_token_expiry" };
  }
  if (Date.now() > expires_at_ms) {
    return { ok: false, reason: "token_expired" };
  }
  const incoming_body_hash = await hashScope(scope);
  if (incoming_body_hash !== body_hash_str) {
    return { ok: false, reason: "body_mismatch_token_void" };
  }
  const expected_signature = await hmacSignHex(
    `${expires_at_str}.${body_hash_str}`,
  );
  // Constant-time-ish compare via hex string equality (acceptable for an
  // internal testing tool; no remote timing attack vector to worry about).
  if (expected_signature !== signature) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true };
}

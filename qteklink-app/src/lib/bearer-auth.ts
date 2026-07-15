/**
 * Constant-time bearer-secret verification for the app's secret-gated API routes
 * (the payroll mirror-apply consumer + the daily-sync cron). Direct `===`/`!==`
 * on the raw header leaks per-byte timing (incident 82dc03d) — the edge functions
 * already compare with `bearersEqual`; this is the Node/Next counterpart.
 *
 * Both sides are SHA-256'd to a fixed 32-byte digest before `timingSafeEqual`, so
 * the comparison is constant-time regardless of the attacker-supplied header's
 * length (a bare length pre-check would itself leak the secret's length).
 */
import { createHash, timingSafeEqual } from "node:crypto";

function sha256(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

/**
 * True iff `authHeader` is exactly `Bearer <secret>`, compared in constant time.
 * Returns false for a missing/blank secret or a null header — a misconfigured
 * route rejects rather than authorizing on an empty secret.
 */
export function bearerMatches(authHeader: string | null | undefined, secret: string | undefined | null): boolean {
  if (!secret) return false;
  const expected = sha256(`Bearer ${secret}`);
  const actual = sha256(authHeader ?? "");
  return timingSafeEqual(expected, actual);
}

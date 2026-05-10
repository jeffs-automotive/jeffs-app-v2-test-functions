// Shared Pattern A bearer-auth helper for the 3 scheduler Edge Functions
// (orchestrator-direct, transcript-dispatcher, appointments-sync).
//
// Per appointments_design.md §15 + scheduler_project_state.md "Stack
// invariants":
//   - Auth = service-role bearer in the Authorization header
//   - Caller is either the Vercel side (uses SUPABASE_SECRET_KEY env) or
//     the pg_cron job (reads vault.decrypted_secrets WHERE name =
//     'service_role_key')
//   - Both must match the runtime-injected key env vars
//
// 2026 env-naming transition (per Supabase Edge Function runtime):
//   - LEGACY: SUPABASE_SERVICE_ROLE_KEY
//   - NEW:    SUPABASE_SECRET_KEY
//   Both are auto-injected on legacy projects; only the new name on
//   freshly-created functions. We accept either to be tolerant.
//
// Diagnostic: on auth failure, we log the FIRST 8 CHARS of the submitted
// bearer + the first 8 chars of each expected env value. 8 chars is enough
// to diff JWT prefixes ("eyJhbGci") from secret-key prefixes ("sb_secr_")
// without leaking the full key. Logs are visible in Supabase Edge Function
// Logs / Sentry via Log Drain (observability.md decision D4).

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

const VALID_BEARERS: string[] = [
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SECRET_KEY,
].filter((k) => k.length > 0);

export interface AuthCheckResult {
  ok: boolean;
  reason?:
    | "missing_bearer"
    | "empty_bearer"
    | "bearer_mismatch"
    | "no_key_configured";
  /**
   * Safe-to-return diagnostic on auth failure — first 8 chars of submitted
   * bearer vs first 8 chars of each expected env value. 8 chars is enough
   * to spot prefix-format differences (eyJhbGci vs sb_secr_) without
   * leaking the key. Only set on `bearer_mismatch` / `no_key_configured`.
   */
  diagnostic?: {
    submitted_first8: string | null;
    submitted_length: number;
    expected_first8_options: string[];
    expected_lengths: number[];
    service_role_env_set: boolean;
    secret_key_env_set: boolean;
  };
}

/**
 * Constant-time bearer comparison. Returns true if `submitted` exactly
 * matches `expected` and both have the same length.
 */
function bearersEqual(submitted: string, expected: string): boolean {
  if (submitted.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < submitted.length; i++) {
    result |= submitted.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Check Pattern A bearer auth. Returns { ok: true } if the Authorization
 * header carries a Bearer token matching either of the runtime-injected
 * key env vars.
 *
 * On failure, also logs a structured diagnostic line (no full keys; only
 * the first 8 chars of each) so we can debug env-name mismatches from the
 * Edge Function log stream.
 */
function buildDiagnostic(submitted: string | null): AuthCheckResult["diagnostic"] {
  return {
    submitted_first8: submitted ? submitted.slice(0, 8) : null,
    submitted_length: submitted ? submitted.length : 0,
    expected_first8_options: VALID_BEARERS.map((k) => k.slice(0, 8)),
    expected_lengths: VALID_BEARERS.map((k) => k.length),
    service_role_env_set: SUPABASE_SERVICE_ROLE_KEY.length > 0,
    secret_key_env_set: SUPABASE_SECRET_KEY.length > 0,
  };
}

export function checkSchedulerBearer(
  req: Request,
  functionName: string,
): AuthCheckResult {
  if (VALID_BEARERS.length === 0) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "auth_no_key_configured",
        function: functionName,
        detail:
          "Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_SECRET_KEY is set in this function's environment.",
      }),
    );
    return {
      ok: false,
      reason: "no_key_configured",
      diagnostic: buildDiagnostic(null),
    };
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return { ok: false, reason: "missing_bearer" };
  }
  const submitted = auth.slice("bearer ".length).trim();
  if (submitted.length === 0) {
    return { ok: false, reason: "empty_bearer" };
  }

  for (const expected of VALID_BEARERS) {
    if (bearersEqual(submitted, expected)) {
      return { ok: true };
    }
  }

  // Diagnostic: first 8 chars of submitted vs each expected, plus length
  // info. JWT prefixes ("eyJhbGci"), legacy secret prefixes ("sb_secr_"),
  // and project-ref-anchored prefixes all differ in the first 8 chars.
  const diagnostic = buildDiagnostic(submitted);
  console.warn(
    JSON.stringify({
      level: "warn",
      msg: "auth_bearer_mismatch",
      function: functionName,
      ...diagnostic,
    }),
  );

  return { ok: false, reason: "bearer_mismatch", diagnostic };
}

/**
 * Convenience: returns the auth-failure reason as a 401 JSON Response.
 * Callers use:
 *   const auth = checkSchedulerBearer(req, "appointments-sync");
 *   if (!auth.ok) return unauthorizedResponse(auth);
 *
 * Includes the safe-prefix diagnostic in the response body when present
 * — first 8 chars of submitted vs each expected env value. This lets us
 * debug env-name / key-format mismatches from the curl response itself
 * without needing to chase log streams.
 */
export function unauthorizedResponse(result: AuthCheckResult): Response {
  const body: Record<string, unknown> = {
    ok: false,
    error: result.reason ?? "unauthorized",
  };
  if (result.diagnostic) {
    body.diagnostic = result.diagnostic;
  }
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Re-export the resolved service-role key for code that needs to pass it
 * to a Supabase client constructor (createClient(URL, KEY, ...)).
 * Returns the first non-empty env value, or empty string if neither is
 * set (Supabase client will fail-closed in that case).
 */
export const RESOLVED_SERVICE_ROLE_KEY: string =
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SECRET_KEY || "";

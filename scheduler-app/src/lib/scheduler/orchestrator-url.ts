/**
 * Shared ORCHESTRATOR_URL → edge-function URL derivation + host validation
 * (Validator-2 P0.3). Every scheduler client that POSTs the service-role
 * bearer to a Supabase edge function derives the endpoint from
 * ORCHESTRATOR_URL by swapping the trailing path segment. A typo'd env (or
 * environment spillover from a copy of another project's env file) would
 * otherwise silently send SUPABASE_SERVICE_ROLE_KEY as a Bearer to an
 * arbitrary host.
 *
 * Two layers — both must pass before the caller's fetch() runs:
 *   1. Derived host MUST end with `.supabase.co` (hardcoded suffix — no
 *      env-tampering can leak the key to evil.com).
 *   2. Derived host MUST exactly match NEXT_PUBLIC_SUPABASE_URL's host
 *      (ORCHESTRATOR_URL and NEXT_PUBLIC_SUPABASE_URL must agree on which
 *      Supabase project they target).
 *
 * Extracted 2026-06-13 (audit) from the duplicated inline copies in
 * booking-direct-client + manual-review-email-client so the pattern can't
 * drift and so the previously-unguarded clients (fire-transcript-dispatch,
 * otp-direct, step2-direct) get the same protection.
 *
 * Callers pass a `makeError` factory so each keeps its own error type
 * (BookingDirectError, ManualReviewEmailError, …) and the message substrings
 * their tests assert on.
 */
const ALLOWED_HOST_SUFFIX = ".supabase.co";

export function deriveValidatedEdgeFunctionUrl(
  functionName: string,
  makeError: (message: string, cause?: unknown) => Error,
): string {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    throw makeError(
      `Missing ORCHESTRATOR_URL env var — needed to derive the ${functionName} endpoint.`,
    );
  }
  const derivedUrl = orchestratorUrl.replace(/\/[^/]+\/?$/, `/${functionName}`);

  // P0.3 Layer 1: hardcoded suffix gate.
  let derivedHost: string;
  try {
    derivedHost = new URL(derivedUrl).host;
  } catch (e) {
    throw makeError(
      `Invalid derived ${functionName} URL (ORCHESTRATOR_URL=${orchestratorUrl})`,
      e,
    );
  }
  if (!derivedHost.endsWith(ALLOWED_HOST_SUFFIX)) {
    // NEVER send service_role to a non-supabase.co host. Hard fail.
    throw makeError(
      `Refusing to send service-role bearer: derived host '${derivedHost}' does not end with '${ALLOWED_HOST_SUFFIX}'. Check ORCHESTRATOR_URL env var.`,
    );
  }

  // P0.3 Layer 2: must match the project's Supabase URL exactly.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw makeError(
      `Missing NEXT_PUBLIC_SUPABASE_URL env var — required for ${functionName} host validation.`,
    );
  }
  let expectedHost: string;
  try {
    expectedHost = new URL(supabaseUrl).host;
  } catch (e) {
    throw makeError(`Invalid NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl}`, e);
  }
  if (derivedHost !== expectedHost) {
    throw makeError(
      `Refusing to send service-role bearer: derived host '${derivedHost}' does not match NEXT_PUBLIC_SUPABASE_URL host '${expectedHost}'. ORCHESTRATOR_URL and NEXT_PUBLIC_SUPABASE_URL must target the same Supabase project.`,
    );
  }

  return derivedUrl;
}

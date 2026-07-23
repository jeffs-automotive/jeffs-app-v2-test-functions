// _shared/tekbridge/auth.ts
//
// SERVICE_ROLE + X-Actor-Email authentication for the `tekbridge` gateway —
// the same trusted-internal-caller contract admin-app already uses against
// orchestrator. Modeled on orchestrator/index.ts's inline auth; kept
// tekbridge-scoped so we don't refactor that critical OAuth path mid-feature.
// (Follow-up: consolidate both into one shared helper.)
//
// Contract — ALL must hold:
//   1. Authorization: Bearer <token> where <token> matches the project's
//      SERVICE_ROLE / SECRET key (constant-time compare; handles the 2026
//      multi-key surface: SUPABASE_SECRET_KEYS dict, SUPABASE_SECRET_KEY,
//      SUPABASE_SERVICE_ROLE_KEY).
//   2. X-Actor-Email header present.
//   3. Email domain matches the allowed admin tenant (@jeffsautomotive.com).

const ALLOWED_ADMIN_EMAIL_DOMAIN = "@jeffsautomotive.com";

export type AuthResult =
  | { ok: true; actorEmail: string }
  | { ok: false; reason: "missing_token" | "invalid_token" | "missing_actor_email" | "invalid_actor_email_domain" };

/** Constant-time string equality (mitigates timing leakage on the bearer compare). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * All valid SERVICE_ROLE / SECRET key values the edge runtime knows about.
 * Supabase's 2026 key rollout means which env var is populated varies; accept
 * every non-empty form so the admin-app's resolved key matches whichever is set.
 */
export function getAllowedServiceRoleBearers(): string[] {
  const out = new Set<string>();
  const dictRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (dictRaw) {
    try {
      const parsed = JSON.parse(dictRaw);
      const collect = (v: unknown) => {
        if (typeof v === "string" && v.length > 0) out.add(v);
        else if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") {
          out.add((v as { value: string }).value);
        }
      };
      if (Array.isArray(parsed)) parsed.forEach(collect);
      else if (parsed && typeof parsed === "object") Object.values(parsed as Record<string, unknown>).forEach(collect);
    } catch {
      // malformed JSON → fall through to singular forms
    }
  }
  const singular = Deno.env.get("SUPABASE_SECRET_KEY");
  if (singular && singular.length > 0) out.add(singular);
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy && legacy.length > 0) out.add(legacy);
  return Array.from(out);
}

/** Syntactically-valid email in the allowed admin tenant (header-injection safe). */
export function isAllowedAdminEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 320) return false;
  if (!trimmed.includes("@")) return false;
  if (/[\r\n\t\0]/.test(trimmed)) return false;
  return trimmed.toLowerCase().endsWith(ALLOWED_ADMIN_EMAIL_DOMAIN);
}

/**
 * True if the request carries a valid SERVICE_ROLE bearer — WITHOUT requiring an
 * X-Actor-Email. Used by system/cron-invoked endpoints (e.g. the refresh cron
 * calls via scheduler_invoke_edge_function, which sends only the service-role
 * bearer, no actor). `allowedBearers` is injectable for tests.
 */
export function hasValidServiceRoleBearer(
  req: Request,
  allowedBearers: string[] = getAllowedServiceRoleBearers(),
): boolean {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return false;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const token = m[1].trim();
  if (!token) return false;
  return allowedBearers.some((k) => token.length === k.length && timingSafeStringEqual(token, k));
}

/**
 * Authenticate a request. `allowedBearers` is injectable for tests; defaults to
 * reading the env. Returns the lowercased actor email (audit identity) on success.
 */
export function authenticateServiceRole(
  req: Request,
  allowedBearers: string[] = getAllowedServiceRoleBearers(),
): AuthResult {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return { ok: false, reason: "missing_token" };
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "invalid_token" };
  const token = m[1].trim();
  if (!token) return { ok: false, reason: "invalid_token" };

  const isServiceRole = allowedBearers.some((k) => token.length === k.length && timingSafeStringEqual(token, k));
  if (!isServiceRole) return { ok: false, reason: "invalid_token" };

  const actorEmail = req.headers.get("X-Actor-Email") ?? req.headers.get("x-actor-email");
  if (!actorEmail) return { ok: false, reason: "missing_actor_email" };
  if (!isAllowedAdminEmail(actorEmail)) return { ok: false, reason: "invalid_actor_email_domain" };

  return { ok: true, actorEmail: actorEmail.trim().toLowerCase() };
}

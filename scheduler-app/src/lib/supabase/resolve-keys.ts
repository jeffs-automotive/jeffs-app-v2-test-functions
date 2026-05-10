/**
 * Resolve Supabase API keys from the 2026 multi-form env surface.
 *
 * Supabase's Edge Function "Default Secrets" panel (Project Settings →
 * Edge Functions → Secrets) documents the current 2026 env layout:
 *
 *   NEW (canonical):
 *     SUPABASE_SECRET_KEYS       — JSON dictionary of secret API keys
 *                                  (issued via JWT Signing Keys)
 *     SUPABASE_PUBLISHABLE_KEYS  — JSON dictionary of publishable keys
 *
 *   LEGACY (deprecated; still injected for backwards-compat — usually
 *   populated with one of the new sb_secret_* / sb_publishable_* values):
 *     SUPABASE_SERVICE_ROLE_KEY  — single value
 *     SUPABASE_ANON_KEY          — single value
 *
 * Different parts of our env get the keys at different times:
 *   - Vercel + Marketplace integration: injects the new plural-dict form,
 *     possibly alongside the legacy singular form
 *   - Edge Function runtime: same as above, on the Supabase side
 *   - Local dev (`vercel env pull .env.local`): mirrors Vercel
 *
 * This helper accepts ANY of those shapes and returns the first usable
 * key value, so a single env-naming change on the Supabase side doesn't
 * break our app code.
 */

/** Tolerantly parse a JSON dict env value and extract all string values. */
function parseKeyDict(raw: string | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: string[] = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry === "string") {
        out.push(entry);
      } else if (
        entry &&
        typeof entry === "object" &&
        "value" in entry &&
        typeof (entry as { value: unknown }).value === "string"
      ) {
        out.push((entry as { value: string }).value);
      }
    }
  } else if (parsed && typeof parsed === "object") {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (typeof v === "string") {
        out.push(v);
      } else if (
        v &&
        typeof v === "object" &&
        "value" in (v as Record<string, unknown>) &&
        typeof (v as { value: unknown }).value === "string"
      ) {
        out.push((v as { value: string }).value);
      }
    }
  }
  return out.filter((s) => s.length > 0);
}

/**
 * Resolve the service-role / secret API key.
 *
 * Tries, in order:
 *   1. SUPABASE_SECRET_KEYS (JSON dict — canonical 2026)
 *   2. SUPABASE_SECRET_KEY  (singular, transition-period)
 *   3. SUPABASE_SERVICE_ROLE_KEY (legacy)
 *
 * Returns the first non-empty match, or null if none are set.
 */
export function resolveServiceRoleKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromDict = parseKeyDict(env.SUPABASE_SECRET_KEYS);
  if (fromDict.length > 0) return fromDict[0]!;
  const singular = env.SUPABASE_SECRET_KEY;
  if (singular && singular.length > 0) return singular;
  const legacy = env.SUPABASE_SERVICE_ROLE_KEY;
  if (legacy && legacy.length > 0) return legacy;
  return null;
}

/**
 * Resolve the publishable / anon key — used for cookie-bound client SDKs.
 *
 * Tries, in order:
 *   1. SUPABASE_PUBLISHABLE_KEYS (JSON dict — canonical 2026)
 *   2. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (singular, transition-period)
 *   3. NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy)
 *   4. SUPABASE_PUBLISHABLE_KEY (non-public-prefixed singular fallback)
 *   5. SUPABASE_ANON_KEY (non-public-prefixed legacy fallback)
 *
 * Returns the first non-empty match, or null if none are set.
 */
export function resolvePublishableKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromDict = parseKeyDict(env.SUPABASE_PUBLISHABLE_KEYS);
  if (fromDict.length > 0) return fromDict[0]!;
  const nextPublic = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (nextPublic && nextPublic.length > 0) return nextPublic;
  const nextPublicLegacy = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (nextPublicLegacy && nextPublicLegacy.length > 0) return nextPublicLegacy;
  const singular = env.SUPABASE_PUBLISHABLE_KEY;
  if (singular && singular.length > 0) return singular;
  const legacy = env.SUPABASE_ANON_KEY;
  if (legacy && legacy.length > 0) return legacy;
  return null;
}

/**
 * Resolve the Supabase project URL. Auto-injected by Vercel Marketplace +
 * Edge Function runtime under both NEXT_PUBLIC_-prefixed and plain names.
 */
export function resolveSupabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return (
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    null
  );
}

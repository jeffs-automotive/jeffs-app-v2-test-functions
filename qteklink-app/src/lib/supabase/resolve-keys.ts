/**
 * Resolve Supabase API keys from the 2026 multi-form env surface.
 *
 * Copied verbatim from scheduler-app/src/lib/supabase/resolve-keys.ts
 * so admin-app handles env-var naming the same way (canonical 2026
 * JSON-dict form OR legacy singular form). Drift here would cause
 * mysterious "missing key" errors only on one of the two apps.
 *
 * If you change this file: keep the two copies in sync OR extract to
 * a shared workspace package (deferred per PLAN.md D7).
 */

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

export function resolvePublishableKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromDict = parseKeyDict(env.SUPABASE_PUBLISHABLE_KEYS);
  if (fromDict.length > 0) return fromDict[0]!;
  const nextPublic = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (nextPublic && nextPublic.length > 0) return nextPublic;
  const nextPublicLegacy = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (nextPublicLegacy && nextPublicLegacy.length > 0)
    return nextPublicLegacy;
  const singular = env.SUPABASE_PUBLISHABLE_KEY;
  if (singular && singular.length > 0) return singular;
  const legacy = env.SUPABASE_ANON_KEY;
  if (legacy && legacy.length > 0) return legacy;
  return null;
}

export function resolveSupabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || null;
}

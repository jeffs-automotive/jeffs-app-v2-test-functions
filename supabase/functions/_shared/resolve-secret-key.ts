// Secret-key resolution for Edge Functions — the 2026 multi-form env surface
// (audit 2026-06-12). The platform's auto-injected SUPABASE_SERVICE_ROLE_KEY is
// the LEGACY name; this project's legacy JWT keys are revoked, so functions must
// prefer the new-format vars exactly like the apps' resolve-keys.ts:
//   SUPABASE_SECRET_KEYS (JSON dict/array) → SUPABASE_SECRET_KEY → legacy var.
// `resolveSecretKeyCandidates` returns EVERY available value (de-duplicated) so a
// bearer check can accept any currently-valid key during a rotation window.

function parseKeyDict(raw: string | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const values = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null ? Object.values(parsed) : [];
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") {
      out.push((v as { value: string }).value);
    }
  }
  return out;
}

/** Every secret-key value available to this function, new-format first. */
export function resolveSecretKeyCandidates(): string[] {
  const out = [
    ...parseKeyDict(Deno.env.get("SUPABASE_SECRET_KEYS")),
    Deno.env.get("SUPABASE_SECRET_KEY") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  ].filter((s) => s.length > 0);
  return [...new Set(out)];
}

/** The preferred secret key (new format first; null when none is configured). */
export function resolveSecretKey(): string | null {
  return resolveSecretKeyCandidates()[0] ?? null;
}

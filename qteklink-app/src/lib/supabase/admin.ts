/**
 * Service-role Supabase client for server-side calls that need to bypass
 * RLS — primarily for calling the orchestrator MCP edge function.
 *
 * NEVER expose this client to Client Components / browser bundles. The
 * SUPABASE_SECRET_KEY (alias SUPABASE_SERVICE_ROLE_KEY) gives root-level
 * DB access — leaking it = full data breach.
 *
 * For cookie-bound user-session operations (sign in/out, read user),
 * use ./server.ts instead.
 */
import { createClient } from "@supabase/supabase-js";
import { resolveServiceRoleKey, resolveSupabaseUrl } from "./resolve-keys";

export function createSupabaseAdminClient() {
  const url = resolveSupabaseUrl();
  const serviceRoleKey = resolveServiceRoleKey();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin-client env vars. Required: SUPABASE_URL " +
        "(or NEXT_PUBLIC_SUPABASE_URL) and one of SUPABASE_SECRET_KEYS " +
        "(JSON dict — 2026 canonical), SUPABASE_SECRET_KEY, or " +
        "SUPABASE_SERVICE_ROLE_KEY (legacy). Set these via Vercel " +
        "Dashboard UI — see admin-app/SETUP.md.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

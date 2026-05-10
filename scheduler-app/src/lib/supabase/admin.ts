/**
 * Service-role Supabase client for system-only writes from Vercel Server
 * Actions / Route Handlers / cron jobs.
 *
 * Per appointments_design.md §15 Q4:
 *   - Use plain @supabase/supabase-js createClient (NOT @supabase/ssr) for
 *     the secret-key path. Mixing SSR + secret key has cookies overriding
 *     service-role auth (silent footgun).
 *   - This bypasses RLS — the calling code MUST enforce app-level auth
 *     (session validation, shop scoping, etc.).
 *
 * Used in:
 *   - Customer chat flow (customers have no Supabase Auth session)
 *   - Cron-triggered code (no user session)
 *   - Backfill / admin scripts
 *
 * 2026 env naming: the service-role key surface is multi-form on Vercel
 * + the Edge Function runtime. We use the shared `resolveServiceRoleKey`
 * helper that accepts SUPABASE_SECRET_KEYS (JSON dict — canonical),
 * SUPABASE_SECRET_KEY (singular), or SUPABASE_SERVICE_ROLE_KEY (legacy).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "./resolve-keys";

let cachedClient: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = resolveSupabaseUrl();
  const secretKey = resolveServiceRoleKey();

  if (!url || !secretKey) {
    throw new Error(
      "Missing Supabase admin-client env vars. Required: SUPABASE_URL " +
        "(or NEXT_PUBLIC_SUPABASE_URL) and one of SUPABASE_SECRET_KEYS " +
        "(JSON dict — 2026 canonical), SUPABASE_SECRET_KEY (singular), " +
        "or SUPABASE_SERVICE_ROLE_KEY (legacy). " +
        "These are auto-injected by the Vercel Marketplace Supabase " +
        "integration; if missing in local dev, run `vercel env pull " +
        ".env.local`. See appointments_design.md §15.",
    );
  }

  cachedClient = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "X-Client-Info": "scheduler-app/admin" },
    },
  });

  return cachedClient;
}

/**
 * Reset the cached client. Used in tests; not for production code paths.
 */
export function __resetAdminClientForTests(): void {
  cachedClient = null;
}

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
 * Per the new 2026 Marketplace integration naming: the env var is
 * SUPABASE_SECRET_KEY (replaces legacy SUPABASE_SERVICE_ROLE_KEY).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SECRET_KEY env vars. " +
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

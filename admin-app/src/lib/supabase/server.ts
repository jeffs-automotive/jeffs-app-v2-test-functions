/**
 * Cookie-bound Supabase client for Server Components / Server Actions /
 * Route Handlers that interact with a Supabase Auth session.
 *
 * THIS client is for AUTH operations (reading the logged-in user's
 * session, signing in/out). Do NOT pass the service-role key here —
 * cookies override service-role auth in @supabase/ssr (footgun
 * documented in supabase/discussions#30739). For service-role calls
 * to the orchestrator MCP, use ./admin.ts instead.
 *
 * cookies() is async in Next.js 15+ App Router — must await it.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolvePublishableKey, resolveSupabaseUrl } from "./resolve-keys";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const url = resolveSupabaseUrl();
  const publishableKey = resolvePublishableKey();

  if (!url || !publishableKey) {
    throw new Error(
      "Missing Supabase server-client env vars. Required: SUPABASE_URL " +
        "(or NEXT_PUBLIC_SUPABASE_URL) and one of SUPABASE_PUBLISHABLE_KEYS " +
        "(JSON dict — 2026 canonical), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, " +
        "or NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy). " +
        "Did you run `vercel env pull .env.local`? See admin-app/SETUP.md.",
    );
  }

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll called from a Server Component — Next.js disallows
          // cookie writes there. Safe to ignore — middleware refresh path
          // handles cookie-write on the next request.
        }
      },
    },
  });
}

/**
 * Cookie-bound Supabase client for Server Components / Server Actions /
 * Route Handlers that interact with a Supabase Auth session.
 *
 * Per appointments_design.md §15 Q4:
 *   - Use @supabase/ssr's createServerClient ONLY for cookie-bound user
 *     sessions
 *   - Do NOT use this client with the secret key — cookies override
 *     service-role auth (footgun documented in supabase/discussions#30739)
 *   - For service-role calls, use ./admin.ts instead
 *
 * For scheduler-app specifically, the customer chat flow does NOT use
 * Supabase Auth (customers don't have accounts; identity is OTP + name
 * + vehicle match per design §4). The only place this client gets used
 * Phase 1 is hypothetical future admin UIs that would log in with
 * Supabase Auth — kept here so the pattern is wired and ready.
 *
 * Note: cookies() is async in Next.js 15+ (App Router) — must await it.
 *
 * 2026 env naming: publishable / anon key surface is multi-form on Vercel.
 * We use the shared `resolvePublishableKey` helper to accept
 * SUPABASE_PUBLISHABLE_KEYS (JSON dict — canonical),
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, or
 * the non-public singular fallbacks.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  resolvePublishableKey,
  resolveSupabaseUrl,
} from "./resolve-keys";

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
        "Did you run `vercel env pull .env.local`? See appointments_design.md §15.",
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
          // setAll called from a Server Component — Next.js disallows cookie
          // writes there. It's safe to ignore: the middleware refresh path
          // handles cookie-write on the next request.
        }
      },
    },
  });
}

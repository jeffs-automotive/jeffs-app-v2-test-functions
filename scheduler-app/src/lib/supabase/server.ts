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
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars. " +
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

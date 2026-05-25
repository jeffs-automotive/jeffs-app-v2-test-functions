/**
 * Next.js middleware — refreshes Supabase Auth session cookies on every
 * matching request so the session doesn't silently expire mid-use.
 *
 * Per https://supabase.com/docs/guides/auth/server-side/nextjs the
 * canonical pattern is to mint a fresh response, hand it to @supabase/ssr's
 * createServerClient with both getAll + setAll bound to BOTH the request
 * cookies AND the response cookies, call `supabase.auth.getUser()` to
 * trigger the refresh, and return the response.
 *
 * Note: this middleware does NOT enforce auth — that's requireAdmin()'s
 * job inside each protected page/action. The middleware just keeps the
 * session fresh.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolvePublishableKey, resolveSupabaseUrl } from "@/lib/supabase/resolve-keys";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = resolveSupabaseUrl();
  const publishableKey = resolvePublishableKey();

  // If env not configured (e.g., local dev without `vercel env pull`),
  // skip the refresh — don't block the request. requireAdmin() will
  // surface a clearer error to the user.
  if (!url || !publishableKey) {
    return response;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Trigger refresh — return value not used; cookies get updated via setAll.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *   - _next/static (static files)
     *   - _next/image (image optimization)
     *   - favicon.ico
     *   - public folder files
     *
     * Notably we DO match /login + /auth/callback — those rely on session
     * cookies being current too (e.g., post-callback redirect needs the
     * fresh session readable).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

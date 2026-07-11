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
 * Note: this middleware does NOT enforce auth — that's requireQtekUser()'s
 * job inside each protected page / Server Action / route handler. The
 * middleware just keeps the session fresh.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  resolvePublishableKey,
  resolveSupabaseUrl,
} from "@/lib/supabase/resolve-keys";

export async function middleware(request: NextRequest) {
  // Forward the request path+query to server components (x-qtl-pathname) so
  // requireQtekUser()'s unauthenticated bounce can carry a ?next= deep link
  // (office-manager emails link straight to /approvals/[date]).
  const pathWithSearch = request.nextUrl.pathname + request.nextUrl.search;
  const forwardHeaders = () => {
    // Re-snapshot request.headers each time so refreshed auth cookies
    // (request.cookies.set updates the underlying cookie header) survive.
    const h = new Headers(request.headers);
    h.set("x-qtl-pathname", pathWithSearch);
    return h;
  };

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });

  const url = resolveSupabaseUrl();
  const publishableKey = resolvePublishableKey();

  // If env not configured (e.g., local dev without `vercel env pull`),
  // skip the refresh — don't block the request. requireQtekUser() will
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
        response = NextResponse.next({ request: { headers: forwardHeaders() } });
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
     * Match all request paths EXCEPT static assets. Notably we DO match
     * /login + /auth/callback — those rely on session cookies being current
     * too (e.g., the post-callback redirect needs the fresh session readable).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

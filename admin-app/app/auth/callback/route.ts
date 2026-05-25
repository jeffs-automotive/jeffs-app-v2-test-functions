/**
 * /auth/callback — OAuth code exchange handler.
 *
 * Microsoft Entra redirects the user back to Supabase's auth callback,
 * which then redirects HERE with a `?code=...&next=...` query param.
 * We exchange the code for a session via @supabase/ssr's
 * `exchangeCodeForSession`, set the session cookies, and redirect to
 * the landing page (or wherever `next` says).
 *
 * Canonical Route Handler pattern per @supabase/ssr + Next.js 15 docs
 * (https://supabase.com/docs/guides/auth/server-side/nextjs):
 *
 *   1. Build the redirect Response FIRST
 *   2. Bind the Supabase client's cookie setAll directly to response.cookies
 *   3. exchangeCodeForSession() writes the session cookies onto OUR response
 *   4. Return that response — browser receives it with Set-Cookie headers
 *
 * DO NOT use the cookies()-from-next/headers helper here — in a Route
 * Handler that returns NextResponse.redirect(), those cookies don't
 * reliably attach to the redirect response (the response object is
 * constructed before Next can flush the cookies() handle). Symptom:
 * first sign-in lands at /login after callback because the session
 * cookies were lost; second sign-in works because the leftover state
 * lines up. Bug fixed by binding setAll directly to response.cookies
 * here. The cookies()-helper pattern is fine for Server Components +
 * Server Actions; just not for Route Handlers returning a redirect.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  resolvePublishableKey,
  resolveSupabaseUrl,
} from "@/lib/supabase/resolve-keys";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    // No code param — landed here unexpectedly. Send back to /login.
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const url = resolveSupabaseUrl();
  const publishableKey = resolvePublishableKey();
  if (!url || !publishableKey) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // CRITICAL: build the success redirect FIRST so exchangeCodeForSession
  // can attach Set-Cookie headers TO THIS response via the setAll
  // callback below. If we built the response after the exchange, the
  // cookies would be lost.
  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Fresh response — don't reuse the success response (which may
    // already carry partial cookies from a failed exchange).
    return NextResponse.redirect(
      `${origin}/login?error=auth_callback_failed`,
    );
  }

  return response;
}

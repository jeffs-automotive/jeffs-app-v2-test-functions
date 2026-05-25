/**
 * /auth/callback — OAuth code exchange handler.
 *
 * Microsoft Entra redirects the user back to Supabase's auth callback,
 * which then redirects HERE with a `?code=...&next=...` query param.
 * We exchange the code for a session via @supabase/ssr's
 * `exchangeCodeForSession`, set the session cookies, and redirect to
 * the landing page (or wherever `next` says).
 *
 * This is the canonical Supabase PKCE-flow callback shape per
 * https://supabase.com/docs/guides/auth/server-side/nextjs (the
 * "Create a route handler for Auth callback" section).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    // No code param — landed here unexpectedly. Send back to /login.
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // Use a relative redirect so we land on the same host (admin.jeffsautomotive.com)
  // even when the callback was hit via Vercel's preview URL.
  return NextResponse.redirect(`${origin}${next}`);
}

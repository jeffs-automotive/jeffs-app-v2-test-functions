/**
 * /auth/callback — OAuth code exchange handler.
 *
 * Microsoft Entra redirects back to Supabase's auth callback, which then
 * redirects HERE with `?code=...&next=...`. We exchange the code for a session
 * via @supabase/ssr's `exchangeCodeForSession`, set the session cookies, and
 * redirect to the landing page (or `next`).
 *
 * Canonical Supabase PKCE-flow callback shape per
 * https://supabase.com/docs/guides/auth/server-side/nextjs.
 *
 * NOTE: this handler only establishes the SESSION. Authorization (is this user
 * on the QTekLink allowlist?) happens at the destination page via
 * requireQtekUser() — so a real-but-unlisted Microsoft user lands cleanly on
 * /login?error=not_allowed rather than seeing app content.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only allow a clean root-relative path — blocks open-redirect payloads like
  // `//evil.com` or `/\evil.com` (CWE-601) that survive URL normalization even
  // with `origin` prepended.
  const rawNext = searchParams.get("next") ?? "/";
  const next =
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.startsWith("/\\")
      ? rawNext
      : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  // Relative redirect so we stay on qteklink.jeffsautomotive.com (or the
  // preview host the callback was hit on).
  return NextResponse.redirect(`${origin}${next}`);
}

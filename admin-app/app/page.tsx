/**
 * Root `/` — thin redirect.
 *
 * The dashboard lives at /dashboard (moved from / on 2026-05-25 per
 * Chris's preference). Root just bounces:
 *   - Authed → /dashboard
 *   - Not authed → /login (handled by requireAdmin)
 *
 * Why not delete this and rely on Next's 404? Because URLs like
 * admin.jeffsautomotive.com/ are what bookmarks, the Supabase Auth
 * callback default, and any "click the brand logo to go home" links
 * resolve to. They should land somewhere sensible, not 404.
 */
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

export default async function RootPage() {
  // requireAdmin redirects to /login if no session.
  // If session exists, it returns the email — we just discard and
  // redirect to the actual landing page.
  await requireAdmin();
  redirect("/dashboard");
}

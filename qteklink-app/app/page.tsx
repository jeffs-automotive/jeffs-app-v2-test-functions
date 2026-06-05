/**
 * Root `/` — thin redirect. Authed + allowlisted → /dashboard; otherwise
 * requireQtekUser() bounces to /login. Keeps bookmarks + the Supabase Auth
 * callback default landing somewhere sensible (not a 404).
 */
import { redirect } from "next/navigation";
import { requireQtekUser } from "@/lib/auth";

export default async function RootPage() {
  await requireQtekUser();
  redirect("/dashboard");
}

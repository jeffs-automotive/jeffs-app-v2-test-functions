/**
 * requireAdmin — server-side guard for every protected page + Server Action.
 *
 * Two-layer defense:
 *   1. Microsoft Entra tenant restriction (config in Supabase Auth provider)
 *      — only users from the jeffsautomotive.com Microsoft 365 tenant can
 *      complete OAuth at all
 *   2. Email-suffix check below — belt-and-suspenders in case the tenant
 *      config drifts or someone adds a federated guest user
 *
 * Usage:
 *   - Page: `const { email } = await requireAdmin();` at the top of a
 *     server component. On no-session: redirects to /login.
 *   - Server Action: same call at the top of the action body. The action
 *     does not redirect — it throws "unauthorized" which surfaces as a
 *     toast in the UI; the next render will redirect.
 *
 * Per PLAN.md D6: v1 is single-role — anyone with @jeffsautomotive.com
 * gets full access. Audit log captures who-did-what. Add RBAC later by
 * extending this helper to also return a role.
 */
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";

const ALLOWED_EMAIL_DOMAIN = "@jeffsautomotive.com";

export interface AdminSession {
  /** Microsoft email — used as audit identity downstream */
  email: string;
  /** Supabase user UUID — useful for cross-table joins */
  userId: string;
}

export async function requireAdmin(): Promise<AdminSession> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  const email = user.email ?? "";
  if (!email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) {
    // Tenant restriction SHOULD prevent this from ever firing — but if a
    // federated guest user somehow got into the tenant, we still reject.
    // Sign them out so the next /login click starts fresh.
    await supabase.auth.signOut();
    redirect("/login?error=unauthorized_domain");
  }

  return { email, userId: user.id };
}

/**
 * Soft variant — returns the session if present, null if not. Use for
 * conditional rendering (e.g., a "Sign in" link in the nav when logged
 * out). Does NOT redirect.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;
  if (!user.email.toLowerCase().endsWith(ALLOWED_EMAIL_DOMAIN)) return null;
  return { email: user.email, userId: user.id };
}

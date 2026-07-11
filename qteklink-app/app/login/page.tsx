/**
 * /login — the only unauthenticated page in QTekLink.
 *
 * Single "Sign in with Microsoft" button → Supabase Azure provider OAuth.
 * Authentication (who is a real jeffsautomotive.com Microsoft user) is the
 * tenant-locked Azure provider's job; authorization (who may use QTekLink) is
 * the allowlist's job, enforced in requireQtekUser(). The error codes below
 * are what requireQtekUser() / the callback set.
 */
import LoginButton from "./LoginButton";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

/** Relative-path-only guard — mirrors the auth-callback's open-redirect check. */
function safeNext(raw: string | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw === "/" || raw.startsWith("/login") || raw.startsWith("/auth")) return null;
  return raw;
}

const ERROR_COPY: Record<string, string> = {
  not_allowed:
    "That account isn't authorized for QTekLink. Ask an admin to add you to the access list.",
  deactivated:
    "Your QTekLink access has been deactivated. Contact an admin if this is a mistake.",
  no_object_id:
    "Sign-in didn't return a verifiable Microsoft identity. Please try again.",
  auth_callback_failed: "Sign-in failed. Please try again.",
  unauthorized_domain:
    "You need a Jeff's Automotive Microsoft account to sign in.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, next } = await searchParams;
  const errorMessage = error
    ? (ERROR_COPY[error] ?? "Sign-in failed. Please try again.")
    : null;
  const nextPath = safeNext(next);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-card p-8 shadow-md">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-primary">QTekLink</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tekmetric &rarr; QuickBooks sync
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {errorMessage}
          </div>
        )}

        <LoginButton next={nextPath} />

        <p className="text-center text-xs text-muted-foreground">
          Restricted to authorized Jeff&apos;s Automotive staff.
        </p>
      </div>
    </main>
  );
}

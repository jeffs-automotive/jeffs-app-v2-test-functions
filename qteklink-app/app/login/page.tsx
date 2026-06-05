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
  searchParams: Promise<{ error?: string }>;
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
  const { error } = await searchParams;
  const errorMessage = error
    ? (ERROR_COPY[error] ?? "Sign-in failed. Please try again.")
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#96003C]">QTekLink</h1>
          <p className="mt-2 text-sm text-stone-600">
            Tekmetric &rarr; QuickBooks sync
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {errorMessage}
          </div>
        )}

        <LoginButton />

        <p className="text-center text-xs text-stone-500">
          Restricted to authorized Jeff&apos;s Automotive staff.
        </p>
      </div>
    </main>
  );
}

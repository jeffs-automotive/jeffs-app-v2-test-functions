/**
 * /login — the only unauthenticated page in admin-app.
 *
 * Renders a single "Sign in with Microsoft" button that kicks off the
 * OAuth flow via Supabase Auth's Azure provider. The Azure provider must
 * be configured in the Supabase Dashboard with the jeffsautomotive.com
 * tenant URL — see admin-app/SETUP.md for the one-time setup.
 *
 * URL params handled:
 *   - ?error=unauthorized_domain — set by requireAdmin() when the
 *     authenticated email is NOT @jeffsautomotive.com (shouldn't happen
 *     with proper tenant config, but defense in depth)
 *   - ?error=auth_callback_failed — set by /auth/callback when the OAuth
 *     code exchange fails
 */
import LoginButton from "./LoginButton";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  let errorMessage: string | null = null;
  if (error === "unauthorized_domain") {
    errorMessage =
      "That account isn't authorized. You need a @jeffsautomotive.com Microsoft account to sign in.";
  } else if (error === "auth_callback_failed") {
    errorMessage = "Sign-in failed. Please try again.";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-stone-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#96003C]">
            Jeff&apos;s Automotive
          </h1>
          <p className="mt-2 text-sm text-stone-600">Admin dashboard</p>
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
          Use your @jeffsautomotive.com Microsoft account.
        </p>
      </div>
    </main>
  );
}

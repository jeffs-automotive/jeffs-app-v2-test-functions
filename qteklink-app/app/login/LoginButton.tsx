/**
 * The Sign-In-With-Microsoft button. Client Component because
 * `supabase.auth.signInWithOAuth` runs in the browser (sets a PKCE verifier
 * cookie and redirects to login.microsoftonline.com).
 */
"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function LoginButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setPending(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          // `email` so requireQtekUser() has a display identity; `openid
          // profile` are the standard OIDC scopes. The Entra object id (oid)
          // used for the allowlist is a default claim — no extra scope needed.
          scopes: "email openid profile",
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
        setPending(false);
      }
      // On success: browser is redirected by Supabase — no further code here.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setPending(false);
    }
  }

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}
      <Button
        type="button"
        size="lg"
        onClick={handleSignIn}
        loading={pending}
        loadingText="Redirecting…"
        className="w-full"
      >
        {/* Microsoft logo — 4 colored squares per their brand guidelines */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 21 21"
          className="size-4"
          aria-hidden="true"
        >
          <rect x="1" y="1" width="9" height="9" fill="#f25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
          <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
        </svg>
        Sign in with Microsoft
      </Button>
    </>
  );
}

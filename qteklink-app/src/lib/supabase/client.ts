/**
 * Browser-side Supabase client for Client Components.
 *
 * Used by /login page to call `signInWithOAuth({ provider: 'azure' })`.
 * Most of the dashboard runs server-side — this client is small.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "(or NEXT_PUBLIC_SUPABASE_ANON_KEY fallback). See admin-app/SETUP.md.",
    );
  }

  return createBrowserClient(url, publishableKey);
}

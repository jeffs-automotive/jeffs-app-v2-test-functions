"use server";

/**
 * Sign-out Server Action. Used by the nav bar's "Sign out" button.
 *
 * Clears the Supabase session cookies and redirects to /login.
 */
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

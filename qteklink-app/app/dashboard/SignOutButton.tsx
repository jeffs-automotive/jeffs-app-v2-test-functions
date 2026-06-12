"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { LogOut } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function SignOutButton() {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut();
    // No silent failures (observability.md) — surface a failed sign-out, but
    // still send the user to /login (the middleware will re-check the session).
    if (error) {
      Sentry.captureException(error, { tags: { qteklink_action: "sign_out" } });
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={handleSignOut}
      loading={pending}
      loadingText="Signing out…"
    >
      <LogOut aria-hidden="true" />
      Sign out
    </Button>
  );
}

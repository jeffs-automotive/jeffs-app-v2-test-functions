/**
 * /qbo/connected — the post-connect landing (the qbo-oauth-callback edge function
 * 302-redirects here after it exchanges the code + stores the tokens in Vault).
 * Confirmation only; no secrets are shown. The Intuit "Launch URL" can also point
 * here (or at /dashboard).
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function QboConnectedPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-primary">QuickBooks connected</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        QTekLink is connected to QuickBooks. Next, refresh your chart of accounts and
        review your account mappings from the dashboard.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-4">
        <Button render={<Link href="/dashboard" />}>Go to dashboard</Button>
        <Button render={<Link href="/mappings" />} variant="outline">Account mappings</Button>
      </div>
    </main>
  );
}

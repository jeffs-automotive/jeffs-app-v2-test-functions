/**
 * /qbo/connected — the post-connect landing (the qbo-oauth-callback edge function
 * 302-redirects here after it exchanges the code + stores the tokens in Vault).
 * Confirmation only; no secrets are shown. The Intuit "Launch URL" can also point
 * here (or at /dashboard).
 */
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function QboConnectedPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-[#96003C]">QuickBooks connected</h1>
      <p className="mt-3 text-sm text-stone-600">
        QTekLink is connected to QuickBooks. Next, refresh your chart of accounts and
        review your account mappings from the dashboard.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm">
        <Link
          href="/dashboard"
          className="rounded bg-[#96003C] px-4 py-2 font-medium text-white transition hover:bg-[#7e0033]"
        >
          Go to dashboard
        </Link>
        <Link
          href="/mappings"
          className="rounded border border-stone-300 px-4 py-2 font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Account mappings
        </Link>
      </div>
    </main>
  );
}

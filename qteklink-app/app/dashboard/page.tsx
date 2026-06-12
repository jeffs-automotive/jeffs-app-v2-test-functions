/**
 * /dashboard — the authed QTekLink landing.
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. The nav
 * renders for EVERY role (the approvals/mappings/postings pages are all-roles
 * READ surfaces; mutations stay admin-gated in the actions); the QuickBooks
 * connect/COA card is admin-only.
 */
import { requireQtekUser } from "@/lib/auth";
import { getCoaSummary } from "@/lib/dal/coa";
import Link from "next/link";
import SignOutButton from "./SignOutButton";
import RefreshCoaButton from "./RefreshCoaButton";
import DisconnectQboButton from "./DisconnectQboButton";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default async function DashboardPage() {
  const { email, role, shopId } = await requireQtekUser();
  const coa = role === "admin" ? await getCoaSummary(shopId) : null;
  // A connection ROW present (realm bound) → offer Reconnect + Disconnect. The
  // connect/reconnect flow is the /qbo/connect route (→ the qbo-oauth-callback edge fn).
  const connected = Boolean(coa?.realmId);

  let coaStatus = "QuickBooks isn't connected for this shop yet.";
  if (coa?.realmId) {
    coaStatus = coa.lastSyncedAt
      ? `${coa.count} account${coa.count === 1 ? "" : "s"} mirrored · last synced ${new Date(coa.lastSyncedAt).toLocaleString()}`
      : "Not synced yet — click below to mirror your chart of accounts.";
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader title="QTekLink" description="Tekmetric → QuickBooks sync">
        <div className="flex items-center gap-3">
          <IdentityBlock email={email} role={role} shopId={shopId} />
          <SignOutButton />
        </div>
      </PageHeader>

      {role === "admin" && (
        <Card className="mt-8 shadow-xs">
          <CardHeader>
            <CardTitle>Chart of accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Mirror your QuickBooks chart of accounts so QTekLink can map Tekmetric
              line items to the right QBO accounts. Read-only — this never writes to
              QuickBooks.
            </p>
            <p className="text-sm font-medium text-foreground">{coaStatus}</p>
            <RefreshCoaButton />
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Button render={<Link href="/mappings" />} variant="link" className="h-auto px-0">
                Manage account mappings →
              </Button>
              <Button render={<a href="/qbo/connect" />} variant="link" className="h-auto px-0">
                {connected ? "Reconnect QuickBooks" : "Connect QuickBooks"}
              </Button>
            </p>
            {connected && (
              <>
                <Separator />
                <DisconnectQboButton />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mt-8 shadow-xs">
        <CardHeader>
          <CardTitle>How QTekLink posts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Tekmetric webhooks land all day; the nightly sync builds each business day into up
            to <span className="font-medium text-foreground">3 daily journal entries</span> (sales, payments, CC
            fees). Review a day on{" "}
            <Link href="/approvals" className="font-medium text-primary underline underline-offset-4">Daily approvals</Link>{" "}
            — nothing posts to QuickBooks without an admin&apos;s explicit approval.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

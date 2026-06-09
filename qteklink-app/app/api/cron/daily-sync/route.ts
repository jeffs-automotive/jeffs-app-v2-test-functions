/**
 * GET /api/cron/daily-sync — the nightly qteklink-sync (C8, plan §10), fired by the Vercel
 * Cron in vercel.json (~3 AM ET). For every connected shop it reconciles the prior
 * business day + (if the shop's auto_post is on) posts the clean drafts; Part 2 adds the
 * Tekmetric + QBO 2-API completeness safety-net.
 *
 * AUTH: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET env
 * is set — we reject anything else (no public trigger of a financial job). A per-shop error
 * is isolated (captured + recorded) so one shop can't abort the others.
 */
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { listConnectedShops, runNightlySync, type NightlyShopResult } from "@/lib/dal/nightly-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // reconcile + (auto-post) + the 2-API net can take a while

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const shops = await listConnectedShops();
    const results: (NightlyShopResult | { shopId: number; error: string })[] = [];
    for (const shopId of shops) {
      try {
        results.push(await runNightlySync(shopId));
      } catch (e) {
        // Isolate a per-shop failure — record it + keep going.
        Sentry.captureException(e, { tags: { qteklink_cron: "daily-sync", shop_id: String(shopId) } });
        results.push({ shopId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), shopCount: shops.length, results });
  } catch (e) {
    Sentry.captureException(e, { tags: { qteklink_cron: "daily-sync" } });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

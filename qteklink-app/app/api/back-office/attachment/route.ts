/**
 * Internal server-to-server endpoint: fetch a vendor doc's QBO attachment(s) so admin-app
 * (the service-advisor side, which has no QBO client of its own) can show the same
 * parts-invoice image the office manager sees. Reuses qteklink's QBO client + token
 * lifecycle — the single source of truth for QBO auth — rather than duplicating it.
 *
 * AUTH: Authorization: Bearer <Supabase service key> (constant-time compare). Only trusted
 * servers hold that key. Body: { shop_id, qbo_txn_type: 'Bill'|'Purchase', qbo_txn_id }.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";
import { fetchVendorDocAttachments, type VendorDocType } from "@/lib/qbo/vendor-docs";
import { QboClientError } from "@/lib/qbo/errors";

export const dynamic = "force-dynamic";

function bearerOk(bearer: string, key: string): boolean {
  if (!bearer || bearer.length !== key.length) return false;
  try {
    return timingSafeEqual(Buffer.from(bearer), Buffer.from(key));
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  const key = resolveServiceRoleKey();
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!key || !bearerOk(bearer, key)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { shop_id?: unknown; qbo_txn_type?: unknown; qbo_txn_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const shopId = Number(body.shop_id);
  const txnType = String(body.qbo_txn_type ?? "") as VendorDocType;
  const txnId = String(body.qbo_txn_id ?? "").trim();
  if (!Number.isInteger(shopId) || shopId <= 0 || (txnType !== "Bill" && txnType !== "Purchase") || !txnId) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  try {
    const attachments = await fetchVendorDocAttachments(shopId, txnType, txnId);
    return NextResponse.json({ ok: true, attachments });
  } catch (e) {
    if (e instanceof QboClientError) {
      return NextResponse.json({ ok: false, error: e.message });
    }
    Sentry.captureException(e, { tags: { surface: "back-office-attachment-route" } });
    return NextResponse.json({ ok: false, error: "Couldn't load the image from QuickBooks." });
  }
}

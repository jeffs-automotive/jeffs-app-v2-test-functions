/**
 * GET /qbo/connect — start (or restart) the QuickBooks OAuth handshake.
 *
 * This is the Intuit "Connect/Reconnect URL" (it must live on the app's host
 * domain, qteklink.jeffsautomotive.com — Intuit won't accept the cross-domain
 * Supabase edge-function URL there). It simply 302-redirects to the existing
 * qbo-oauth-callback edge function in `?start=1` mode, which builds the signed
 * `state` + redirects to Intuit's consent screen. Connect and reconnect are the
 * same flow (re-running overwrites the stored grant).
 *
 * NOT auth-gated: a customer connecting from the QuickBooks app card isn't logged
 * into QTekLink, and the real gate is Intuit's own login + consent. No secrets are
 * exposed — only the public Supabase URL + ?start=1.
 */
import { NextResponse } from "next/server";
import { resolveSupabaseUrl } from "@/lib/supabase/resolve-keys";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseUrl = resolveSupabaseUrl();
  if (!supabaseUrl) {
    return NextResponse.json(
      { error: "Supabase URL is not configured." },
      { status: 500 },
    );
  }
  const target = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/qbo-oauth-callback?start=1`;
  return NextResponse.redirect(target, 302);
}

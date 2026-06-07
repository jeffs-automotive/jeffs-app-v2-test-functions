// qbo-coa-sync.mjs — onboarding / re-sync of the QBO Chart-of-Accounts mirror for
// a shop+realm. Faithfully mirrors the syncQboAccounts DAL: query the full chart
// (SELECT * FROM Account WHERE Active IN (true,false)) and feed it to the
// qbo_accounts_sync TRUE-MIRROR RPC, INCLUDING the new acct_num. Use it to backfill
// acct_num onto an already-synced mirror, or to onboard a realm headless when the
// deployed "Refresh COA" button isn't convenient. The heavy logic (revive / soft-
// delete absent / live count) stays in the RPC — this only fetches + field-maps.
//
// Run:  cd qteklink-app && node --env-file=.env.local scripts/qbo-coa-sync.mjs
import { createClient } from "@supabase/supabase-js";
import OAuthClient from "intuit-oauth";

const REALM = "9341455608740708"; // Jeff's QBO company (onboarding target)
const SHOP_ID = 7476;             // Tekmetric shop_id, bound in qbo_connections

function serviceKey() {
  const dict = process.env.SUPABASE_SECRET_KEYS;
  if (dict) {
    try {
      const p = JSON.parse(dict);
      for (const v of Array.isArray(p) ? p : Object.values(p)) {
        const s = typeof v === "string" ? v : v?.value;
        if (s) return s;
      }
    } catch {
      // Not the JSON-dict form — fall through to the singular env vars below.
      // Don't log the error object: a JSON.parse message can echo the malformed secret.
      console.warn("SUPABASE_SECRET_KEYS was set but is not valid JSON; falling back to SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY.");
    }
  }
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = serviceKey();
const environment = process.env.QBO_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
const baseUrl = environment === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
if (!SUPABASE_URL || !SERVICE_KEY || !process.env.QBO_CLIENT_ID) { console.error("FAIL: missing env"); process.exit(2); }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function accessToken() {
  const { data, error } = await sb.rpc("qbo_get_connection", { p_realm_id: REALM });
  if (error) throw new Error(`qbo_get_connection failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("no QBO connection for realm");
  if (Date.parse(row.access_token_expires_at) - Date.now() > 5 * 60_000) return row.access_token;
  const oauth = new OAuthClient({ environment, clientId: process.env.QBO_CLIENT_ID, clientSecret: process.env.QBO_CLIENT_SECRET, redirectUri: process.env.QBO_REDIRECT_URI || "" });
  const tok = (await oauth.refreshUsingToken(row.refresh_token)).getToken();
  const now = Date.now();
  const { error: pe } = await sb.rpc("qbo_persist_tokens", {
    p_realm_id: REALM, p_access_token: tok.access_token, p_refresh_token: tok.refresh_token,
    p_access_token_expires_at: new Date(now + (tok.expires_in ?? 3600) * 1000).toISOString(),
    p_refresh_token_expires_at: new Date(now + (tok.x_refresh_token_expires_in ?? 8726400) * 1000).toISOString(),
  });
  if (pe) throw new Error(`qbo_persist_tokens failed (rotated token not saved): ${pe.message}`);
  return tok.access_token;
}

const main = async () => {
  const token = await accessToken();
  const q = "SELECT * FROM Account WHERE Active IN (true, false) MAXRESULTS 1000";
  const res = await fetch(`${baseUrl}/v3/company/${REALM}/query?query=${encodeURIComponent(q)}&minorversion=75`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Account query failed (${res.status}): ${await res.text()}`);
  const accounts = (await res.json()).QueryResponse?.Account ?? [];
  // Fail closed on the page cap (same as the DAL): a full page means the chart is
  // likely larger + this would be a partial mirror reported as success.
  if (accounts.length >= 1000) throw new Error("1000-account page cap hit — pagination required (fail closed)");

  const rows = accounts
    .filter((a) => String(a.Id ?? "").trim() && String(a.Name ?? "").trim())
    .map((a) => ({
      qbo_account_id: String(a.Id),
      name: a.Name,
      acct_num: a.AcctNum ?? null,
      fully_qualified_name: a.FullyQualifiedName ?? null,
      account_type: a.AccountType ?? null,
      account_sub_type: a.AccountSubType ?? null,
      classification: a.Classification ?? null,
      active: a.Active ?? true,
    }));

  const { data, error } = await sb.rpc("qbo_accounts_sync", { p_shop_id: SHOP_ID, p_realm_id: REALM, p_accounts: rows });
  if (error) throw new Error(`qbo_accounts_sync failed: ${error.message}`);
  const withNum = rows.filter((r) => r.acct_num).length;
  console.log(`Synced ${data} live accounts for shop ${SHOP_ID} / realm ${REALM} (${rows.length} sent, ${withNum} carry an acct_num).`);
};
main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });

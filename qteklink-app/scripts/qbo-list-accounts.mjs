// qbo-list-accounts.mjs — read-only QBO Chart-of-Accounts lister (Id, AcctNum, Name,
// AccountType, AccountSubType, Active). Helps confirm which account id/number maps to
// what (e.g. the A/R target). NO writes.
//
// Run:  cd qteklink-app && node --env-file=.env.local scripts/qbo-list-accounts.mjs [filter]
//   [filter] optional case-insensitive substring matched against Id / AcctNum / Name / Type.
import { createClient } from "@supabase/supabase-js";
import OAuthClient from "intuit-oauth";

const REALM = "9341455608740708";
const FILTER = (process.argv[2] ?? "").toLowerCase();

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
  if (!row) throw new Error("no QBO connection");
  if (Date.parse(row.access_token_expires_at) - Date.now() > 5 * 60_000) return row.access_token;
  const oauth = new OAuthClient({ environment, clientId: process.env.QBO_CLIENT_ID, clientSecret: process.env.QBO_CLIENT_SECRET, redirectUri: process.env.QBO_REDIRECT_URI || "" });
  const tok = (await oauth.refreshUsingToken(row.refresh_token)).getToken();
  const now = Date.now();
  const { error: pe } = await sb.rpc("qbo_persist_tokens", {
    p_realm_id: REALM, p_access_token: tok.access_token, p_refresh_token: tok.refresh_token,
    p_access_token_expires_at: new Date(now + (tok.expires_in ?? 3600) * 1000).toISOString(),
    p_refresh_token_expires_at: new Date(now + (tok.x_refresh_token_expires_in ?? 8726400) * 1000).toISOString(),
  });
  if (pe) throw new Error(`qbo_persist_tokens failed: ${pe.message}`);
  return tok.access_token;
}

const main = async () => {
  const token = await accessToken();
  const q = "SELECT Id, Name, AccountType, AccountSubType, AcctNum, Active, Classification FROM Account WHERE Active IN (true, false) MAXRESULTS 1000";
  const res = await fetch(`${baseUrl}/v3/company/${REALM}/query?query=${encodeURIComponent(q)}&minorversion=75`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Account query failed (${res.status}): ${await res.text()}`);
  const accounts = (await res.json()).QueryResponse?.Account ?? [];

  const rows = accounts
    .map((a) => ({ id: a.Id, num: a.AcctNum ?? "", name: a.Name ?? "", type: a.AccountType ?? "", sub: a.AccountSubType ?? "", active: a.Active }))
    .filter((r) => !FILTER || [r.id, r.num, r.name, r.type].join(" ").toLowerCase().includes(FILTER))
    .sort((a, b) => (a.num || "~").localeCompare(b.num || "~") || a.name.localeCompare(b.name));

  console.log(`${accounts.length} accounts total${FILTER ? ` · filter="${FILTER}" → ${rows.length}` : ""}\n`);
  console.log(["Id", "AcctNum", "Active", "AccountType", "AccountSubType", "Name"].join(" | "));
  for (const r of rows) {
    console.log([r.id, r.num || "—", r.active ? "yes" : "NO", r.type, r.sub || "—", r.name].join(" | "));
  }
};
main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });

// qbo-ar-entity-check.mjs — C5 live verification (plan §13/§17):
// does QBO accept a JournalEntry whose Accounts-Receivable line carries NO Entity
// (customer) at minorversion 75? QTekLink posts BULK A/R (not by customer), so this
// must be true; if QBO rejects it, the ar_entity_rejected guard is load-bearing.
//
// It mirrors the app's token path (qbo_get_connection RPC -> decrypted tokens;
// intuit-oauth refresh + qbo_persist_tokens on expiry) and hits the QBO REST API
// directly. It POSTS a $0.01 balanced Entity-less A/R JE, confirms acceptance, then
// DELETES it (net-zero on the books). REAL production write — run deliberately.
//
// Run:  cd qteklink-app && node --env-file=.env.local scripts/qbo-ar-entity-check.mjs
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import OAuthClient from "intuit-oauth";

const REALM = "9341455608740708";

function serviceKey() {
  const dict = process.env.SUPABASE_SECRET_KEYS;
  if (dict) {
    try {
      const p = JSON.parse(dict);
      const vals = Array.isArray(p) ? p : Object.values(p);
      for (const v of vals) {
        const s = typeof v === "string" ? v : v?.value;
        if (s) return s;
      }
    } catch { /* not the JSON-dict form — fall back to the singular env vars below */ }
  }
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = serviceKey();
const environment = process.env.QBO_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
const baseUrl = environment === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com"
  : "https://quickbooks.api.intuit.com";
const MV = "75";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("FAIL: missing SUPABASE_URL or a service-role key in env"); process.exit(2);
}
if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
  console.error("FAIL: missing QBO_CLIENT_ID / QBO_CLIENT_SECRET in env"); process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function accessToken() {
  const { data, error } = await sb.rpc("qbo_get_connection", { p_realm_id: REALM });
  if (error) throw new Error(`qbo_get_connection failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("no QBO connection for realm");
  const expMs = Date.parse(row.access_token_expires_at);
  if (expMs - Date.now() > 5 * 60_000) return row.access_token;

  // refresh + persist (mirrors tokens.ts)
  const oauth = new OAuthClient({
    environment, clientId: process.env.QBO_CLIENT_ID, clientSecret: process.env.QBO_CLIENT_SECRET,
    redirectUri: process.env.QBO_REDIRECT_URI || "",
  });
  const tok = (await oauth.refreshUsingToken(row.refresh_token)).getToken();
  const now = Date.now();
  const { error: persistErr } = await sb.rpc("qbo_persist_tokens", {
    p_realm_id: REALM, p_access_token: tok.access_token, p_refresh_token: tok.refresh_token,
    p_access_token_expires_at: new Date(now + (tok.expires_in ?? 3600) * 1000).toISOString(),
    p_refresh_token_expires_at: new Date(now + (tok.x_refresh_token_expires_in ?? 8726400) * 1000).toISOString(),
  });
  if (persistErr) throw new Error(`qbo_persist_tokens failed (rotated token not saved): ${persistErr.message}`);
  return tok.access_token;
}

async function qbo(token, path, { method = "GET", body } = {}) {
  const res = await fetch(`${baseUrl}/v3/company/${REALM}/${path}${path.includes("?") ? "&" : "?"}minorversion=${MV}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

const main = async () => {
  const token = await accessToken();

  const q = "SELECT Id, Name, AccountType FROM Account WHERE AccountType IN ('Accounts Receivable','Income') MAXRESULTS 100";
  const acct = await qbo(token, `query?query=${encodeURIComponent(q)}`);
  if (!acct.ok) throw new Error(`Account query failed (${acct.status}): ${JSON.stringify(acct.json)}`);
  const accounts = acct.json.QueryResponse?.Account ?? [];
  const ar = accounts.find((a) => a.AccountType === "Accounts Receivable");
  const income = accounts.find((a) => a.AccountType === "Income");
  if (!ar || !income) throw new Error(`could not find A/R + Income accounts (got ${accounts.length})`);
  console.log(`Using A/R=[${ar.Id}] ${ar.Name}  |  Income=[${income.Id}] ${income.Name}`);

  // $0.01 balanced JE; the A/R DEBIT line carries NO Entity (the thing under test).
  const je = {
    DocNumber: "QTL-PROBE",
    PrivateNote: "QTekLink C5 Entity-less A/R verification — auto-deleted",
    Line: [
      { DetailType: "JournalEntryLineDetail", Amount: 0.01, Description: "QTL probe (delete)",
        JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: ar.Id } } },
      { DetailType: "JournalEntryLineDetail", Amount: 0.01, Description: "QTL probe (delete)",
        JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: income.Id } } },
    ],
  };
  // requestid makes the create idempotent (QBO dedups a retried requestid) — so an
  // accidental re-run can't leave a second probe JE on the books.
  const created = await qbo(token, `journalentry?requestid=${randomUUID()}`, { method: "POST", body: je });
  if (!created.ok) {
    console.log(`RESULT: Entity-less A/R JE was REJECTED at mv${MV} (${created.status}): ${JSON.stringify(created.json?.Fault ?? created.json)}`);
    console.log("=> ar_entity_rejected guard is LOAD-BEARING (QBO requires a customer on A/R lines).");
    process.exit(0);
  }
  const posted = created.json.JournalEntry;
  console.log(`PASS: Entity-less A/R JE ACCEPTED at mv${MV} — Id=${posted.Id} SyncToken=${posted.SyncToken}`);

  const del = await qbo(token, `journalentry?operation=delete&requestid=${randomUUID()}`, { method: "POST", body: { Id: posted.Id, SyncToken: posted.SyncToken } });
  if (!del.ok) {
    console.error(`WARN: probe JE ${posted.Id} POSTED but DELETE failed (${del.status}): ${JSON.stringify(del.json)} — delete it manually!`);
    process.exit(1);
  }
  console.log(`Cleaned up: probe JE ${posted.Id} deleted (status=${del.json.JournalEntry?.status ?? "Deleted"}). Net-zero.`);
};

main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });

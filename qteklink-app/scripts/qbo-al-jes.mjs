// qbo-al-jes.mjs — READ-ONLY: fetch Accounting Link's JournalEntries from Jeff's
// QBO for a date window, to inspect their structure (DocNumber / accounts / amounts)
// and drive the daily QTekLink-vs-AL reconciliation report. No writes.
//
// Run:  cd qteklink-app && node --env-file=.env.local scripts/qbo-al-jes.mjs [from] [to] [--lines]
//   from/to default 2026-05-09 / 2026-06-06 (ISO date). --lines dumps each JE's lines.
import { createClient } from "@supabase/supabase-js";
import OAuthClient from "intuit-oauth";

const REALM = "9341455608740708";
const args = process.argv.slice(2).filter((a) => a !== "--lines");
const SHOW_LINES = process.argv.includes("--lines");
const FROM = args[0] ?? "2026-05-09";
const TO = args[1] ?? "2026-06-06";

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
  if (pe) throw new Error(`qbo_persist_tokens failed: ${pe.message}`);
  return tok.access_token;
}

const main = async () => {
  const token = await accessToken();
  const q = `SELECT * FROM JournalEntry WHERE TxnDate >= '${FROM}' AND TxnDate <= '${TO}' ORDERBY TxnDate MAXRESULTS 1000`;
  const res = await fetch(`${baseUrl}/v3/company/${REALM}/query?query=${encodeURIComponent(q)}&minorversion=75`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`JournalEntry query failed (${res.status}): ${await res.text()}`);
  const jes = (res.json ? await res.json() : {}).QueryResponse?.JournalEntry ?? [];

  console.log(`Accounting Link JournalEntries ${FROM}..${TO}: ${jes.length}\n`);
  console.log(["TxnDate", "DocNumber", "TotalAmt", "lines", "PrivateNote"].join(" | "));
  // group by DocNumber prefix (JA-RO / JA-PAY / JA-FEE …) to see the daily-JE pattern
  const byPrefix = new Map();
  for (const je of jes) {
    const doc = je.DocNumber ?? "(none)";
    const prefix = (doc.match(/^[A-Za-z-]+/) ?? ["?"])[0];
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
    console.log([je.TxnDate, doc, je.TotalAmt, je.Line?.length ?? 0, (je.PrivateNote ?? "").slice(0, 50)].join(" | "));
    if (SHOW_LINES) {
      for (const ln of je.Line ?? []) {
        const d = ln.JournalEntryLineDetail ?? {};
        console.log(`      ${d.PostingType ?? "?"} ${d.AccountRef?.value ?? "?"} "${d.AccountRef?.name ?? ""}" ${ln.Amount} ${ln.Description ? "— " + ln.Description.slice(0, 40) : ""}`);
      }
    }
  }
  // Per-day AL totals (the daily reconciliation anchors): JA-RO A/R debits = sales,
  // JA-PAY A/R credits = payments cleared, JA-FEE 309 debits = CC fees.
  const byDay = new Map();
  for (const je of jes) {
    const doc = je.DocNumber ?? "";
    const r = byDay.get(je.TxnDate) ?? { sales: 0, pay: 0, fee: 0 };
    for (const ln of je.Line ?? []) {
      const d = ln.JournalEntryLineDetail ?? {};
      const amt = Number(ln.Amount) || 0;
      if (/RO/.test(doc) && d.PostingType === "Debit" && d.AccountRef?.value === "235") r.sales += amt;
      else if (/PAY/.test(doc) && d.PostingType === "Credit" && d.AccountRef?.value === "235") r.pay += amt;
      else if (/FEE/.test(doc) && d.PostingType === "Debit" && d.AccountRef?.value === "309") r.fee += amt;
    }
    byDay.set(je.TxnDate, r);
  }
  console.log("\nAL daily totals ($) — sales(JA-RO) | payments(JA-PAY) | ccfee(JA-FEE):");
  for (const [day, r] of [...byDay.entries()].sort()) {
    console.log(`${day} | ${r.sales.toFixed(2)} | ${r.pay.toFixed(2)} | ${r.fee.toFixed(2)}`);
  }
  console.log(`\nDocNumber prefixes: ${[...byPrefix.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
};
main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });

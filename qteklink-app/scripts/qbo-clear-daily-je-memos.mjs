// qbo-clear-daily-je-memos.mjs — one-off sweep (feature qteklink-deposit-memo-fallback,
// 2026-07-09): clear the QTL PrivateNote from already-posted, still-editable QTekLink
// payments/fees JEs so the QBO bank-deposit screen falls back to showing each row's
// per-line Description (check / credit card / cash) again. Sales JEs never touch
// Undeposited Funds → never appear on the deposit screen → skipped entirely.
//
// Per JE: full-replacement update (sparse:false) re-sending the CURRENT lines verbatim
// with PrivateNote omitted. Deposit-locked JEs (QBO fault 6540) are skipped — QBO
// forbids editing them, and their deposited rows already display correctly from the
// Deposit's own stored line copies. After a successful update the new SyncToken is
// written back to the ledger row so future corrections don't fail closed on a stale
// token. Rerunnable: already-clean JEs are skipped.
//
// Run:  cd qteklink-app && node --env-file=.env.local scripts/qbo-clear-daily-je-memos.mjs [--apply]
//   Dry-run by default (reports what would change). --apply executes.
import { createClient } from "@supabase/supabase-js";
import OAuthClient from "intuit-oauth";

const REALM = "9341455608740708";
const SHOP_ID = 7476;
const APPLY = process.argv.includes("--apply");

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
      console.warn("SUPABASE_SECRET_KEYS set but not valid JSON; falling back to SUPABASE_SECRET_KEY.");
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

async function fetchJe(token, id) {
  const res = await fetch(`${baseUrl}/v3/company/${REALM}/journalentry/${id}?minorversion=75`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`read JE ${id} failed (${res.status}): ${await res.text()}`);
  return (await res.json()).JournalEntry;
}

const main = async () => {
  // Latest posted version per (business_date, category) — updates reuse the same
  // qbo_je_id across versions, and the LATEST row is the one holding the live
  // SyncToken that must be kept in sync after our out-of-band update.
  const { data: rows, error } = await sb
    .from("qteklink_daily_postings")
    .select("id, business_date, category, posting_version, qbo_je_id, qbo_sync_token")
    .eq("shop_id", SHOP_ID).eq("realm_id", REALM)
    .eq("status", "posted").in("category", ["payments", "fees"])
    .not("qbo_je_id", "is", null)
    .order("business_date", { ascending: true }).order("posting_version", { ascending: false });
  if (error) throw new Error(`ledger query failed: ${error.message}`);
  const latest = new Map();
  for (const r of rows ?? []) {
    const key = `${r.business_date}|${r.category}`;
    if (!latest.has(key)) latest.set(key, r); // first seen = highest version (sorted desc)
  }
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"}: ${latest.size} posted payments/fees JEs to inspect\n`);

  const token = await accessToken();
  const tally = { cleared: 0, locked: 0, clean: 0, failed: 0 };
  for (const r of latest.values()) {
    const label = `${r.business_date} ${r.category} v${r.posting_version} (JE ${r.qbo_je_id})`;
    let je;
    try {
      je = await fetchJe(token, r.qbo_je_id);
    } catch (e) {
      tally.failed++;
      console.log(`FETCH-FAIL ${label}: ${e.message}`);
      continue;
    }
    if (!je.PrivateNote) { tally.clean++; console.log(`clean      ${label}`); continue; }
    if (!APPLY) { tally.cleared++; console.log(`WOULD-CLEAR ${label}: "${je.PrivateNote}"`); continue; }

    // Full replacement with the CURRENT lines verbatim; PrivateNote omitted → cleared.
    const body = { Id: je.Id, SyncToken: je.SyncToken, sparse: false, DocNumber: je.DocNumber, TxnDate: je.TxnDate, Line: je.Line };
    // Stable per-logical-update requestid (QBO idempotency is the `requestid` QUERY
    // PARAM, not a header): keyed on the JE + the SyncToken being replaced, so a
    // retry of THIS update dedupes, while a later re-run against an advanced
    // SyncToken (changed content) correctly gets a fresh id.
    const requestid = `qtl-memoclear-${je.Id}-st${je.SyncToken}`;
    try {
      const res = await fetch(`${baseUrl}/v3/company/${REALM}/journalentry?minorversion=75&requestid=${encodeURIComponent(requestid)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        if (text.includes("6540")) { tally.locked++; console.log(`locked     ${label} (in a deposit — QBO forbids edits; rows display from the deposit's copies)`); continue; }
        throw new Error(`update failed (${res.status}): ${text.slice(0, 300)}`);
      }
      const updated = JSON.parse(text).JournalEntry;
      if (updated.PrivateNote) throw new Error(`PrivateNote still present after update (SyncToken ${updated.SyncToken})`);
      const { error: le } = await sb.from("qteklink_daily_postings")
        .update({ qbo_sync_token: String(updated.SyncToken) }).eq("id", r.id);
      if (le) throw new Error(`ledger SyncToken sync failed (QBO IS updated, token now ${updated.SyncToken}): ${le.message}`);
      tally.cleared++;
      console.log(`CLEARED    ${label} → SyncToken ${updated.SyncToken} (ledger synced)`);
    } catch (e) {
      tally.failed++;
      console.log(`FAIL       ${label}: ${e.message}`);
    }
  }
  console.log(`\n${APPLY ? "cleared" : "would clear"}=${tally.cleared} locked=${tally.locked} already-clean=${tally.clean} failed=${tally.failed}`);
  if (tally.failed > 0) process.exit(1);
};
main().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });

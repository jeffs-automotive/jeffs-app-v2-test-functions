/** Throwaway (deleted after run): mark every past business day (2026-05-11 → 2026-06-10)
 *  as ACKNOWLEDGED — approved WITHOUT posting (Accounting Link posted those days).
 *  Reconciles each day first so its rows exist; acknowledges all pending rows.
 *  Skips days QTekLink posted (none exist) and empty days (no rows). NO QBO writes. */
import { runDailyReconciliation } from "./src/lib/dal/daily-reconcile";
import { listDailyPostingsForDay, acknowledgeDailyPosting } from "./src/lib/dal/daily-postings";

const SHOP = 7476;
const FROM = "2026-05-11";
const TO = "2026-06-10";
const BY = "chris@jeffsautomotive.com (backfill: covered by Accounting Link)";

function* dates(from: string, to: string): Generator<string> {
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

let totalAck = 0;
for (const day of dates(FROM, TO)) {
  const recon = await runDailyReconciliation(SHOP, day);
  if (!recon.realmId) throw new Error("no realm");
  const { postings } = await listDailyPostingsForDay(SHOP, day);
  if (postings.some((p) => ["posted", "posting", "approved"].includes(p.status))) {
    console.log(JSON.stringify({ day, skipped: "has QTekLink-posted rows" }));
    continue;
  }
  let ack = 0;
  for (const p of postings.filter((p) => p.status === "pending")) {
    const r = await acknowledgeDailyPosting(SHOP, p.id, BY);
    if (r.acknowledged) ack++;
  }
  totalAck += ack;
  if (ack > 0 || postings.length > 0) console.log(JSON.stringify({ day, rows: postings.length, acknowledged: ack }));
}
console.log(JSON.stringify({ done: true, totalAcknowledged: totalAck }));

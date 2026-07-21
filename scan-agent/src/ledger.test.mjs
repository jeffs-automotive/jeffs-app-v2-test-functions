// Ledger tests — crash-proofing is THE property (plan D12).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLedger, nextRetryMs } from "./ledger.mjs";

function tmpLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  return path.join(dir, "ledger.jsonl");
}

describe("ledger", () => {
  it("append + replay: last record per id wins", () => {
    const p = tmpLedger();
    const a = createLedger(p);
    a.append({ id: "j1", state: "claimed", profileKey: "inspection_docs" });
    a.append({ id: "j1", state: "minted", objectPath: "x/y.pdf" });
    a.append({ id: "j2", state: "claimed" });

    const b = createLedger(p);
    const jobs = b.replay();
    expect(jobs.get("j1").state).toBe("minted");
    expect(jobs.get("j1").objectPath).toBe("x/y.pdf");
    expect(jobs.get("j1").profileKey).toBe("inspection_docs"); // merged, not replaced
    expect(jobs.get("j2").state).toBe("claimed");
  });

  it("replay tolerates a torn final line (crash mid-append)", () => {
    const p = tmpLedger();
    const a = createLedger(p);
    a.append({ id: "j1", state: "claimed" });
    fs.appendFileSync(p, '{"id":"j2","state":"cla'); // torn
    const b = createLedger(p);
    const jobs = b.replay();
    expect(jobs.has("j1")).toBe(true);
    expect(jobs.has("j2")).toBe(false);
  });

  it("compact drops old terminal jobs, keeps active + recent", () => {
    const p = tmpLedger();
    const a = createLedger(p);
    a.append({ id: "old-done", state: "done" });
    a.jobs.get("old-done").at = new Date(Date.now() - 40 * 86_400_000).toISOString();
    a.append({ id: "active", state: "claimed" });
    const kept = a.compact(30);
    expect(kept).toBe(1);
    const b = createLedger(p);
    b.replay();
    expect(b.jobs.has("old-done")).toBe(false);
    expect(b.jobs.has("active")).toBe(true);
  });

  it("active() excludes terminal states", () => {
    const p = tmpLedger();
    const a = createLedger(p);
    a.append({ id: "1", state: "claimed" });
    a.append({ id: "2", state: "done" });
    a.append({ id: "3", state: "failed_permanent" });
    a.append({ id: "4", state: "uploaded" });
    expect(a.active().map((j) => j.id).sort()).toEqual(["1", "4"]);
  });

  it("nextRetryMs backs off exponentially and caps at 30min", () => {
    expect(nextRetryMs(0)).toBe(5 * 60_000);
    expect(nextRetryMs(1)).toBe(10 * 60_000);
    expect(nextRetryMs(2)).toBe(20 * 60_000);
    expect(nextRetryMs(3)).toBe(30 * 60_000);
    expect(nextRetryMs(10)).toBe(30 * 60_000);
  });
});

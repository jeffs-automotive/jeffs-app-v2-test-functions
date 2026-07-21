// Pipeline tests — the cross-verify gates: stability before consumption,
// atomic claim, ledger-before-side-effect, retry-reuses-the-minted-path,
// rejected files parked (never deleted), purge respects retention.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLedger } from "./ledger.mjs";
import { sniffMime } from "./sniff.mjs";
import {
  claimFile, createGateway, processJob, purgeUploaded, waitForStable,
} from "./pipeline.mjs";

const PDF = Buffer.from("%PDF-1.7 test document body");

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scanagent-"));
  const dirs = {
    scans: path.join(root, "Scans", "inspection_docs"),
    workDir: path.join(root, "work"),
    uploadedDir: path.join(root, "archive", "uploaded"),
    failedDir: path.join(root, "archive", "failed"),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { root, dirs, ledger: createLedger(path.join(root, "ledger.jsonl")) };
}

function stagedJob(t, name = "scan one.pdf", bytes = PDF) {
  const stagedPath = path.join(t.dirs.workDir, `job-1${path.extname(name)}`);
  fs.writeFileSync(stagedPath, bytes);
  // Mirror the production contract (agent.mjs): claim is APPENDED to the
  // ledger before any processing — retries re-read the merged record.
  return t.ledger.append({
    id: "job-1", state: "claimed", stagedPath, originalName: name,
    profileKey: "inspection_docs", attempts: 0,
  });
}

function okGateway(overrides = {}) {
  const calls = [];
  return {
    calls,
    requestUpload: async (args) => {
      calls.push(["request_upload", args]);
      return overrides.requestUpload?.(args) ?? {
        status: 200,
        body: { ok: true, object_path: args.object_path ?? "7476/inspection_docs/scan/2026/07/1_ab12_deadbeef.pdf", signed_url: "https://signed.example/put", token: "tok", already_uploaded: false },
      };
    },
    confirm: async (args) => {
      calls.push(["confirm", args]);
      return overrides.confirm?.(args) ?? { status: 200, body: { ok: true } };
    },
    heartbeat: async () => ({ status: 200, body: { ok: true } }),
  };
}

describe("sniffMime", () => {
  it("recognizes pdf/jpeg/png and rejects executables", () => {
    expect(sniffMime(new Uint8Array(PDF))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 1]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 1, 1, 1]))).toBe("image/png");
    expect(sniffMime(new Uint8Array(Buffer.from("MZ\x90\x00 not a pdf")))).toBe(null);
  });
});

describe("waitForStable", () => {
  it("waits out a growing file, then requires the stability window", async () => {
    const t = tmpRoot();
    const p = path.join(t.dirs.scans, "grow.pdf");
    fs.writeFileSync(p, "part1");
    setTimeout(() => fs.appendFileSync(p, "part2"), 30);
    const res = await waitForStable(p, { stabilityMs: 80, pollMs: 15, maxWaitMs: 3000 });
    expect(res.ok).toBe(true);
    expect(res.size).toBe(Buffer.byteLength("part1part2"));
  });

  it("reports a vanished file instead of throwing", async () => {
    const t = tmpRoot();
    const res = await waitForStable(path.join(t.dirs.scans, "never.pdf"), { stabilityMs: 20, pollMs: 10, maxWaitMs: 100 });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("vanished");
  });
});

describe("claimFile", () => {
  it("moves into work dir under a uuid; the losing racer gets null", async () => {
    const t = tmpRoot();
    const src = path.join(t.dirs.scans, "card.pdf");
    fs.writeFileSync(src, PDF);
    const claim = await claimFile(src, t.dirs.workDir, "inspection_docs");
    expect(claim).not.toBeNull();
    expect(fs.existsSync(claim.stagedPath)).toBe(true);
    expect(fs.existsSync(src)).toBe(false);
    expect(claim.originalName).toBe("card.pdf");
    const second = await claimFile(src, t.dirs.workDir, "inspection_docs");
    expect(second).toBeNull();
  });
});

describe("processJob", () => {
  it("happy path: minted → PUT → confirm → archived + done, ledger sequenced", async () => {
    const t = tmpRoot();
    const job = stagedJob(t);
    const gateway = okGateway();
    const putCalls = [];
    const fetchImpl = async (url, init) => {
      putCalls.push([url, init.method, init.headers["Content-Type"]]);
      return new Response("{}", { status: 200 });
    };
    const result = await processJob(job, { ledger: t.ledger, gateway, layoutDirs: t.dirs, fetchImpl });
    expect(result).toBe("done");
    expect(putCalls).toEqual([["https://signed.example/put", "PUT", "application/pdf"]]);
    const final = t.ledger.jobs.get("job-1");
    expect(final.state).toBe("done");
    expect(final.objectPath).toMatch(/^7476\/inspection_docs\/scan\//);
    expect(fs.existsSync(final.archivedAt)).toBe(true);
    expect(final.archivedAt).toContain(path.join("archive", "uploaded", "inspection_docs"));
    expect(fs.existsSync(job.stagedPath)).toBe(false);
  });

  it("PUT failure → retry_scheduled with backoff; retry reuses the SAME minted path", async () => {
    const t = tmpRoot();
    const job = stagedJob(t);
    const gateway = okGateway();
    let putAttempts = 0;
    const failingFetch = async () => {
      putAttempts++;
      return new Response("boom", { status: 503 });
    };
    const r1 = await processJob(job, { ledger: t.ledger, gateway, layoutDirs: t.dirs, fetchImpl: failingFetch });
    expect(r1).toBe("retry_scheduled");
    const afterFail = t.ledger.jobs.get("job-1");
    expect(afterFail.attempts).toBe(1);
    expect(afterFail.objectPath).toBeDefined();
    expect(new Date(afterFail.nextRetryAt).getTime()).toBeGreaterThan(Date.now());

    const okFetch = async () => new Response("{}", { status: 200 });
    const r2 = await processJob(afterFail, { ledger: t.ledger, gateway, layoutDirs: t.dirs, fetchImpl: okFetch });
    expect(r2).toBe("done");
    const mintCalls = gateway.calls.filter(([op]) => op === "request_upload");
    expect(mintCalls).toHaveLength(2);
    expect(mintCalls[1][1].object_path).toBe(afterFail.objectPath); // retry sent the persisted path
  });

  it("gateway 422 → parked in failed/, terminal, file NOT deleted", async () => {
    const t = tmpRoot();
    const job = stagedJob(t);
    const gateway = okGateway({
      requestUpload: () => ({ status: 422, body: { ok: false, error: "unsupported_type" } }),
    });
    const result = await processJob(job, { ledger: t.ledger, gateway, layoutDirs: t.dirs, fetchImpl: async () => new Response("{}") });
    expect(result).toBe("failed_permanent");
    const rec = t.ledger.jobs.get("job-1");
    expect(rec.error).toBe("gateway_rejected:unsupported_type");
    expect(fs.existsSync(rec.parkedAt)).toBe(true);
    expect(rec.parkedAt).toContain(path.join("archive", "failed", "inspection_docs"));
  });

  it("magic-byte failure → parked, never uploaded", async () => {
    const t = tmpRoot();
    const job = stagedJob(t, "notes.txt", Buffer.from("just some text, not a document"));
    const gateway = okGateway();
    const result = await processJob(job, { ledger: t.ledger, gateway, layoutDirs: t.dirs, fetchImpl: async () => new Response("{}") });
    expect(result).toBe("failed_permanent");
    expect(gateway.calls).toHaveLength(0);
    expect(fs.existsSync(t.ledger.jobs.get("job-1").parkedAt)).toBe(true);
  });

  it("already_uploaded short-circuit skips the PUT but still confirms + archives", async () => {
    const t = tmpRoot();
    const job = { ...stagedJob(t), objectPath: "7476/inspection_docs/scan/2026/07/9_aa11_deadbeef.pdf" };
    const gateway = okGateway({
      requestUpload: (args) => ({
        status: 200,
        body: { ok: true, object_path: args.object_path, already_uploaded: true },
      }),
    });
    let putHappened = false;
    const fetchImpl = async () => {
      putHappened = true;
      return new Response("{}", { status: 200 });
    };
    const result = await processJob(job, { ledger: t.ledger, gateway, layoutDirs: t.dirs, fetchImpl });
    expect(result).toBe("done");
    expect(putHappened).toBe(false);
    expect(gateway.calls.map(([op]) => op)).toEqual(["request_upload", "confirm"]);
  });
});

describe("purgeUploaded", () => {
  it("removes files past retention, keeps recent ones", async () => {
    const t = tmpRoot();
    const dir = path.join(t.dirs.uploadedDir, "inspection_docs");
    fs.mkdirSync(dir, { recursive: true });
    const oldFile = path.join(dir, "old.pdf");
    const newFile = path.join(dir, "new.pdf");
    fs.writeFileSync(oldFile, "x");
    fs.writeFileSync(newFile, "y");
    const oldTime = new Date(Date.now() - 40 * 86_400_000);
    fs.utimesSync(oldFile, oldTime, oldTime);
    const removed = await purgeUploaded(t.dirs.uploadedDir, 30);
    expect(removed).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });
});

describe("scrubString (agent Sentry beforeSend)", () => {
  it("redacts emails, +1 phones, and scan-path filenames", async () => {
    const { scrubString } = await import("./agent.mjs");
    expect(scrubString("mail from jane.doe@example.com failed")).toBe("mail from [email] failed");
    expect(scrubString("call +12155551234 back")).toBe("call +1******1234 back");
    expect(scrubString("ENOENT: C:\\Scans\\inspection_docs\\jane doe policy 4411.pdf missing"))
      .toBe("ENOENT: C:\\Scans\\inspection_docs\\[file] missing");
    expect(scrubString("moved to C:\\ScanAgent\\archive\\failed\\loaner_insurance\\abc_card.pdf"))
      .toBe("moved to C:\\ScanAgent\\archive\\failed\\loaner_insurance\\[file]");
  });
});

describe("createGateway", () => {
  it("sends the bearer + hostname on every call", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push([url, init.headers.Authorization, JSON.parse(init.body)]);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const gw = createGateway(
      { gatewayUrl: "https://gw.example/fn", agentToken: "tok123", hostname: "SHOP-PC", agentVersion: "1.0.0" },
      fetchImpl,
    );
    await gw.heartbeat({ active_jobs: 0 });
    expect(seen[0][0]).toBe("https://gw.example/fn");
    expect(seen[0][1]).toBe("Bearer tok123");
    expect(seen[0][2].op).toBe("heartbeat");
    expect(seen[0][2].hostname).toBe("SHOP-PC");
  });
});

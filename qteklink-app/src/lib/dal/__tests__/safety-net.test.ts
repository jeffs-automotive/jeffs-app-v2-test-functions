/**
 * Unit tests for the 2-API completeness safety-net. Tekmetric posted-RO list + the QBO JE
 * query are INJECTED via deps; the events/postings reads + upsertReviewItem are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
const upsertReviewItemMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: fromMock }) }));
vi.mock("@/lib/dal/review-items", () => ({ upsertReviewItem: (...a: unknown[]) => upsertReviewItemMock(...a) }));

import { runTekmetricCompletenessCheck, runQboLandingCheck } from "../safety-net";

const REALM = "9341455608740708";
const DATE = "2026-06-06";
const TZ = "America/New_York";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lt", "not", "order", "limit"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe("runTekmetricCompletenessCheck", () => {
  it("flags a posted Tekmetric RO with no captured webhook; ignores non-posted / other-day / captured", async () => {
    fromMock.mockReturnValue(chain({ data: [{ tekmetric_ro_id: 1 }], error: null })); // events: only RO 1 captured
    const ros = [
      { id: 1, repairOrderStatusId: 5, postedDate: "2026-06-06T15:00:00Z" }, // posted, captured → ok
      { id: 2, repairOrderStatusId: 6, postedDate: "2026-06-06T16:00:00Z" }, // posted (A/R), NOT captured → GAP
      { id: 3, repairOrderStatusId: 3, postedDate: "2026-06-06T17:00:00Z" }, // not posted (completed) → ignore
      { id: 4, repairOrderStatusId: 5, postedDate: "2026-06-05T15:00:00Z" }, // posted but other day → ignore
    ];
    const r = await runTekmetricCompletenessCheck(7476, REALM, DATE, TZ, { listPostedRos: async () => ros });
    expect(r).toEqual({ checked: 2, gaps: 1 });
    expect(upsertReviewItemMock).toHaveBeenCalledTimes(1);
    expect(upsertReviewItemMock).toHaveBeenCalledWith(7476, expect.objectContaining({ kind: "missed_ro_webhook", subjectKind: "ro", subjectRef: "2" }));
  });

  it("clean day → no review items", async () => {
    fromMock.mockReturnValue(chain({ data: [{ tekmetric_ro_id: 1 }], error: null }));
    const r = await runTekmetricCompletenessCheck(7476, REALM, DATE, TZ, {
      listPostedRos: async () => [{ id: 1, repairOrderStatusId: 5, postedDate: "2026-06-06T15:00:00Z" }],
    });
    expect(r).toEqual({ checked: 1, gaps: 0 });
    expect(upsertReviewItemMock).not.toHaveBeenCalled();
  });
});

describe("runQboLandingCheck", () => {
  it("flags a posted posting whose JE is NOT in QBO for the day", async () => {
    fromMock.mockReturnValue(chain({
      data: [
        { qbo_je_id: "JE1", tekmetric_ro_id: 10, kind: "sale", payment_id: null },
        { qbo_je_id: "JE2", tekmetric_ro_id: 11, kind: "payment", payment_id: 101 },
      ],
      error: null,
    }));
    const qboQuery = vi.fn().mockResolvedValue({ QueryResponse: { JournalEntry: [{ Id: "JE1" }] } }); // JE2 missing
    const r = await runQboLandingCheck(7476, REALM, DATE, { qboQuery });
    expect(qboQuery).toHaveBeenCalledWith(expect.stringContaining(`TxnDate = '${DATE}'`));
    expect(r).toEqual({ checked: 2, gaps: 1 });
    expect(upsertReviewItemMock).toHaveBeenCalledWith(7476, expect.objectContaining({ kind: "posted_je_missing", subjectKind: "payment", subjectRef: "101" }));
  });

  it("no posted postings → no QBO query, no gaps", async () => {
    fromMock.mockReturnValue(chain({ data: [], error: null }));
    const qboQuery = vi.fn();
    const r = await runQboLandingCheck(7476, REALM, DATE, { qboQuery });
    expect(qboQuery).not.toHaveBeenCalled();
    expect(r).toEqual({ checked: 0, gaps: 0 });
  });
});

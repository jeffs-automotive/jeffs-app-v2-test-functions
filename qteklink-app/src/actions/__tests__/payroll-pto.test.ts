/**
 * Unit tests for the round-11 payroll PTO + employee-management server actions
 * (src/actions/payroll-pto.ts) — the browser-facing security boundary. Mocks
 * requireQtekUser, the PTO DAL (@/lib/dal/payroll), and wrapQtekAction
 * (passthrough) so we can assert:
 *   - shop_id ALWAYS comes from the SESSION, never a form field (multi-tenant rule);
 *   - the admin gate fires BEFORE the DAL on every mutation;
 *   - reason is REQUIRED on adjust, OPTIONAL on seed;
 *   - the employee-profile patch rides through with its patch semantics intact
 *     (present-null = clear, absent = keep) and unknown keys are rejected;
 *   - archive is ONE call (termination patch + archived true); unarchive is ONE
 *     call (archived false, DAL clears the date);
 *   - resend delegates to the failed→pending DAL orchestrator;
 *   - QboClientErrors envelope; Next redirect control-flow errors re-throw.
 * The DAL is mocked at the module boundary — the actions own only shaping + gating.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QboClientError } from "@/lib/qbo/errors";

const requireQtekUserMock = vi.fn();
const adjustPtoMock = vi.fn();
const seedInitialBalanceMock = vi.fn();
const updateEmployeeProfileMock = vi.fn();
const archiveEmployeeMock = vi.fn();
const unarchiveEmployeeMock = vi.fn();
const resendFailedPaySummariesMock = vi.fn();
const sendPtoAdjustmentAlertMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireQtekUser: () => requireQtekUserMock() }));
vi.mock("@/lib/dal/payroll", () => ({
  adjustPto: (...a: unknown[]) => adjustPtoMock(...a),
  seedInitialBalance: (...a: unknown[]) => seedInitialBalanceMock(...a),
  updateEmployeeProfile: (...a: unknown[]) => updateEmployeeProfileMock(...a),
  archiveEmployee: (...a: unknown[]) => archiveEmployeeMock(...a),
  unarchiveEmployee: (...a: unknown[]) => unarchiveEmployeeMock(...a),
  resendFailedPaySummaries: (...a: unknown[]) => resendFailedPaySummariesMock(...a),
  sendPtoAdjustmentAlert: (...a: unknown[]) => sendPtoAdjustmentAlertMock(...a),
}));
// wrapQtekAction is pure observability — pass through to the inner fn in tests.
vi.mock("@/lib/instrument-action", () => ({
  wrapQtekAction: (_name: string, inner: (...a: unknown[]) => unknown) => inner,
}));

import {
  adjustPtoAction,
  seedInitialBalanceAction,
  updateEmployeeProfileAction,
  archiveEmployeeAction,
  unarchiveEmployeeAction,
  resendPaySummariesAction,
} from "../payroll-pto";

const SESSION_SHOP = 7476;
const ACTOR = { userId: "u-1", label: "admin@jeffsautomotive.com" };
const EMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Build a FormData from a plain record (helper — the actions read FormData). */
function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const redirectErr = () =>
  Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });

beforeEach(() => {
  vi.clearAllMocks();
  requireQtekUserMock.mockResolvedValue({
    shopId: SESSION_SHOP,
    role: "admin",
    email: ACTOR.label,
    userId: ACTOR.userId,
    objectId: "o",
  });
  adjustPtoMock.mockResolvedValue({ ledgerId: "led1", balanceAfterHours: 14 });
  seedInitialBalanceMock.mockResolvedValue({ ledgerId: "led2", balanceAfterHours: 40 });
  updateEmployeeProfileMock.mockResolvedValue(undefined);
  archiveEmployeeMock.mockResolvedValue(undefined);
  unarchiveEmployeeMock.mockResolvedValue(undefined);
  resendFailedPaySummariesMock.mockResolvedValue({ attempted: 2, sent: 2, failed: 0, skipped: 0 });
});

// ── adjustPtoAction ─────────────────────────────────────────────────────────────

describe("adjustPtoAction", () => {
  it("admin: passes the SESSION shop (not a client value) + trimmed reason + actor", async () => {
    // A rogue shop_id in the form must be IGNORED — the DAL is called with the session shop.
    const r = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "-2", reason: "  correction  ", shop_id: "999" }));
    expect(r).toMatchObject({ ok: true, data: { balanceAfterHours: 14 } });
    expect(adjustPtoMock).toHaveBeenCalledWith(SESSION_SHOP, EMP, -2, "correction", ACTOR);
    // never the client-supplied 999
    expect(adjustPtoMock.mock.calls[0]![0]).toBe(SESSION_SHOP);
    // plan #58: an accepted adjustment fires the alert (session shop, employee,
    // signed hours, trimmed reason, the DAL's new balance) AFTER the ledger write.
    expect(sendPtoAdjustmentAlertMock).toHaveBeenCalledWith(SESSION_SHOP, EMP, -2, "correction", 14);
  });

  it("does NOT fire the adjustment alert when the adjustment itself failed", async () => {
    adjustPtoMock.mockRejectedValue(new QboClientError("nope", { kind: "validation" }));
    const r = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "4", reason: "x" }));
    expect(r).toMatchObject({ ok: false });
    expect(sendPtoAdjustmentAlertMock).not.toHaveBeenCalled();
  });

  it("REQUIRES a reason — a blank reason is rejected BEFORE the DAL", async () => {
    const r = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "4", reason: "   " }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(adjustPtoMock).not.toHaveBeenCalled();
  });

  it("rejects a missing reason field entirely (required)", async () => {
    const r = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "4" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(adjustPtoMock).not.toHaveBeenCalled();
  });

  it("rejects a zero / non-numeric hours amount before the DAL", async () => {
    const zero = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "0", reason: "x" }));
    expect(zero).toMatchObject({ ok: false, reason: "validation" });
    const nan = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "abc", reason: "x" }));
    expect(nan).toMatchObject({ ok: false, reason: "validation" });
    expect(adjustPtoMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-bound hours amount (|hours| > 500) before the DAL", async () => {
    const r = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "600", reason: "x" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(adjustPtoMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid employee id before the DAL", async () => {
    const r = await adjustPtoAction(null, fd({ employee_id: "not-a-uuid", hours: "4", reason: "x" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(adjustPtoMock).not.toHaveBeenCalled();
  });

  it("denies a non-admin BEFORE touching the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: SESSION_SHOP, role: "viewer" });
    const r = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "4", reason: "x" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(adjustPtoMock).not.toHaveBeenCalled();
  });

  it("envelopes a QboClientError from the DAL (e.g. the RPC RAISE)", async () => {
    adjustPtoMock.mockRejectedValue(new QboClientError("employee not found", { kind: "not_found" }));
    const r = await adjustPtoAction(null, fd({ employee_id: EMP, hours: "4", reason: "x" }));
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("re-throws Next redirect control-flow errors (the auth redirect must navigate)", async () => {
    requireQtekUserMock.mockRejectedValue(redirectErr());
    await expect(adjustPtoAction(null, fd({ employee_id: EMP, hours: "4", reason: "x" }))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(adjustPtoMock).not.toHaveBeenCalled();
  });
});

// ── seedInitialBalanceAction ─────────────────────────────────────────────────────

describe("seedInitialBalanceAction", () => {
  it("admin: session shop, reason OPTIONAL — absent reason ⇒ undefined to the DAL", async () => {
    const r = await seedInitialBalanceAction(null, fd({ employee_id: EMP, hours: "40" }));
    expect(r).toMatchObject({ ok: true, data: { balanceAfterHours: 40 } });
    expect(seedInitialBalanceMock).toHaveBeenCalledWith(SESSION_SHOP, EMP, 40, ACTOR, undefined);
  });

  it("passes a trimmed reason through when supplied", async () => {
    await seedInitialBalanceAction(null, fd({ employee_id: EMP, hours: "40", reason: "  opening balance  " }));
    expect(seedInitialBalanceMock).toHaveBeenCalledWith(SESSION_SHOP, EMP, 40, ACTOR, "opening balance");
  });

  it("a blank reason ⇒ undefined (treated as no reason)", async () => {
    await seedInitialBalanceAction(null, fd({ employee_id: EMP, hours: "40", reason: "   " }));
    expect(seedInitialBalanceMock).toHaveBeenCalledWith(SESSION_SHOP, EMP, 40, ACTOR, undefined);
  });

  it("rejects a zero seed before the DAL", async () => {
    const r = await seedInitialBalanceAction(null, fd({ employee_id: EMP, hours: "0" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(seedInitialBalanceMock).not.toHaveBeenCalled();
  });

  it("denies a non-admin before the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: SESSION_SHOP, role: "approver" });
    const r = await seedInitialBalanceAction(null, fd({ employee_id: EMP, hours: "40" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(seedInitialBalanceMock).not.toHaveBeenCalled();
  });
});

// ── updateEmployeeProfileAction ──────────────────────────────────────────────────

describe("updateEmployeeProfileAction — patch semantics + session shop", () => {
  it("threads the whitelisted patch through unchanged (present value + explicit null clear)", async () => {
    const patch = { personal_email: "matt@example.com", work_phone: null };
    const r = await updateEmployeeProfileAction(
      null,
      fd({ employee_id: EMP, patch: JSON.stringify(patch) }),
    );
    expect(r).toMatchObject({ ok: true, data: { updated: true } });
    // shop from session; patch keys ride through (null preserved, absent keys absent).
    expect(updateEmployeeProfileMock).toHaveBeenCalledWith(SESSION_SHOP, EMP, patch, ACTOR);
    const passedPatch = updateEmployeeProfileMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(passedPatch.work_phone).toBeNull(); // explicit null = CLEAR
    expect("start_date" in passedPatch).toBe(false); // absent = KEEP
  });

  it("passes pto_grandfathered as a boolean (NOT NULL column)", async () => {
    await updateEmployeeProfileAction(
      null,
      fd({ employee_id: EMP, patch: JSON.stringify({ pto_grandfathered: true }) }),
    );
    expect(updateEmployeeProfileMock.mock.calls[0]![2]).toEqual({ pto_grandfathered: true });
  });

  it("passes full_time as a boolean (round-12; NOT NULL column)", async () => {
    await updateEmployeeProfileAction(
      null,
      fd({ employee_id: EMP, patch: JSON.stringify({ full_time: false }) }),
    );
    expect(updateEmployeeProfileMock.mock.calls[0]![2]).toEqual({ full_time: false });
  });

  it("rejects an unknown patch key (strictObject) before the DAL", async () => {
    const r = await updateEmployeeProfileAction(
      null,
      fd({ employee_id: EMP, patch: JSON.stringify({ salary_cents: 123 }) }),
    );
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(updateEmployeeProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed email value before the DAL", async () => {
    const r = await updateEmployeeProfileAction(
      null,
      fd({ employee_id: EMP, patch: JSON.stringify({ personal_email: "not-an-email" }) }),
    );
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(updateEmployeeProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a non-ISO date value before the DAL", async () => {
    const r = await updateEmployeeProfileAction(
      null,
      fd({ employee_id: EMP, patch: JSON.stringify({ start_date: "07/01/2026" }) }),
    );
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(updateEmployeeProfileMock).not.toHaveBeenCalled();
  });

  it("rejects an empty patch (nothing to update) before the DAL", async () => {
    const r = await updateEmployeeProfileAction(null, fd({ employee_id: EMP, patch: "{}" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(updateEmployeeProfileMock).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON in the patch field", async () => {
    const r = await updateEmployeeProfileAction(null, fd({ employee_id: EMP, patch: "{bad json" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(updateEmployeeProfileMock).not.toHaveBeenCalled();
  });

  it("denies a non-admin before the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: SESSION_SHOP, role: "viewer" });
    const r = await updateEmployeeProfileAction(
      null,
      fd({ employee_id: EMP, patch: JSON.stringify({ personal_email: "a@b.com" }) }),
    );
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(updateEmployeeProfileMock).not.toHaveBeenCalled();
  });
});

// ── archive / unarchive ──────────────────────────────────────────────────────────

describe("archiveEmployeeAction", () => {
  it("ONE DAL call: session shop + termination date (the RPC sets archived true)", async () => {
    const r = await archiveEmployeeAction(null, fd({ employee_id: EMP, termination_date: "2026-07-01" }));
    expect(r).toMatchObject({ ok: true, data: { archived: true } });
    expect(archiveEmployeeMock).toHaveBeenCalledTimes(1);
    expect(archiveEmployeeMock).toHaveBeenCalledWith(SESSION_SHOP, EMP, "2026-07-01", ACTOR);
  });

  it("requires a termination date (ISO) before the DAL", async () => {
    const missing = await archiveEmployeeAction(null, fd({ employee_id: EMP }));
    expect(missing).toMatchObject({ ok: false, reason: "validation" });
    const bad = await archiveEmployeeAction(null, fd({ employee_id: EMP, termination_date: "07/01/2026" }));
    expect(bad).toMatchObject({ ok: false, reason: "validation" });
    expect(archiveEmployeeMock).not.toHaveBeenCalled();
  });

  it("denies a non-admin before the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: SESSION_SHOP, role: "viewer" });
    const r = await archiveEmployeeAction(null, fd({ employee_id: EMP, termination_date: "2026-07-01" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(archiveEmployeeMock).not.toHaveBeenCalled();
  });
});

describe("unarchiveEmployeeAction", () => {
  it("ONE DAL call: session shop + actor (the RPC clears termination server-side)", async () => {
    const r = await unarchiveEmployeeAction(null, fd({ employee_id: EMP }));
    expect(r).toMatchObject({ ok: true, data: { unarchived: true } });
    expect(unarchiveEmployeeMock).toHaveBeenCalledTimes(1);
    expect(unarchiveEmployeeMock).toHaveBeenCalledWith(SESSION_SHOP, EMP, ACTOR);
  });

  it("rejects an invalid employee id before the DAL", async () => {
    const r = await unarchiveEmployeeAction(null, fd({ employee_id: "nope" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(unarchiveEmployeeMock).not.toHaveBeenCalled();
  });

  it("denies a non-admin before the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: SESSION_SHOP, role: "approver" });
    const r = await unarchiveEmployeeAction(null, fd({ employee_id: EMP }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(unarchiveEmployeeMock).not.toHaveBeenCalled();
  });
});

// ── resendPaySummariesAction ─────────────────────────────────────────────────────

describe("resendPaySummariesAction — the failed→pending retry path", () => {
  it("admin: delegates to the DAL orchestrator with the SESSION shop + run id", async () => {
    const r = await resendPaySummariesAction(null, fd({ run_id: RUN }));
    expect(r).toMatchObject({ ok: true, data: { attempted: 2, sent: 2, failed: 0 } });
    expect(resendFailedPaySummariesMock).toHaveBeenCalledWith(SESSION_SHOP, RUN);
  });

  it("rejects an invalid run id before the DAL", async () => {
    const r = await resendPaySummariesAction(null, fd({ run_id: "nope" }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(resendFailedPaySummariesMock).not.toHaveBeenCalled();
  });

  it("envelopes the DAL's completed-only guard (a QboClientError)", async () => {
    resendFailedPaySummariesMock.mockRejectedValue(
      new QboClientError("This run is open — pay summaries can only be resent for a completed run.", {
        kind: "validation",
      }),
    );
    const r = await resendPaySummariesAction(null, fd({ run_id: RUN }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
  });

  it("denies a non-admin before the DAL", async () => {
    requireQtekUserMock.mockResolvedValue({ shopId: SESSION_SHOP, role: "viewer" });
    const r = await resendPaySummariesAction(null, fd({ run_id: RUN }));
    expect(r).toMatchObject({ ok: false, reason: "validation" });
    expect(resendFailedPaySummariesMock).not.toHaveBeenCalled();
  });
});

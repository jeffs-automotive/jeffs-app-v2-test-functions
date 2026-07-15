/**
 * ResendPaySummariesButton — the C27 resend affordance's wiring contract:
 *   - clicking dispatches the run id to resendPaySummariesAction;
 *   - a success tally renders inline (sent / attempted, + still-failed when any);
 *   - a clean run (attempted 0) reports the safe no-op;
 *   - an action failure renders its message inline.
 * The server action is mocked.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const actionMock = vi.fn();
vi.mock("@/actions/payroll-pto", () => ({
  resendPaySummariesAction: (...args: unknown[]) => actionMock(...args),
}));

import { ResendPaySummariesButton } from "../ResendPaySummariesButton";

const RUN_ID = "22222222-2222-4222-8222-222222222222";
const clickResend = () =>
  fireEvent.click(screen.getByRole("button", { name: /resend pay summaries/i }));

describe("ResendPaySummariesButton (C27 resend affordance)", () => {
  it("dispatches the run id and reports the send tally on success", async () => {
    actionMock.mockResolvedValueOnce({ ok: true, data: { attempted: 3, sent: 2, failed: 1 }, timestamp: 1 });
    render(<ResendPaySummariesButton runId={RUN_ID} />);
    clickResend();
    expect(await screen.findByText(/Resent 2 of 3 — 1 still failed\./)).toBeInTheDocument();
    const fd = actionMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("run_id")).toBe(RUN_ID);
  });

  it("reports a clean no-op when nothing failed", async () => {
    actionMock.mockResolvedValueOnce({ ok: true, data: { attempted: 0, sent: 0, failed: 0 }, timestamp: 2 });
    render(<ResendPaySummariesButton runId={RUN_ID} />);
    clickResend();
    expect(await screen.findByText(/No failed pay summaries to resend\./)).toBeInTheDocument();
  });

  it("surfaces an action failure inline", async () => {
    actionMock.mockResolvedValueOnce({ ok: false, message: "This run is open — pay summaries can only be resent for a completed run.", timestamp: 3 });
    render(<ResendPaySummariesButton runId={RUN_ID} />);
    clickResend();
    expect(await screen.findByText(/only be resent for a completed run/i)).toBeInTheDocument();
  });
});

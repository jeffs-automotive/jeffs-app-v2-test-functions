/**
 * DryRunButton — the round-7 #42 modal contract:
 *   - a successful dry run opens the modal with the GROUPED diff (per-tech
 *     billed hours / month numbers / pay totals), old → new + colored delta,
 *     the honest already-live subtext, and refreshes the page underneath;
 *   - an empty diff renders "Everything is up to date — no differences.";
 *   - Accept closes the modal + fires onAccepted (the #41 client-side switch
 *     to Summary — asserted end-to-end in RunViewTabs.test.tsx);
 *   - Cancel closes without onAccepted;
 *   - the button is disabled while pending (with the "Checking N…" label) and
 *     on locked runs; an action failure renders inline, no modal.
 * The server action + next/navigation are mocked.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  DryRunPtoProjection,
  PayrollDryRunDiff,
  PayrollDryRunResult,
} from "@/lib/payroll/dry-run-diff";

const actionMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("@/actions/payroll", () => ({
  dryRunPayrollAction: (...args: unknown[]) => actionMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { DryRunButton } from "../DryRunButton";

const TECH_ID = "11111111-1111-4111-8111-111111111111";

function diffFixture(over: Partial<PayrollDryRunDiff> = {}): PayrollDryRunDiff {
  return {
    techHours: [
      {
        employeeId: TECH_ID,
        displayName: "Nick Trilli",
        fields: [
          { key: "billed_hours_w2", label: "Billed hours W2", kind: "hours", before: 55.05, after: 57.2 },
        ],
      },
    ],
    month: [
      { key: "month_sales_cents", label: "Month sales", kind: "cents", before: 27_306_113, after: 27_400_000 },
    ],
    payTotals: [
      { key: TECH_ID, label: "Nick Trilli", kind: "cents", before: 250_000, after: 262_400 },
    ],
    beforeAsOf: "2026-07-11T04:00:00Z",
    afterAsOf: "2026-07-11T16:00:00Z",
    changed: true,
    ...over,
  };
}

function okResult(
  diff: PayrollDryRunDiff,
  pto?: DryRunPtoProjection[],
): { ok: true; data: PayrollDryRunResult; timestamp: number } {
  return { ok: true, data: { diff, rosChecked: 42, pto }, timestamp: Date.now() };
}

function renderButton(over: Partial<Parameters<typeof DryRunButton>[0]> = {}) {
  return render(
    <DryRunButton
      runId="7f0a1b2c-3d4e-4f5a-8b9c-0d1e2f3a4b5c"
      roCount={42}
      onAccepted={onAccepted}
      {...over}
    />,
  );
}

const onAccepted = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DryRunButton (#42)", () => {
  it("renders the grouped diff modal (old → new) and refreshes the page underneath", async () => {
    actionMock.mockResolvedValue(okResult(diffFixture()));
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run — check against tekmetric/i }));

    expect(await screen.findByText("Dry run — what changed")).toBeInTheDocument();
    // the three groups
    expect(screen.getByText("Per-technician billed hours")).toBeInTheDocument();
    expect(screen.getByText("Month numbers")).toBeInTheDocument();
    expect(screen.getByText("Pay totals")).toBeInTheDocument();
    // old → new content
    expect(screen.getAllByText("Nick Trilli").length).toBeGreaterThanOrEqual(2); // hours group + pay totals
    expect(screen.getByText("Billed hours W2")).toBeInTheDocument();
    expect(screen.getByText("55.05")).toBeInTheDocument(); // old
    expect(screen.getByText("57.2")).toBeInTheDocument(); // new
    expect(screen.getByText("+2.15")).toBeInTheDocument(); // colored delta
    expect(screen.getByText("Month sales")).toBeInTheDocument();
    expect(screen.getByText("$2,624.00")).toBeInTheDocument(); // new pay total
    // honest subtext + provenance line
    expect(screen.getByText(/these numbers are already live/i)).toBeInTheDocument();
    expect(screen.getByText(/checked 42 repair orders/i)).toBeInTheDocument();
    // the committed numbers re-render under the modal
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // the action got the run id
    const fd = actionMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("run_id")).toBe("7f0a1b2c-3d4e-4f5a-8b9c-0d1e2f3a4b5c");
  });

  it("empty diff → the up-to-date empty state, no groups", async () => {
    actionMock.mockResolvedValue(
      okResult(diffFixture({ techHours: [], month: [], payTotals: [], changed: false })),
    );
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));

    expect(
      await screen.findByText("Everything is up to date — no differences."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Per-technician billed hours")).not.toBeInTheDocument();
    expect(screen.queryByText("Month numbers")).not.toBeInTheDocument();
    expect(screen.queryByText("Pay totals")).not.toBeInTheDocument();
  });

  it("renders the PTO balances section (projected balance + deficit line) alongside a CHANGED diff", async () => {
    actionMock.mockResolvedValue(
      okResult(diffFixture(), [
        {
          employeeId: "aaaa1111-1111-4111-8111-111111111111",
          displayName: "Matt Clark",
          currentBalanceHours: 2,
          accrualHours: 1.5,
          usageHours: 7,
          projectedBalanceHours: -3.5,
        },
        {
          employeeId: "bbbb2222-2222-4222-8222-222222222222",
          displayName: "Dana Reed",
          currentBalanceHours: 10,
          accrualHours: 1.5,
          usageHours: 0,
          projectedBalanceHours: 11.5,
        },
      ]),
    );
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));

    expect(await screen.findByText("PTO balances")).toBeInTheDocument();
    // negative projection surfaces the deficit chip (aria-label) + the compact line
    expect(
      screen.getByLabelText("PTO balance -3.5 hours, negative — 3.5 hour deficit"),
    ).toBeInTheDocument();
    expect(screen.getByText(/will go negative by 3.5 h/i)).toBeInTheDocument();
    // a positive projection reads as plain hours, no deficit line
    expect(screen.getByText("11.5 hrs")).toBeInTheDocument();
    // the diff groups still render (PTO co-exists with the changed diff)
    expect(screen.getByText("Per-technician billed hours")).toBeInTheDocument();
  });

  it("renders the PTO balances section even when there are NO Tekmetric differences", async () => {
    actionMock.mockResolvedValue(
      okResult(diffFixture({ techHours: [], month: [], payTotals: [], changed: false }), [
        {
          employeeId: "aaaa1111-1111-4111-8111-111111111111",
          displayName: "Matt Clark",
          currentBalanceHours: 2,
          accrualHours: 1.5,
          usageHours: 7,
          projectedBalanceHours: -3.5,
        },
      ]),
    );
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));

    // the empty state AND the PTO deficit co-render
    expect(
      await screen.findByText("Everything is up to date — no differences."),
    ).toBeInTheDocument();
    const pto = screen.getByText("PTO balances").closest("section") as HTMLElement;
    expect(pto).toHaveTextContent(/will go negative by 3.5 h/i);
    expect(
      within(pto).getByLabelText("PTO balance -3.5 hours, negative — 3.5 hour deficit"),
    ).toBeInTheDocument();
  });

  it("omits the PTO balances section when the result carries no pto sibling", async () => {
    actionMock.mockResolvedValue(okResult(diffFixture())); // pto undefined
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));

    expect(await screen.findByText("Dry run — what changed")).toBeInTheDocument();
    expect(screen.queryByText("PTO balances")).not.toBeInTheDocument();
  });

  it("omits the PTO balances section when the pto sibling is an empty array", async () => {
    actionMock.mockResolvedValue(okResult(diffFixture(), []));
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));

    expect(await screen.findByText("Dry run — what changed")).toBeInTheDocument();
    expect(screen.queryByText("PTO balances")).not.toBeInTheDocument();
  });

  it("Accept closes the modal and fires onAccepted (→ the Summary tab)", async () => {
    actionMock.mockResolvedValue(okResult(diffFixture()));
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));
    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));

    expect(onAccepted).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText("Dry run — what changed")).not.toBeInTheDocument(),
    );
  });

  it("Cancel closes WITHOUT onAccepted — the refreshed numbers stand either way", async () => {
    actionMock.mockResolvedValue(okResult(diffFixture()));
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onAccepted).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText("Dry run — what changed")).not.toBeInTheDocument(),
    );
  });

  it("pending: the button disables and reads 'Checking 42 repair orders…'", async () => {
    actionMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderButton();

    const button = screen.getByRole("button", { name: /dry run/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText("Checking 42 repair orders…")).toBeInTheDocument();
  });

  it("locked runs render the button disabled (defensive — the page only mounts it open)", () => {
    renderButton({ locked: true });
    expect(screen.getByRole("button", { name: /dry run/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("an action failure renders inline and opens no modal", async () => {
    actionMock.mockResolvedValue({
      ok: false,
      reason: "validation",
      message: "This run is completed — only open runs can be dry-run checked.",
      timestamp: Date.now(),
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /dry run/i }));

    expect(
      await screen.findByText(/only open runs can be dry-run checked/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dry run — what changed")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

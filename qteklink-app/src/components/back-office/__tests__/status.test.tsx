/**
 * Locks the accessible LABEL text of the shared back-office status vocabulary. The icons
 * are aria-hidden, so the visible word is the accessible name — these assertions make sure
 * a future restyle can't silently drop the label. The same component is mirrored in
 * admin-app (byte-identical rendered output), so testing it here covers both apps.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  BackOfficeStatusBadge,
  StaleBadge,
  ChangeTypeBadge,
  IssueKindBadge,
} from "../status";

describe("BackOfficeStatusBadge", () => {
  it.each([
    ["open", "Open"],
    ["sent_to_sa", "With advisor"],
    ["awaiting_verify", "Awaiting verify"],
    ["verified", "Verified"],
  ] as const)("renders the %s label", (status, label) => {
    render(<BackOfficeStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("StaleBadge", () => {
  it("renders the day count", () => {
    render(<StaleBadge days={3} />);
    expect(screen.getByText(/Stale · 3d/)).toBeInTheDocument();
  });
});

describe("ChangeTypeBadge", () => {
  it.each([
    ["unposted", "Unposted"],
    ["reposted", "Reposted"],
    ["date_changed", "Date changed"],
    ["total_changed", "Total changed"],
    ["date_and_total_changed", "Date & total changed"],
  ])("renders the %s label", (changeType, label) => {
    render(<ChangeTypeBadge changeType={changeType} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders nothing when there is no change type", () => {
    const { container } = render(<ChangeTypeBadge changeType={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("IssueKindBadge", () => {
  it.each([
    ["invoice_issue", "Invoice"],
    ["open_ro", "Open RO"],
    ["reopened_ro", "Reopened"],
    ["misc", "Misc"],
  ])("renders the %s label", (kind, label) => {
    render(<IssueKindBadge kind={kind} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

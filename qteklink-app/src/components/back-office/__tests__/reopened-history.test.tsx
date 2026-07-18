/**
 * Locks the reopened-RO history timeline rendering. The same component is mirrored in
 * admin-app (identical rendered output), so testing it here covers both apps.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReopenedHistory, type HistoryItem } from "../ReopenedHistory";

const HISTORY: HistoryItem[] = [
  { at: "2026-07-14T20:59:36Z", at_local: "Jul 14, 2026, 4:59 PM", kind: "ro_sent_to_ar", actor: "james@jeffsautomotive.com", posted_date: "2026-07-14", total_cents: 145010 },
  { at: "2026-07-16T18:51:32Z", at_local: "Jul 16, 2026, 2:51 PM", kind: "ro_unposted", actor: "james@jeffsautomotive.com" },
  { at: "2026-07-16T18:53:35Z", at_local: "Jul 16, 2026, 2:53 PM", kind: "payment_made", actor: "Chaim Mishory", payer: "Chaim Mishory" },
  { at: "2026-07-16T18:57:16Z", at_local: "Jul 16, 2026, 2:57 PM", kind: "ro_posted", actor: "james@jeffsautomotive.com", posted_date: "2026-07-14", total_cents: 140771 },
];

describe("ReopenedHistory", () => {
  it("renders every event with its local timestamp + label", () => {
    render(<ReopenedHistory history={HISTORY} />);
    expect(screen.getByText("Jul 14, 2026, 4:59 PM")).toBeInTheDocument();
    expect(screen.getByText("Sent to A/R")).toBeInTheDocument();
    expect(screen.getByText("Unposted (reopened)")).toBeInTheDocument();
    expect(screen.getByText("Payment received")).toBeInTheDocument();
    expect(screen.getByText("Posted")).toBeInTheDocument();
  });

  it("shows posted-date + total for postings and the payer for payments", () => {
    render(<ReopenedHistory history={HISTORY} />);
    expect(screen.getByText(/date 2026-07-14, \$1,450\.10/)).toBeInTheDocument();
    expect(screen.getByText(/date 2026-07-14, \$1,407\.71/)).toBeInTheDocument();
    expect(screen.getByText(/Chaim Mishory/)).toBeInTheDocument();
  });

  it("renders nothing for an empty history", () => {
    const { container } = render(<ReopenedHistory history={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

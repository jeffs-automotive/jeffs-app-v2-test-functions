/**
 * QtlTabs — module-scoped navigation (extraction doc #30). Pins the contract:
 * /payroll/** carries the Payroll set (Modules + Dashboard/Employees/Settings),
 * every other authed route carries the QBO Link set (Modules + 5 tabs), both
 * lead with the Modules home link to the directory at `/`, the module identity
 * label matches the set, active-tab pinning keeps /payroll/runs/** under the
 * Payroll Dashboard, and the bar hides on the directory + signed-out surfaces.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const usePathnameMock = vi.fn<() => string>();
vi.mock("next/navigation", () => ({ usePathname: () => usePathnameMock() }));
// next-themes needs a provider; the toggle is irrelevant to the nav contract.
vi.mock("../ThemeToggle", () => ({ default: () => null }));

import QtlTabs from "../QtlTabs";

function renderAt(pathname: string) {
  usePathnameMock.mockReturnValue(pathname);
  return render(<QtlTabs />);
}

describe("QtlTabs module scoping", () => {
  it("payroll path → Modules + Dashboard/Employees/Settings with the Payroll identity label", () => {
    renderAt("/payroll");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(screen.getByRole("link", { name: /modules/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/payroll");
    expect(screen.getByRole("link", { name: "Employees" })).toHaveAttribute(
      "href",
      "/payroll/employees",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/payroll/settings",
    );
    expect(screen.getByText("Payroll")).toBeInTheDocument();
    expect(screen.queryByText("QBO Link")).not.toBeInTheDocument();
  });

  it("qbo path → Modules + the 5 QBO tabs with the QBO Link identity label", () => {
    renderAt("/approvals/2026-07-03");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(6);
    expect(screen.getByRole("link", { name: /modules/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Daily approvals" })).toHaveAttribute(
      "href",
      "/approvals",
    );
    expect(screen.getByRole("link", { name: "Posting queue" })).toHaveAttribute(
      "href",
      "/postings",
    );
    expect(screen.getByRole("link", { name: "Mappings" })).toHaveAttribute("href", "/mappings");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByText("QBO Link")).toBeInTheDocument();
    // The deep-linked approvals day still highlights its parent tab.
    expect(screen.getByRole("link", { name: "Daily approvals" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("hides on the directory (/) and the signed-out surfaces", () => {
    for (const pathname of ["/", "/login", "/auth/callback"]) {
      const { container, unmount } = renderAt(pathname);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe("QtlTabs active-tab pinning (payroll)", () => {
  it("/payroll/runs/2026-06-28 pins Dashboard (runs open from it), not Employees/Settings", () => {
    renderAt("/payroll/runs/2026-06-28");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Employees" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("/payroll/employees pins Employees only — the /payroll Dashboard tab is exact-match", () => {
    renderAt("/payroll/employees");
    expect(screen.getByRole("link", { name: "Employees" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("/payroll/settings pins Settings only", () => {
    renderAt("/payroll/settings");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });
});

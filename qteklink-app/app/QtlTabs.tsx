"use client";

/**
 * The app-wide tab bar — rendered by the root layout, MODULE-SCOPED by pathname
 * (extraction doc #30): /payroll/** carries the Payroll set (Dashboard /
 * Employees / Settings) and every other authed route (/dashboard, /approvals,
 * /postings, /mappings, /settings, /qbo/*) carries the QBO Link set. Both sets
 * lead with a "Modules" home affordance back to the directory at `/`, followed
 * by the module identity label.
 *
 * The active tab is derived from the pathname, so sub-pages highlight their
 * parent tab; /payroll/runs/** pins the Payroll Dashboard (runs are reached
 * from it). Hidden on the signed-out surfaces (/login, /auth) and on `/`
 * itself — the module directory is its own navigation surface.
 *
 * Navigation-presentation only: no route moved (office-manager emails still
 * deep-link /approvals/[date]).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

interface Tab {
  href: string;
  label: string;
  /** Match only the exact href (plus activePrefixes) — not every sub-path. */
  exact?: boolean;
  /** Extra pathname prefixes (beyond href) that also pin this tab active. */
  activePrefixes?: readonly string[];
}

const QBO_TABS: readonly Tab[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/approvals", label: "Daily approvals" },
  { href: "/postings", label: "Posting queue" },
  { href: "/mappings", label: "Mappings" },
  { href: "/settings", label: "Settings" },
];

const PAYROLL_TABS: readonly Tab[] = [
  // `/payroll` is a prefix of every payroll route, so Dashboard matches exact
  // only — plus /payroll/runs/**, which belongs to it (runs open from there).
  { href: "/payroll", label: "Dashboard", exact: true, activePrefixes: ["/payroll/runs"] },
  { href: "/payroll/employees", label: "Employees" },
  { href: "/payroll/settings", label: "Settings" },
];

function isActive(tab: Tab, pathname: string): boolean {
  if (pathname === tab.href) return true;
  if (!tab.exact && pathname.startsWith(`${tab.href}/`)) return true;
  return (tab.activePrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function QtlTabs() {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/auth")) return null;

  const isPayroll = pathname === "/payroll" || pathname.startsWith("/payroll/");
  const moduleLabel = isPayroll ? "Payroll" : "QBO Link";
  const tabs = isPayroll ? PAYROLL_TABS : QBO_TABS;

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
        <nav aria-label={`${moduleLabel} navigation`} className="min-w-0 flex-1 overflow-x-auto">
          <div className="mx-auto flex w-fit min-w-max items-center rounded-lg border border-border bg-card p-1 shadow-xs">
            <Link
              href="/"
              className="flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-4"
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
              Modules
            </Link>
            <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
            <span className="whitespace-nowrap px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {moduleLabel}
            </span>
            {tabs.map((t) => {
              const active = isActive(t, pathname);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-9 items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:px-4 ${
                    active
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <ThemeToggle />
      </div>
    </div>
  );
}

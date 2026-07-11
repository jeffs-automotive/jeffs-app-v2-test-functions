"use client";

/**
 * The app-wide tab bar — rendered by the root layout so EVERY page carries the same
 * centered tabs at the top. The active tab is derived from the pathname, so
 * sub-pages (the fix-it list, a day's detail) highlight their parent tab. Hidden on
 * the signed-out surfaces (/login, /auth) and the root redirect.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const TABS = [
  { href: "/dashboard", label: "Home" },
  { href: "/approvals", label: "Daily approvals" },
  { href: "/postings", label: "Posting queue" },
  { href: "/mappings", label: "Mappings" },
  { href: "/payroll", label: "Payroll" },
  { href: "/settings", label: "Settings" },
] as const;

export default function QtlTabs() {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/auth")) return null;

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
        <nav aria-label="Main" className="min-w-0 flex-1 overflow-x-auto">
          <div className="mx-auto flex w-fit min-w-max rounded-lg border border-border bg-card p-1 shadow-xs">
            {TABS.map((t) => {
              const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
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

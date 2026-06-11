"use client";

/**
 * The app-wide tab bar — rendered by the root layout so EVERY page carries the same
 * centered tabs at the top. The active tab is derived from the pathname, so
 * sub-pages (the fix-it list, a day's detail) highlight their parent tab. Hidden on
 * the signed-out surfaces (/login, /auth) and the root redirect.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Home" },
  { href: "/approvals", label: "Daily approvals" },
  { href: "/postings", label: "Posting queue" },
  { href: "/mappings", label: "Mappings" },
  { href: "/settings", label: "Settings" },
] as const;

export default function QtlTabs() {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/auth")) return null;

  return (
    <div className="sticky top-0 z-40 border-b border-stone-200 bg-stone-50/95 backdrop-blur">
      <nav aria-label="Main" className="mx-auto max-w-5xl overflow-x-auto px-4 py-2">
        <div className="mx-auto flex w-fit min-w-max rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
          {TABS.map((t) => {
            const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition sm:px-4 ${
                  active
                    ? "bg-[#96003C] text-white"
                    : "text-stone-600 hover:bg-[#96003C]/5 hover:text-[#96003C]"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

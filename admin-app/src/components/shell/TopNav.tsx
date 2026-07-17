"use client";

/**
 * TopNav — sticky header for all authenticated admin-app pages.
 *
 * Brand on the left, primary nav in the middle, user menu on the right.
 * Active route gets a subtle accent treatment. Mobile: collapses nav
 * links to icons-only (text hidden below sm).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { LayoutDashboard, KeyRound, Settings, ClipboardList, LogOut, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/actions/sign-out";

/**
 * ThemeToggle — flips between light + dark (presentational only). Mounts a
 * placeholder until hydrated so the icon doesn't flash the wrong glyph
 * (next-themes resolves the system theme on the client).
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="text-muted-foreground hover:text-foreground"
    >
      {mounted && isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/keytags", label: "Key tags", icon: KeyRound },
  { href: "/back-office", label: "Back office", icon: ClipboardList },
  { href: "/schedulerconfig", label: "Scheduler config", icon: Settings },
] as const;

export interface TopNavProps {
  email: string;
}

export function TopNav({ email }: TopNavProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs ring-1 ring-brand-gold/40">
            <span className="text-xs font-bold">J</span>
          </div>
          <span className="hidden text-sm font-semibold tracking-tight text-foreground sm:inline">
            Jeff&apos;s Automotive
          </span>
        </Link>

        <Separator orientation="vertical" className="mx-2 hidden h-6 sm:block" />

        <nav className="flex flex-1 items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden text-right md:block">
            <p className="text-xs font-medium text-foreground">{email}</p>
            <p className="text-[10px] uppercase tracking-wider text-bronze-text dark:text-bronze-text-dark">
              Admin
            </p>
          </div>
          <ThemeToggle />
          <form action={signOutAction}>
            <Button
              type="submit"
              variant="ghost"
              size="default"
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2 hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}

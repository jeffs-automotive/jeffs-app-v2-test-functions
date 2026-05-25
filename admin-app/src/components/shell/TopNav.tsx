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
import { LayoutDashboard, KeyRound, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/actions/sign-out";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/keytags", label: "Key tags", icon: KeyRound },
  { href: "/schedulerconfig", label: "Scheduler config", icon: Settings },
] as const;

export interface TopNavProps {
  email: string;
}

export function TopNav({ email }: TopNavProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
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
                  "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
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
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Admin
            </p>
          </div>
          <form action={signOutAction}>
            <Button
              type="submit"
              variant="ghost"
              size="sm"
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

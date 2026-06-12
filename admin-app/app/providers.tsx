"use client";

/**
 * App-wide client providers. Currently just next-themes' ThemeProvider so
 * the admin tool can follow the OS light/dark preference (and the in-nav
 * toggle can override it).
 *
 * `attribute="class"` writes `.dark` onto <html>, which the globals.css
 * `@custom-variant dark` + `.dark` token block already target.
 * `defaultTheme="system"` + `enableSystem` means: honor the OS until the
 * user flips the toggle. This is purely presentational — no auth, no data,
 * no Server Action surface lives here (AppShell's no-auth-in-layout contract
 * is unaffected; auth still runs in each page via requireAdmin).
 *
 * sonner's <Toaster> calls useTheme() from next-themes; with this provider
 * mounted it now resolves the real theme instead of the "system" fallback.
 */
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}

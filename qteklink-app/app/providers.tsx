"use client";

/**
 * Client providers mounted by the root layout. Currently just next-themes for
 * class-based dark mode (attribute="class" → toggles `.dark` on <html>, which
 * the .dark token block in globals.css re-themes). defaultTheme="system" +
 * enableSystem follows the OS until the user picks via the ThemeToggle.
 *
 * Purely presentational — no app behavior, data, or auth runs here.
 */
import { ThemeProvider } from "next-themes";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}

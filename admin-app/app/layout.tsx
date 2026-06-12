import type { Metadata } from "next";
import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Jeff's Automotive — Admin",
  description:
    "Internal dashboard for scheduler config + keytag operations. Restricted to @jeffsautomotive.com.",
  // Block search indexing — internal tool.
  robots: { index: false, follow: false },
};

/**
 * Root layout. No auth here — auth is enforced inside protected pages
 * via `requireAdmin()`. Public pages (/login, /auth/callback) just
 * render their own content within this shell.
 *
 * The nav bar is rendered by a child segment layout (app/(dashboard)/layout.tsx
 * — added in Phase D) so /login can opt out of it.
 *
 * <Providers> mounts next-themes only (presentational light/dark) — it is
 * NOT an auth/data boundary; requireAdmin still runs per page.
 * `suppressHydrationWarning` on <html> is required by next-themes because it
 * sets the `class`/`style` on <html> before React hydrates.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn("font-sans", geist.variable, geistMono.variable)}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

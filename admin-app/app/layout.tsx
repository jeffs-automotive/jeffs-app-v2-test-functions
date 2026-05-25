import type { Metadata } from "next";
import "./globals.css";

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
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-stone-50 text-stone-900">{children}</body>
    </html>
  );
}

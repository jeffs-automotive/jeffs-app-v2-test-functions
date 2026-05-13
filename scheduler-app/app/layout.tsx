import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

// Heritage Editorial typography:
//   - Fraunces (variable serif) for h1/h2/h3 — warm, modern, sturdy.
//   - Inter (variable sans) for body, buttons, form input — neutral + readable.
// Both load with display: 'swap' so the page paints with system fallback
// while the web fonts arrive, then upgrades seamlessly.

// Fraunces is a variable font; using `variable` weight + axes for the editorial
// SOFT softness + WONK character. Specifying explicit weight strings conflicts
// with the axes config per next/font v15 — pick one or the other.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK"],
});

// Inter is variable too; let Next.js pull the full variable weight range.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Schedule an appointment — Jeff's Automotive",
  description:
    "Book your next service appointment online with Jeff's Automotive. " +
    "Family-owned since 1976, AAA-approved, 3yr/36k warranty, free loaners.",
  // No Open Graph image yet — add when logo file is provided.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

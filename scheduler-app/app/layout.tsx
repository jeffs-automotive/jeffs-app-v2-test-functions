import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

// Marketing-standard typography (swapped 2026-05-20 from Fraunces+Inter pair):
//   - Poppins (geometric sans) for everything — headings use heavier weights,
//     body uses 400/500. Single font in different weights is the canonical
//     marketing-landing-page pattern (cf. Poppins is the #1 most-used Google
//     Font for marketing landing pages globally).
//   - display: 'swap' so the page paints with system fallback while the web
//     font arrives, then upgrades seamlessly.

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  // Poppins is NOT a variable font in next/font/google — must enumerate
  // weights explicitly. 400/500 for body + 600/700 for headings.
  weight: ["400", "500", "600", "700"],
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
    <html lang="en" className={poppins.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}

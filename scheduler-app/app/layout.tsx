import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-dvh">
        {children}
      </body>
    </html>
  );
}

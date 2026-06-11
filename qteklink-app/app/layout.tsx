import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import QtlTabs from "./QtlTabs";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "QTekLink",
  description:
    "Tekmetric → QuickBooks Online financial sync for Jeff's Automotive. Restricted access.",
  // Block search indexing — internal tool.
  robots: { index: false, follow: false },
};

/**
 * Root layout. No auth here — auth is enforced inside protected pages via
 * requireQtekUser(). Public pages (/login, /auth/callback) render their own
 * content within this shell; QtlTabs hides itself on those paths.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className="bg-stone-50 text-stone-900">
        <QtlTabs />
        {children}
      </body>
    </html>
  );
}

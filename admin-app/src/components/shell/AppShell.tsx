/**
 * AppShell — wraps all authenticated pages. Calls requireAdmin, renders
 * TopNav + page content + Sonner toast region.
 *
 * Usage at the top of any /dashboard, /schedulerconfig, /keytags page:
 *   const { email } = await requireAdmin();
 *   return (
 *     <AppShell email={email}>
 *       ...page content...
 *     </AppShell>
 *   );
 *
 * Why not auto-call requireAdmin inside AppShell: per Next.js Server
 * Action security warning, each page MUST verify auth at the page level
 * (Server Actions can be invoked directly via POST, bypassing layout
 * gates). Having the page explicitly call requireAdmin keeps the auth
 * pattern visible at every protected entry point.
 */
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TopNav } from "./TopNav";

export interface AppShellProps {
  email: string;
  children: ReactNode;
}

export function AppShell({ email, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav email={email} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {children}
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}

/**
 * PageHeader — consistent section title + description + actions slot.
 * Use at the top of each page's content area for visual cohesion.
 */
export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional section-identity eyebrow above the title (the one place
   *  gold-family color appears as text — uses AA-safe --bronze-text). */
  eyebrow?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-px w-8 bg-brand-gold" aria-hidden="true" />
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-bronze-text dark:text-bronze-text-dark">
              {eyebrow}
            </span>
          </div>
        )}
        <h1 className="text-[clamp(1.5rem,1.2rem+1.2vw,1.875rem)] font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

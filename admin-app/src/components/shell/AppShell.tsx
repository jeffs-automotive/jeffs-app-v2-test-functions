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
    <div className="min-h-screen bg-muted/30">
      <TopNav email={email} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
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

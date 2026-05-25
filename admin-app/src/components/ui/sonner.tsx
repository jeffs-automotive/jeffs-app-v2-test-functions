"use client"

// Shadcn sonner template ships without a "use client" directive even
// though it calls useTheme() from next-themes — a Client-Component-only
// hook. Without "use client", AppShell (Server Component) rendering
// <Toaster /> fires "Attempted to call useTheme from the server..."
// at runtime. Found via Vercel runtime logs 2026-05-25.
//
// useTheme is required by shadcn's wrapper to match Sonner's theme to
// the app's light/dark mode. admin-app doesn't ship a theme switcher
// today (next-themes not configured), so useTheme returns its default
// "system". Leaving the dependency in place + "use client" wrapped is
// the minimal-surgery fix; removing next-themes entirely is a possible
// future cleanup.
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

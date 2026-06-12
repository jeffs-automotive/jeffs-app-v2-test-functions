"use client";

/**
 * Light/dark theme toggle — sits beside the app-wide QtlTabs. Cycles
 * light ↔ dark via next-themes. Mounted-gated so we don't render a
 * resolved icon before hydration (avoids a flash / mismatch). Icon-only,
 * so it carries an explicit aria-label.
 */
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {/* Before mount, render a stable placeholder icon (Sun) to avoid a
          hydration mismatch; swap to the resolved icon once mounted. */}
      {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </Button>
  );
}

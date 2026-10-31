"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tip";

// 深浅色切换
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, toggle } = useTheme();

  return (
    <Tip label={mode === "dark" ? "切换浅色" : "切换深色"}>
      <button
        type="button"
        onClick={toggle}
        className={cn("icon-btn", className)}
        aria-label="切换主题"
      >
        {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </Tip>
  );
}

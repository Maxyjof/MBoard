"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

// 全局提示，跟随深浅色主题
export function AppToaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Toaster
      theme={theme}
      position="top-center"
      offset={18}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-xl !border !border-line !bg-elevated !text-ink !shadow-float !text-[13px] !font-normal",
          description: "!text-muted",
          actionButton: "!bg-brand !text-white",
        },
      }}
    />
  );
}

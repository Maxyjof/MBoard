"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";

function apply(mode: ThemeMode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem("mb-theme", mode);
  } catch {
    // 忽略隐私模式下的写入失败
  }
}

// 深浅色主题：首帧由 layout 内联脚本应用，这里负责切换与状态同步
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    setMode(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggle = useCallback(() => {
    const next: ThemeMode = document.documentElement.classList.contains("dark") ? "light" : "dark";
    apply(next);
    setMode(next);
  }, []);

  const set = useCallback((next: ThemeMode) => {
    apply(next);
    setMode(next);
  }, []);

  return { mode, toggle, set };
}

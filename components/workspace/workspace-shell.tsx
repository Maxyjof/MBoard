"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Sidebar } from "@/components/workspace/sidebar";
import { cn } from "@/lib/utils";
import type { AppUser, BoardSummary } from "@/lib/types";

type WorkspaceShellProps = {
  user: AppUser;
  boards: BoardSummary[];
  myTaskCount: number;
  children: React.ReactNode;
};

const COLLAPSE_KEY = "mb-sidebar-collapsed";

// 工作台外壳：桌面侧边栏 + 移动端抽屉
export function WorkspaceShell({ user, boards, myTaskCount, children }: WorkspaceShellProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // 忽略
    }
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // 忽略
      }
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }, [router]);

  // 移动端抽屉打开时禁止背景滚动
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <div className="hidden md:block">
        <Sidebar
          user={user}
          boards={boards}
          myTaskCount={myTaskCount}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onLogout={logout}
        />
      </div>

      {/* 移动端抽屉 */}
      <div
        className={cn(
          "fixed inset-0 z-[100] md:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        <div
          className={cn(
            "absolute inset-0 bg-slate-950/45 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <Sidebar
            user={user}
            boards={boards}
            myTaskCount={myTaskCount}
            collapsed={false}
            onToggleCollapse={toggleCollapse}
            onLogout={logout}
            mobile
            onCloseMobile={() => setMobileOpen(false)}
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 仅在移动端出现的顶栏 */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="icon-btn"
            aria-label="打开菜单"
          >
            <Menu className="h-4.5 w-4.5" />
          </button>
          <BrandMark size={20} />
          <span className="text-[13px] font-semibold">MBoard</span>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

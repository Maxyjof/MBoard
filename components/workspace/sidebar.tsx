"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  LayoutGrid,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown, MenuDivider, MenuItem } from "@/components/ui/dropdown";
import { Tip } from "@/components/ui/tip";
import { useTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";
import type { AppUser, BoardSummary } from "@/lib/types";
import { CreateBoardDialog } from "@/components/workspace/create-board-dialog";

type SidebarProps = {
  user: AppUser;
  boards: BoardSummary[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate?: () => void;
  onLogout: () => void;
  mobile?: boolean;
  onCloseMobile?: () => void;
};

// 侧边栏内容：桌面端与移动端抽屉共用
export function Sidebar({
  user,
  boards,
  collapsed,
  onToggleCollapse,
  onNavigate,
  onLogout,
  mobile = false,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname();
  const { mode, toggle } = useTheme();
  const [createOpen, setCreateOpen] = useState(false);

  const isBoards = pathname.startsWith("/boards");
  const isCanvases = pathname.startsWith("/canvases");

  return (
    <>
      <aside
        className={cn(
          "flex h-full flex-col border-r border-line bg-surface transition-[width] duration-200",
          mobile ? "w-[280px]" : collapsed ? "w-[68px]" : "w-[264px]"
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2 border-b border-line px-3",
            collapsed && !mobile ? "justify-center px-2" : "justify-between"
          )}
        >
          <Link
            href="/boards"
            onClick={onNavigate}
            className={cn(
              "flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 transition hover:opacity-90",
              collapsed && !mobile && "justify-center"
            )}
          >
            <BrandMark size={28} />
            {!collapsed || mobile ? (
              <span className="truncate text-[14px] font-semibold tracking-tight">MBoard</span>
            ) : null}
          </Link>

          {mobile ? (
            <button type="button" onClick={onCloseMobile} className="icon-btn" aria-label="关闭菜单">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="icon-btn"
              aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        <nav className={cn("flex flex-col gap-1 px-2 py-3", collapsed && !mobile && "items-center px-2")}>
          <NavItem
            href="/boards"
            icon={<LayoutGrid className="h-4 w-4" />}
            label="看板"
            active={isBoards}
            collapsed={collapsed && !mobile}
            onClick={onNavigate}
          />
          <NavItem
            href="/canvases"
            icon={<PenLine className="h-4 w-4" />}
            label="画板库"
            active={isCanvases}
            collapsed={collapsed && !mobile}
            onClick={onNavigate}
          />
        </nav>

        {!collapsed || mobile ? (
          <div className="flex min-h-0 flex-1 flex-col border-t border-line pt-3">
            <div className="flex items-center justify-between px-3 pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                共享看板
              </span>
              <Tip label="新建看板">
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="icon-btn h-6 w-6"
                  aria-label="新建看板"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </Tip>
            </div>

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {boards.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2.5 text-left text-[12px] text-muted transition hover:border-brand/40 hover:text-brand"
                >
                  <Plus className="h-3.5 w-3.5" />
                  创建第一个看板
                </button>
              ) : (
                <ul className="space-y-0.5">
                  {boards.map((board) => {
                    const active = pathname === `/boards/${board.id}`;
                    return (
                      <li key={board.id}>
                        <Link
                          href={`/boards/${board.id}`}
                          onClick={onNavigate}
                          className={cn(
                            "group flex items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] transition",
                            active
                              ? "bg-brand-soft font-medium text-brand"
                              : "text-muted hover:bg-surface-2 hover:text-ink"
                          )}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: board.accent }}
                          />
                          <span className="min-w-0 flex-1 truncate">{board.title}</span>
                          <span className="shrink-0 text-[10.5px] tabular-nums text-faint">
                            {board.cardsCount}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className={cn("border-t border-line p-2", collapsed && !mobile && "flex justify-center")}>
          <UserMenu
            user={user}
            collapsed={collapsed && !mobile}
            onLogout={onLogout}
            themeMode={mode}
            onToggleTheme={toggle}
          />
        </div>
      </aside>

      <CreateBoardDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function NavItem({
  href,
  icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const content = (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition",
        active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-ink",
        collapsed && "w-9 justify-center px-0"
      )}
    >
      {icon}
      {!collapsed ? <span className="truncate">{label}</span> : null}
      {!collapsed && active ? <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" /> : null}
    </Link>
  );

  return collapsed ? <Tip label={label}>{content}</Tip> : content;
}

function UserMenu({
  user,
  collapsed,
  onLogout,
  themeMode,
  onToggleTheme,
}: {
  user: AppUser;
  collapsed: boolean;
  onLogout: () => void;
  themeMode: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const router = useRouter();

  return (
    <Dropdown
      width={200}
      trigger={
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-surface-2",
            collapsed && "justify-center px-0"
          )}
        >
          <Avatar name={user.displayName} color={user.color} size={30} />
          {!collapsed ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink">
                {user.displayName}
              </span>
              <span className="block truncate text-[10.5px] text-faint">@{user.username}</span>
            </span>
          ) : null}
        </button>
      }
    >
      <div className="px-2.5 py-2">
        <p className="truncate text-[12.5px] font-medium text-ink">{user.displayName}</p>
        <p className="truncate text-[11px] text-faint">@{user.username}</p>
      </div>
      <MenuDivider />
      <MenuItem
        icon={<Settings />}
        onClick={() => router.push("/settings")}
        data-skip-autofocus
      >
        账号设置
      </MenuItem>
      <MenuItem
        icon={themeMode === "dark" ? <Sun /> : <Moon />}
        onClick={onToggleTheme}
        data-skip-autofocus
      >
        {themeMode === "dark" ? "切换到浅色" : "切换到深色"}
      </MenuItem>
      <MenuDivider />
      <MenuItem icon={<LogOut />} danger onClick={onLogout} data-skip-autofocus>
        退出登录
      </MenuItem>
    </Dropdown>
  );
}

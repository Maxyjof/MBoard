"use client";

// 看板标题栏：展示标题与描述，提供新建列表与设置入口
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tip";
import type { BoardDetail } from "@/lib/types";

type BoardHeaderProps = {
  board: BoardDetail;
  onCreateList: () => void;
  onOpenSettings: () => void;
};

export function BoardHeader({ board, onCreateList, onOpenSettings }: BoardHeaderProps) {
  return (
    <header className="shrink-0 border-b border-line bg-surface px-3 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: board.accent }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink sm:text-[17px]">
            {board.title}
          </h1>
          {board.description ? (
            <p className="mt-0.5 line-clamp-1 text-[12px] text-muted">{board.description}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <Button type="button" variant="primary" size="sm" onClick={onCreateList}>
            <Plus className="h-3.5 w-3.5" />
            新建列表
          </Button>
          <Tip label="看板设置">
            <button
              type="button"
              className="icon-btn"
              onClick={onOpenSettings}
              aria-label="看板设置"
            >
              <Settings2 className="h-4 w-4" />
            </button>
          </Tip>
        </div>
      </div>
    </header>
  );
}

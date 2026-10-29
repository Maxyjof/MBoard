"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  Ellipsis,
  ExternalLink,
  Layers,
  Link2,
  Pencil,
  PenLine,
  Trash2,
} from "lucide-react";
import { Dropdown, MenuDivider, MenuItem } from "@/components/ui/dropdown";
import { relativeTime } from "@/lib/utils";
import type { CanvasSummary } from "@/lib/types";

type CanvasCardProps = {
  canvas: CanvasSummary;
  onRename: (canvas: CanvasSummary) => void;
  onDelete: (canvas: CanvasSummary) => void;
  onCopyLink: (canvas: CanvasSummary) => void;
};

// 画板卡片：缩略图或点阵占位 + 标题 + 更新时间 + 元素数量
export function CanvasCard({ canvas, onRename, onDelete, onCopyLink }: CanvasCardProps) {
  const router = useRouter();
  const updatedAt = new Date(canvas.updatedAt);

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-ink/10 hover:shadow-panel">
      <Link
        href={`/canvas/${canvas.id}`}
        className="block rounded-2xl focus-visible:outline-none"
        aria-label={`打开画板 ${canvas.title}`}
      >
        <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-surface-2">
          {canvas.thumbnailUrl ? (
            <img
              src={canvas.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="dot-grid flex h-full w-full items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-muted shadow-sm transition group-hover:text-brand">
                <PenLine className="h-5 w-5" />
              </span>
            </div>
          )}
          {canvas.elementCount === 0 ? (
            <span className="absolute bottom-2 left-2 rounded-md bg-slate-950/55 px-1.5 py-0.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
              空白画板
            </span>
          ) : null}
        </div>

        <div className="p-3.5">
          <h3 className="truncate text-[13.5px] font-medium text-ink">{canvas.title}</h3>
          <p className="mt-1 line-clamp-1 text-[11.5px] leading-5 text-muted">
            {canvas.description || "暂无描述"}
          </p>
          <div className="mt-2.5 flex items-center gap-3 text-[11px] text-faint">
            <span className="inline-flex shrink-0 items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              {canvas.elementCount} 元素
            </span>
            <span
              className="inline-flex shrink-0 items-center gap-1"
              title={updatedAt.toLocaleString("zh-CN")}
            >
              <Clock className="h-3.5 w-3.5" />
              {relativeTime(updatedAt)}
            </span>
            {canvas.lastEditor ? (
              <span className="ml-auto min-w-0 truncate text-[10.5px]">{canvas.lastEditor}</span>
            ) : null}
          </div>
        </div>
      </Link>

      {/* 操作菜单独立于链接，避免嵌套交互元素 */}
      <div className="absolute right-2 top-2 z-10 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <Dropdown
          width={176}
          trigger={
            <button
              type="button"
              className="icon-btn border border-line bg-surface/95 backdrop-blur-sm"
              aria-label={`「${canvas.title}」的更多操作`}
            >
              <Ellipsis className="h-4 w-4" />
            </button>
          }
        >
          <MenuItem icon={<ExternalLink />} onClick={() => router.push(`/canvas/${canvas.id}`)}>
            打开
          </MenuItem>
          <MenuItem icon={<Pencil />} onClick={() => onRename(canvas)}>
            重命名
          </MenuItem>
          <MenuItem icon={<Link2 />} onClick={() => onCopyLink(canvas)}>
            复制链接
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={<Trash2 />} danger onClick={() => onDelete(canvas)}>
            删除
          </MenuItem>
        </Dropdown>
      </div>
    </article>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PenLine, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CanvasSummary } from "@/lib/types";
import { CanvasCard } from "./canvas-card";
import { CanvasFormDialog } from "./canvas-form-dialog";

type CanvasLibraryProps = {
  initialCanvases: CanvasSummary[];
};

// 画板库：标题栏 + 搜索 + 新建 + 响应式卡片网格
export function CanvasLibrary({ initialCanvases }: CanvasLibraryProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CanvasSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CanvasSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canvases = initialCanvases;
  const keyword = query.trim().toLowerCase();

  // 前端即时过滤，数据量不大无需请求服务端
  const filtered = useMemo(() => {
    if (!keyword) return canvases;
    return canvases.filter((canvas) =>
      `${canvas.title} ${canvas.description ?? ""}`.toLowerCase().includes(keyword)
    );
  }, [canvases, keyword]);

  const refresh = useCallback(() => router.refresh(), [router]);

  const copyLink = useCallback(async (canvas: CanvasSummary) => {
    const url = `${window.location.origin}/canvas/${canvas.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("画板链接已复制");
    } catch {
      toast.error("复制失败，请手动复制地址");
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/canvases/${deleteTarget.id}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        toast.error(data.error || "删除画板失败");
        return;
      }

      toast.success("画板已删除");
      setDeleteTarget(null);
      router.refresh();
    } catch {
      toast.error("网络异常，请稍后再试");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting, router]);

  return (
    <div className="scroll-thin flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-ink">画板库</h1>
              <span className="chip bg-brand-soft text-brand">{canvases.length} 块</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-5 text-muted">
              无限画布承载想法与流程，所有登录成员共享编辑
            </p>
          </div>

          <Button
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            新建画板
          </Button>
        </header>

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索画板标题或描述"
              aria-label="搜索画板"
              className="pl-9 pr-9"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="icon-btn absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <span className="text-[12px] text-faint">
            {keyword ? `找到 ${filtered.length} 块画板` : "按最近更新排序"}
          </span>
        </div>

        <section className="mt-6">
          {canvases.length === 0 ? (
            <EmptyState
              icon={<PenLine />}
              title="还没有画板"
              description="新建一块无限画板，把想法、流程与素材一次铺开，所有成员都能一起编辑"
              action={
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  新建画板
                </Button>
              }
              className="rounded-2xl border border-dashed border-line bg-surface/60"
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title="没有找到匹配的画板"
              description="换个关键词试试，或清空搜索查看全部画板"
              action={
                <Button variant="secondary" onClick={() => setQuery("")}>
                  清空搜索
                </Button>
              }
              className="rounded-2xl border border-dashed border-line bg-surface/60"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((canvas) => (
                <CanvasCard
                  key={canvas.id}
                  canvas={canvas}
                  onRename={setRenameTarget}
                  onDelete={setDeleteTarget}
                  onCopyLink={copyLink}
                />
              ))}

              {/* 搜索状态下不显示新建入口，避免干扰结果 */}
              {!keyword ? (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="group flex min-h-[190px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-line bg-surface/50 text-muted transition hover:border-brand/40 hover:bg-brand-soft/40 hover:text-brand"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface transition group-hover:border-brand/30">
                    <Plus className="h-4 w-4" />
                  </span>
                  <span className="text-[12.5px] font-medium">新建画板</span>
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <CanvasFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSaved={refresh}
      />

      <CanvasFormDialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        mode="rename"
        canvas={renameTarget}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
        title="删除画板"
        description={`确定删除「${deleteTarget?.title ?? ""}」吗？画板内容与缩略图将一并移除。`}
        confirmText="删除"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

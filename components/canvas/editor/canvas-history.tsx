"use client";

// 画板历史预览：只读查看最近 30 天的版本，不会回退共享画板
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/use-theme";
import { hydrateSceneFiles } from "./scene-assets";

const Excalidraw = dynamic(async () => (await import("@excalidraw/excalidraw")).Excalidraw, {
  ssr: false,
});

type Entry = { id: string; actor: string; createdAt: string };
type Scene = { elements: unknown[]; appState: Record<string, unknown> };

type CanvasHistoryProps = {
  canvasId: string;
  onClose: () => void;
};

export function CanvasHistory({ canvasId, onClose }: CanvasHistoryProps) {
  const { mode } = useTheme();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingScene, setLoadingScene] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/canvases/${canvasId}/history`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "历史记录加载失败");
        if (!alive) return;
        setEntries(data.entries);
        setHasMore(data.hasMore);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "历史记录加载失败"));
    return () => {
      alive = false;
    };
  }, [canvasId]);

  async function loadMore() {
    if (loadingMore || entries.length === 0) return;
    setLoadingMore(true);
    try {
      const cursor = entries[entries.length - 1].id;
      const response = await fetch(
        `/api/canvases/${canvasId}/history?cursor=${encodeURIComponent(cursor)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      setEntries((previous) => [...previous, ...data.entries]);
      setHasMore(data.hasMore);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoadingMore(false);
    }
  }

  async function select(entry: Entry) {
    setLoadingScene(true);
    try {
      const response = await fetch(
        `/api/canvases/${canvasId}/history?entry=${encodeURIComponent(entry.id)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      const parsed = JSON.parse(data.entry.sceneJson);
      setScene({
        elements: Array.isArray(parsed.elements) ? parsed.elements : [],
        appState: parsed.appState ?? {},
      });
      setSelected(entry);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoadingScene(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <strong className="text-[13.5px] text-ink">画板历史预览</strong>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          只读预览，当前画板不会被回退，退出后继续编辑最新版本
        </span>
        <Button size="sm" onClick={onClose}>
          返回当前画板
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="scroll-thin w-64 shrink-0 overflow-y-auto border-r border-line p-2">
          <p className="px-2 py-1.5 text-[11px] text-faint">最近 30 天 · 共 {entries.length} 条</p>
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => void select(entry)}
              className={`w-full rounded-lg p-2 text-left text-xs transition hover:bg-surface-2 ${
                selected?.id === entry.id ? "bg-brand-soft" : ""
              }`}
            >
              <span className="block truncate text-ink">{entry.actor}</span>
              <span className="text-muted">
                {new Date(entry.createdAt).toLocaleString("zh-CN")}
              </span>
            </button>
          ))}
          {hasMore ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={loadingMore}
              className="mt-1 w-full"
              onClick={() => void loadMore()}
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </Button>
          ) : null}
          {entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted">还没有历史记录</p>
          ) : null}
        </aside>

        <main className="relative min-w-0 flex-1">
          {scene && selected ? (
            <Excalidraw
              key={selected.id}
              langCode="zh-CN"
              theme={mode}
              initialData={{
                elements: scene.elements as never,
                appState: { ...scene.appState, collaborators: new Map() } as never,
                scrollToContent: true,
              }}
              viewModeEnabled
              UIOptions={{
                canvasActions: {
                  clearCanvas: false,
                  loadScene: false,
                  saveToActiveFile: false,
                  export: false,
                },
              }}
              excalidrawAPI={(api) => {
                if (api) void hydrateSceneFiles(scene.elements as never, api, new Set());
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              {loadingScene ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在加载版本…
                </span>
              ) : (
                "在左侧选择一条记录查看当时的画面"
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

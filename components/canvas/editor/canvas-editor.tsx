"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Y from "yjs";
import {
  ArrowLeft,
  Check,
  Cloud,
  CloudOff,
  Download,
  FileJson,
  Image as ImageIcon,
  Link2,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Users,
} from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dropdown, MenuDivider, MenuItem } from "@/components/ui/dropdown";
import { Tip } from "@/components/ui/tip";
import { useTheme } from "@/lib/use-theme";
import { cn } from "@/lib/utils";
import type { AppUser, SceneData } from "@/lib/types";
import { CollabConnection, type CollabStatus } from "@/lib/collab/client";
import { SceneBinding } from "./scene-binding";
import { fetchAssetDataURL, hydrateSceneFiles, uploadAsset } from "./scene-assets";
import { AssetPanel, type CanvasSelection } from "./asset-panel";

const Excalidraw = dynamic(
  async () => {
    const mod = await import("@excalidraw/excalidraw");
    return mod.Excalidraw;
  },
  {
    ssr: false,
    loading: () => <CanvasLoading label="正在加载画布引擎" />,
  }
);

type CanvasEditorProps = {
  canvas: {
    id: string;
    title: string;
    description: string | null;
    updatedAt: string;
  };
  initialScene: SceneData;
  user: AppUser;
};

type CollaboratorInfo = { clientId: number; name: string; color: string };
type SaveState = "saved" | "saving";

const REMOTE_APPLY_DELAY = 80;

// 画布编辑器：Excalidraw + Yjs 实时同步 + 资源面板
export function CanvasEditor({ canvas, initialScene, user }: CanvasEditorProps) {
  const router = useRouter();
  const { mode } = useTheme();

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const bindingRef = useRef<SceneBinding | null>(null);
  const providerRef = useRef<CollabConnection | null>(null);
  const loadedFilesRef = useRef<Set<string>>(new Set());
  const pointerDownRef = useRef(false);
  const pendingRemoteRef = useRef(false);
  const remoteTimerRef = useRef<number | null>(null);
  const extractTimerRef = useRef<number | null>(null);
  const extractingRef = useRef(false);
  const selectionKeyRef = useRef("");
  const appStateRef = useRef<any>(null);
  const pointerTimerRef = useRef<number | null>(null);
  const pendingPointerRef = useRef<any>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const readyRef = useRef(false);
  const apiMountedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [title, setTitle] = useState(canvas.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(canvas.title);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const initialRef = useRef<{ elements: any[]; files: Record<string, any> }>({
    elements: [],
    files: {},
  });

  // 选中元素信息变化时才更新面板，避免 onChange 高频重渲染
  const updateSelection = useCallback((next: CanvasSelection | null) => {
    const key = next
      ? `${next.docId ?? ""}|${next.videoAssetId ?? ""}|${next.docTitle ?? ""}|${next.videoName ?? ""}`
      : "";
    if (selectionKeyRef.current === key) return;
    selectionKeyRef.current = key;
    setSelection(next);
  }, []);

  // 远端变更延迟合批后应用到 Excalidraw
  const scheduleRemoteApply = useCallback(() => {
    if (remoteTimerRef.current) {
      pendingRemoteRef.current = true;
      return;
    }

    remoteTimerRef.current = window.setTimeout(() => {
      remoteTimerRef.current = null;

      if (pointerDownRef.current) {
        pendingRemoteRef.current = true;
        return;
      }

      const api = apiRef.current;
      const binding = bindingRef.current;
      if (!api || !binding) return;

      // Excalidraw 刚挂载时调用 updateScene 会触发内部 setState 警告，稍等再应用
      if (!apiMountedRef.current) {
        pendingRemoteRef.current = true;
        return;
      }

      // 正在编辑文字时先不打断输入
      if (api.getAppState().editingTextElement) {
        pendingRemoteRef.current = true;
        window.setTimeout(() => scheduleRemoteApplyRef.current?.(), 420);
        return;
      }

      const elements = binding.readElements();
      binding.markSynced(elements as any);
      api.updateScene({ elements: elements as any, captureUpdate: "NEVER" as any });

      const background = binding.readBackgroundColor();
      if (background) {
        api.updateScene({
          appState: { viewBackgroundColor: background } as any,
          captureUpdate: "NEVER" as any,
        });
      }

      void hydrateSceneFiles(elements, api, loadedFilesRef.current);
      pendingRemoteRef.current = false;
    }, REMOTE_APPLY_DELAY);
  }, []);

  // 供延时重试引用，避免闭包捕获旧函数
  const scheduleRemoteApplyRef = useRef(scheduleRemoteApply);
  scheduleRemoteApplyRef.current = scheduleRemoteApply;

  const syncCollaborators = useCallback(() => {
    const provider = providerRef.current;
    const api = apiRef.current;
    if (!provider) return;

    const map = new Map<string, any>();
    const list: CollaboratorInfo[] = [];

    provider.awareness.getStates().forEach((state, clientId) => {
      if (clientId === provider.awareness.clientID) return;
      const info = (state as any)?.user;
      if (!info?.name) return;

      map.set(String(clientId), {
        pointer: (state as any).pointer ?? undefined,
        button: (state as any).button === "down" ? "down" : "up",
        username: info.name,
        color: {
          background: `${info.color}33`,
          stroke: info.color,
        },
        selectedElementIds: (state as any).selectedElementIds ?? {},
      });
      list.push({ clientId, name: info.name, color: info.color });
    });

    setCollaborators(list);
    if (api && apiMountedRef.current) {
      api.updateScene({ appState: { collaborators: map } as any, captureUpdate: "NEVER" as any });
    }
  }, []);

  // 本地光标 / 选区广播（节流）
  const broadcastPointer = useCallback((payload: any) => {
    pendingPointerRef.current = payload;
    if (pointerTimerRef.current) return;

    pointerTimerRef.current = window.setTimeout(() => {
      pointerTimerRef.current = null;
      const provider = providerRef.current;
      const latest = pendingPointerRef.current;
      if (!provider || !latest) return;
      const current = provider.awareness.getLocalState() as any;
      provider.awareness.setLocalState({
        ...current,
        pointer: latest.pointer,
        button: latest.button,
      });
    }, 60);
  }, []);

  const broadcastSelection = useCallback((selectedElementIds: Record<string, boolean>) => {
    if (selectionTimerRef.current) return;
    selectionTimerRef.current = window.setTimeout(() => {
      selectionTimerRef.current = null;
      const provider = providerRef.current;
      if (!provider) return;
      const current = provider.awareness.getLocalState() as any;
      provider.awareness.setLocalState({ ...current, selectedElementIds });
    }, 140);
  }, []);

  const markDirty = useCallback(() => {
    setSaveState("saving");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      setSaveState("saved");
    }, 1100);
  }, []);

  // 把 Excalidraw 里粘贴/拖入的图片自动转存到资源库
  const extractNativeImages = useCallback(async () => {
    const api = apiRef.current;
    if (!api || extractingRef.current) return;

    const files = api.getFiles();
    const elements = api.getSceneElements();
    const pending = elements.filter(
      (element: any) =>
        element.type === "image" &&
        element.fileId &&
        !element.customData?.assetId &&
        files[element.fileId] &&
        !element.isDeleted
    );
    if (pending.length === 0) return;

    extractingRef.current = true;
    try {
      for (const element of pending as any[]) {
        const file = files[element.fileId];
        if (!file?.dataURL) continue;

        const blob = await (await fetch(file.dataURL)).blob();
        const asset = await uploadAsset(
          new File([blob], "image.png", { type: file.mimeType || "image/png" }),
          "image"
        );

        const updated = api.getSceneElements().map((item: any) =>
          item.id === element.id
            ? {
                ...item,
                version: item.version + 1,
                versionNonce: Math.floor(Math.random() * 2 ** 31),
                customData: { ...(item.customData || {}), assetId: asset.id, mimeType: file.mimeType },
              }
            : item
        );
        api.updateScene({ elements: updated as any, captureUpdate: "NEVER" as any });
        loadedFilesRef.current.add(element.fileId);
      }
    } catch {
      // 图片转存失败不阻塞编辑，稍后会再次尝试
    } finally {
      extractingRef.current = false;
    }
  }, []);

  const scheduleExtract = useCallback(() => {
    if (extractTimerRef.current) window.clearTimeout(extractTimerRef.current);
    extractTimerRef.current = window.setTimeout(() => {
      extractTimerRef.current = null;
      void extractNativeImages();
    }, 1200);
  }, [extractNativeImages]);

  const handleChange = useCallback(
    (elements: readonly any[], appState: any) => {
      const binding = bindingRef.current;
      if (!binding || !readyRef.current) return;

      appStateRef.current = appState;
      binding.applyLocal(elements as any, {
        viewBackgroundColor: appState.viewBackgroundColor,
      });

      // 同步选中元素里的文档/视频卡片信息
      const selectedIds = Object.keys(appState.selectedElementIds || {}).filter(
        (id) => appState.selectedElementIds[id]
      );
      broadcastSelection(appState.selectedElementIds || {});

      if (selectedIds.length === 1) {
        const element = elements.find((item) => item.id === selectedIds[0]) as any;
        if (element?.customData?.mbDocId) {
          updateSelection({ docId: element.customData.mbDocId, docTitle: element.customData.mbDocTitle });
        } else if (element?.customData?.mbVideoAssetId) {
          updateSelection({
            videoAssetId: element.customData.mbVideoAssetId,
            videoName: element.customData.mbVideoName,
          });
        } else {
          updateSelection(null);
        }
      } else {
        updateSelection(null);
      }

      markDirty();
      scheduleExtract();
    },
    [broadcastSelection, markDirty, scheduleExtract, updateSelection]
  );

  const handlePointerUpdate = useCallback(
    (payload: any) => {
      broadcastPointer(payload);
    },
    [broadcastPointer]
  );

  const handleApiReady = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;

      api.onPointerDown(() => {
        pointerDownRef.current = true;
      });

      api.onPointerUp(() => {
        pointerDownRef.current = false;
        if (pendingRemoteRef.current) {
          pendingRemoteRef.current = false;
          scheduleRemoteApplyRef.current?.();
        }
      });

      // 等 Excalidraw 完成首帧挂载后再推协作状态
      window.setTimeout(() => {
        apiMountedRef.current = true;
        syncCollaborators();
        void hydrateSceneFiles(api.getSceneElements() as any, api, loadedFilesRef.current);
        if (pendingRemoteRef.current) {
          pendingRemoteRef.current = false;
          scheduleRemoteApplyRef.current?.();
        }

        // 开发环境暴露调试句柄，便于端到端自动化验证
        if (process.env.NODE_ENV !== "production") {
          (window as any).__MB_EDITOR__ = {
            api,
            binding: bindingRef.current,
            provider: providerRef.current,
          };
        }
      }, 120);
    },
    [syncCollaborators]
  );

  // 建立协作连接 + 首屏数据
  useEffect(() => {
    let cancelled = false;
    let synced = false;

    const doc = new Y.Doc();
    const binding = new SceneBinding(doc, () => scheduleRemoteApplyRef.current?.());
    bindingRef.current = binding;

    const provider = new CollabConnection({
      canvasId: canvas.id,
      doc,
      onStatus: (next) => {
        if (!cancelled) setStatus(next);
      },
      onSynced: async () => {
        if (cancelled || synced) return;
        synced = true;

        let elements = binding.readElements<any>();
        if (elements.length === 0 && initialScene.elements.length > 0) {
          elements = initialScene.elements as any[];
        }

        const files: Record<string, any> = {};
        const imageElements = elements.filter(
          (element: any) =>
            element?.type === "image" && element?.fileId && element?.customData?.assetId
        );

        await Promise.all(
          imageElements.slice(0, 30).map(async (element: any) => {
            const dataURL = await fetchAssetDataURL(element.customData.assetId);
            if (!dataURL) return;
            files[element.fileId] = {
              id: element.fileId,
              dataURL,
              mimeType: element.customData.mimeType || "image/png",
              created: Date.now(),
            };
            loadedFilesRef.current.add(element.fileId);
          })
        );

        if (cancelled) return;
        initialRef.current = { elements, files };
        readyRef.current = true;
        setReady(true);
      },
    });

    providerRef.current = provider;

    // 在线身份 + 远端成员变化
    provider.awareness.setLocalState({
      user: { id: user.username, name: user.displayName, color: user.color },
      pointer: null,
      button: "up",
    });

    const handleAwareness = () => {
      if (!cancelled) syncCollaborators();
    };
    provider.awareness.on("change", handleAwareness);

    // 连接较慢时先用本地快照兜底，避免一直空白
    const fallback = window.setTimeout(() => {
      if (cancelled || synced) return;
      synced = true;
      initialRef.current = { elements: initialScene.elements as any[], files: {} };
      readyRef.current = true;
      setReady(true);
      toast.info("协作通道连接较慢，已进入本地编辑模式");
    }, 6000);

    return () => {
      cancelled = true;
      apiMountedRef.current = false;
      window.clearTimeout(fallback);
      provider.awareness.off("change", handleAwareness);
      provider.destroy();
      bindingRef.current = null;
      providerRef.current = null;
      doc.destroy();
    };
  }, [canvas.id, initialScene, syncCollaborators, user.username, user.displayName, user.color]);

  // 缩略图：进入后生成一次，之后定期刷新
  const saveThumbnail = useCallback(async () => {
    const api = apiRef.current;
    if (!api || document.visibilityState === "hidden") return;

    const elements = api.getSceneElements().filter((element: any) => !element.isDeleted);
    if (elements.length === 0) return;

    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const background = api.getAppState().viewBackgroundColor || "#ffffff";
      const blob = await exportToBlob({
        elements: elements as any,
        appState: { exportBackground: true, viewBackgroundColor: background } as any,
        files: api.getFiles(),
        mimeType: "image/png",
        exportPadding: 40,
        maxWidthOrHeight: 1400,
      });

      // 统一裁成 16:10 并居中留白，保证画板库卡片不变形、不裁切
      const bitmap = await createImageBitmap(blob);
      const thumbnailCanvas = document.createElement("canvas");
      thumbnailCanvas.width = 1200;
      thumbnailCanvas.height = 750;
      const context = thumbnailCanvas.getContext("2d");
      if (!context) return;

      context.fillStyle = background;
      context.fillRect(0, 0, thumbnailCanvas.width, thumbnailCanvas.height);

      const scale = Math.min(
        thumbnailCanvas.width / bitmap.width,
        thumbnailCanvas.height / bitmap.height
      );
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      context.drawImage(
        bitmap,
        Math.round((thumbnailCanvas.width - width) / 2),
        Math.round((thumbnailCanvas.height - height) / 2),
        width,
        height
      );

      const thumbnail = await new Promise<Blob | null>((resolve) =>
        thumbnailCanvas.toBlob((value) => resolve(value), "image/png")
      );
      if (!thumbnail) return;

      const form = new FormData();
      form.append("file", new File([thumbnail], "thumbnail.png", { type: "image/png" }));
      await fetch(`/api/canvases/${canvas.id}/thumbnail`, { method: "POST", body: form });
    } catch {
      // 缩略图失败不影响正常编辑
    }
  }, [canvas.id]);

  useEffect(() => {
    if (!ready) return;
    const first = window.setTimeout(() => void saveThumbnail(), 5000);
    const timer = window.setInterval(() => void saveThumbnail(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [ready, saveThumbnail]);

  // 离开页面前补一次缩略图
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (remoteTimerRef.current) window.clearTimeout(remoteTimerRef.current);
      if (extractTimerRef.current) window.clearTimeout(extractTimerRef.current);
      if (pointerTimerRef.current) window.clearTimeout(pointerTimerRef.current);
    };
  }, []);

  const saveTitle = useCallback(async () => {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === title) {
      setTitleDraft(title);
      return;
    }

    setTitle(next);
    try {
      const response = await fetch(`/api/canvases/${canvas.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!response.ok) throw new Error("重命名失败");
      toast.success("画板已重命名");
      router.refresh();
    } catch {
      setTitle(title);
      setTitleDraft(title);
      toast.error("重命名失败，请稍后重试");
    }
  }, [canvas.id, router, title, titleDraft]);

  const exportPng = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements: api.getSceneElements() as any,
        appState: { exportBackground: true } as any,
        files: api.getFiles(),
        mimeType: "image/png",
        exportPadding: 32,
      });
      downloadBlob(blob, `${title || "canvas"}.png`);
    } catch {
      toast.error("导出图片失败");
    }
  }, [title]);

  const exportJson = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const payload = {
      type: "excalidraw",
      version: 2,
      source: "mboard",
      elements: api.getSceneElements(),
      appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
      files: api.getFiles(),
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `${title || "canvas"}.excalidraw`
    );
  }, [title]);

  // 页面可见性恢复时补同步远端数据
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && pendingRemoteRef.current) {
        pendingRemoteRef.current = false;
        scheduleRemoteApplyRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const onlineCount = collaborators.length + 1;
  const statusLabel =
    status === "connected" ? (saveState === "saving" ? "同步中" : "已同步") : status === "connecting" ? "连接中" : "离线编辑";

  const headerMeta = useMemo(() => {
    if (status === "connected") {
      return { icon: <Cloud className="h-3 w-3" />, tone: "text-success" };
    }
    if (status === "connecting") {
      return { icon: <Loader2 className="h-3 w-3 animate-spin" />, tone: "text-muted" };
    }
    return { icon: <CloudOff className="h-3 w-3" />, tone: "text-warning" };
  }, [status]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
        <Tip label="返回画板库">
          <Link href="/canvases" className="icon-btn" aria-label="返回画板库">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Tip>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveTitle();
                  if (event.key === "Escape") {
                    setTitleDraft(title);
                    setEditingTitle(false);
                  }
                }}
                className="h-8 w-full max-w-[380px] rounded-lg border border-brand/50 bg-surface px-2 text-[13.5px] font-medium outline-none ring-2 ring-brand/15"
                maxLength={80}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(title);
                  setEditingTitle(true);
                }}
                className="group flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-0.5 text-left transition hover:bg-surface-2"
              >
                <span className="truncate text-[13.5px] font-semibold text-ink">{title}</span>
                <Pencil className="h-3 w-3 shrink-0 text-faint opacity-0 transition group-hover:opacity-100" />
              </button>
            )}
            <span className="hidden shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] text-muted sm:inline-flex">
              <Users className="h-2.5 w-2.5" />
              {onlineCount} 人在线
            </span>
          </div>
          <div className={cn("flex items-center gap-1 text-[10.5px]", headerMeta.tone)}>
            {headerMeta.icon}
            <span>{statusLabel}</span>
            <span className="text-faint">·</span>
            <span className="text-faint">改动自动保存并实时同步</span>
          </div>
        </div>

        {collaborators.length > 0 ? (
          <div className="hidden items-center -space-x-2 sm:flex">
            {collaborators.slice(0, 4).map((person) => (
              <Tip key={person.clientId} label={person.name}>
                <Avatar name={person.name} color={person.color} size={26} ring />
              </Tip>
            ))}
            {collaborators.length > 4 ? (
              <span className="flex h-[26px] items-center rounded-full border border-line bg-surface-2 px-1.5 text-[10px] text-muted">
                +{collaborators.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}

        <Dropdown
          width={190}
          trigger={
            <Button size="sm" variant="outline" className="hidden sm:inline-flex">
              <Download className="h-3.5 w-3.5" />
              导出
            </Button>
          }
        >
          <MenuItem icon={<ImageIcon />} onClick={() => void exportPng()}>
            导出为 PNG
          </MenuItem>
          <MenuItem icon={<FileJson />} onClick={exportJson}>
            导出为 Excalidraw
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<Link2 />}
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
              toast.success("画板链接已复制");
            }}
          >
            复制画板链接
          </MenuItem>
        </Dropdown>

        <Tip label={panelOpen ? "收起资料面板" : "打开资料面板"}>
          <button
            type="button"
            onClick={() => setPanelOpen((value) => !value)}
            className="icon-btn"
            aria-label="切换资料面板"
          >
            {panelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </Tip>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {ready ? (
            <Excalidraw
              initialData={{
                elements: initialRef.current.elements as any,
                appState: {
                  viewBackgroundColor:
                    bindingRef.current?.readBackgroundColor() ||
                    initialScene.appState?.viewBackgroundColor ||
                    "#ffffff",
                  gridSize: null,
                } as any,
                files: initialRef.current.files as any,
                scrollToContent: true,
              }}
              excalidrawAPI={handleApiReady}
              onChange={handleChange as any}
              onPointerUpdate={handlePointerUpdate}
              isCollaborating
              langCode="zh-CN"
              theme={mode}
              name={title}
              UIOptions={{
                canvasActions: {
                  export: false,
                  saveToActiveFile: false,
                  loadScene: false,
                  saveAsImage: false,
                  toggleTheme: false,
                  clearCanvas: true,
                  changeViewBackgroundColor: true,
                },
              }}
            />
          ) : (
            <CanvasLoading label="正在连接协作会话" />
          )}
        </div>

        {panelOpen ? (
          <AssetPanel
            canvasId={canvas.id}
            apiRef={apiRef}
            selection={selection}
            onClose={() => setPanelOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function CanvasLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 bg-canvas text-muted">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface shadow-card">
        <Loader2 className="h-5 w-5 animate-spin text-brand" />
      </div>
      <p className="text-[12.5px]">{label}</p>
    </div>
  );
}

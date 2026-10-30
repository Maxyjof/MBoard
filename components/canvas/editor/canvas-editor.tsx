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
import type { AppUser, DocumentDTO, SceneData } from "@/lib/types";
import { CollabConnection, type CollabStatus } from "@/lib/collab/client";
import { SceneBinding } from "./scene-binding";
import { fetchAssetDataURL, hydrateSceneFiles, uploadAsset } from "./scene-assets";
import {
  absorbElementIntoCompositeCard,
  insertDocCard,
  insertFileCard,
  insertVideoCard,
  migrateCompositeCards,
  syncFrameChildren,
} from "./insert";
import { parseCompositeCardData, type CompositeCardData } from "@/components/canvas/composite-card-render";
import {
  AssetPanel,
  type CanvasSelection,
  type OpenElementRequest,
} from "./asset-panel";

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
  const collabSyncTimerRef = useRef<number | null>(null);
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
  const [openRequest, setOpenRequest] = useState<OpenElementRequest | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const processDroppedFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const lastCanvasHitRef = useRef<{
    kind: "doc" | "video" | "file" | "composite";
    id: string;
    name?: string;
    mime?: string;
    composite?: CompositeCardData;
  } | null>(null);
  const compositeMigratedRef = useRef(false);
  const pressedElementIdRef = useRef<string | null>(null);
  const canvasPressRef = useRef<{
    hit: {
      kind: "doc" | "video" | "file" | "composite";
      id: string;
      name?: string;
      mime?: string;
      composite?: CompositeCardData;
    } | null;
    x: number;
    y: number;
    time: number;
  } | null>(null);
  const initialRef = useRef<{ elements: any[]; files: Record<string, any> }>({
    elements: [],
    files: {},
  });

  // 选中元素信息变化时才更新面板，避免 onChange 高频重渲染
  const updateSelection = useCallback((next: CanvasSelection | null) => {
    const key = next
      ? `${next.docId ?? ""}|${next.videoAssetId ?? ""}|${next.fileAssetId ?? ""}|${
          next.docTitle ?? ""
        }|${next.videoName ?? ""}|${next.fileName ?? ""}`
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
        // Excalidraw 用 id 的哈希生成稳定的光标颜色
        id: info.username,
        pointer: (state as any).pointer ?? undefined,
        button: (state as any).button === "down" ? "down" : "up",
        username: info.name,
        color: {
          background: info.color,
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

  // 光标移动很频繁，在线状态合并到 80ms 一次再刷新
  const scheduleSyncCollaborators = useCallback(() => {
    if (collabSyncTimerRef.current) return;
    collabSyncTimerRef.current = window.setTimeout(() => {
      collabSyncTimerRef.current = null;
      syncCollaborators();
    }, 80);
  }, [syncCollaborators]);

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

      // 旧版组合卡片是多个元素拼起来的，首次加载时迁移成单张图片
      if (
        !compositeMigratedRef.current &&
        apiRef.current &&
        elements.some(
          (element: any) =>
            element.type === "text" && /^\d+\s*个字段/.test(element.text || "")
        )
      ) {
        compositeMigratedRef.current = true;
        void migrateCompositeCards(apiRef.current);
      }

      // 同步选中元素里的文档/视频卡片信息
      const selectedIds = Object.keys(appState.selectedElementIds || {}).filter(
        (id) => appState.selectedElementIds[id]
      );
      broadcastSelection(appState.selectedElementIds || {});

      if (selectedIds.length === 1) {
        const element = elements.find((item) => item.id === selectedIds[0]) as any;
        if (element?.customData?.mbComposite) {
          updateSelection(null);
        } else if (element?.customData?.mbDocId) {
          updateSelection({ docId: element.customData.mbDocId, docTitle: element.customData.mbDocTitle });
        } else if (element?.customData?.mbVideoAssetId) {
          updateSelection({
            videoAssetId: element.customData.mbVideoAssetId,
            videoName: element.customData.mbVideoName,
          });
        } else if (element?.customData?.mbFileAssetId) {
          updateSelection({
            fileAssetId: element.customData.mbFileAssetId,
            fileName: element.customData.mbFileName,
            fileMime: element.customData.mbFileMime,
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

      api.onPointerDown((_activeTool, pointerDownState, event) => {
        pointerDownRef.current = true;

        // 记录这次点击命中的卡片，双击时用它判断目标
        // 只取鼠标最上层的命中元素，避免重叠卡片时优先打开下层文档
        const hitElement = pointerDownState.hit.element as any;
        pressedElementIdRef.current = hitElement?.id ?? null;
        const docElement = hitElement?.customData?.mbDocId ? hitElement : null;
        const videoElement = hitElement?.customData?.mbVideoAssetId ? hitElement : null;
        const fileElement = hitElement?.customData?.mbFileAssetId ? hitElement : null;
        const compositeElement = hitElement?.customData?.mbComposite ? hitElement : null;

        lastCanvasHitRef.current = compositeElement
          ? {
              kind: "composite",
              id: compositeElement.id,
              composite: parseCompositeCardData(compositeElement.customData) || undefined,
            }
          : docElement
          ? { kind: "doc", id: docElement.customData.mbDocId }
          : videoElement
            ? { kind: "video", id: videoElement.customData.mbVideoAssetId }
            : fileElement
              ? {
                  kind: "file",
                  id: fileElement.customData.mbFileAssetId,
                  name: fileElement.customData.mbFileName,
                  mime: fileElement.customData.mbFileMime,
                }
              : null;

        canvasPressRef.current = {
          hit: lastCanvasHitRef.current,
          x: event.clientX,
          y: event.clientY,
          time: Date.now(),
        };
      });

      api.onPointerUp((_activeTool, _pointerDownState, event) => {
        pointerDownRef.current = false;
        if (pendingRemoteRef.current) {
          pendingRemoteRef.current = false;
          scheduleRemoteApplyRef.current?.();
        }

        // 拖拽结束后同步画框 children，保证子元素随画框移动
        syncFrameChildren(api);

        // 自己判断单击：位移小且时间短；拖拽/框选/缩放不会触发
        const press = canvasPressRef.current;
        canvasPressRef.current = null;
        const pressedId = pressedElementIdRef.current;
        pressedElementIdRef.current = null;
        if (event.button !== 0) return;

        const distance = press
          ? Math.hypot(event.clientX - press.x, event.clientY - press.y)
          : Number.POSITIVE_INFINITY;
        if (press?.hit && distance < 5 && Date.now() - press.time < 600) {
          setPanelOpen(true);
          setOpenRequest({ ...press.hit, seq: Date.now() });
          return;
        }

        // 拖拽文字/图片到组合卡片上时，直接吸收成卡片成员
        if (distance >= 5 && pressedId) {
          const state = api.getAppState();
          const zoom = state.zoom?.value ?? 1;
          const sceneX = (event.clientX - (state.offsetLeft || 0)) / zoom - state.scrollX;
          const sceneY = (event.clientY - (state.offsetTop || 0)) / zoom - state.scrollY;
          const source = api
            .getSceneElements()
            .find((element: any) => element.id === pressedId) as any;
          if (source && !source.customData?.mbComposite) {
            const card = api
              .getSceneElements()
              .filter(
                (element: any) =>
                  element.customData?.mbComposite &&
                  sceneX >= element.x &&
                  sceneX <= element.x + element.width &&
                  sceneY >= element.y &&
                  sceneY <= element.y + element.height
              )
              .sort((a: any, b: any) => a.width * a.height - b.width * b.height)[0] as any;
            if (card && card.id !== pressedId) {
              void absorbElementIntoCompositeCard(api, card.id, pressedId).then((absorbed) => {
                if (absorbed) toast.success("已加入组合卡片");
              });
            }
          }
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
      if (!cancelled) scheduleSyncCollaborators();
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
  }, [canvas.id, initialScene, scheduleSyncCollaborators, user.username, user.displayName, user.color]);

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
      if (collabSyncTimerRef.current) window.clearTimeout(collabSyncTimerRef.current);
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

  // 拖拽导入：.md 生成文档卡片，视频生成视频卡片，图片交给 Excalidraw 原生处理
  const isFileDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes("Files");

  function handleDragEnter(event: React.DragEvent) {
    if (!isFileDrag(event)) return;
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragLeave(event: React.DragEvent) {
    if (!isFileDrag(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function handleDragOver(event: React.DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  async function importDocumentFile(file: File, api: ExcalidrawImperativeAPI) {
    const contentMd = await file.text();
    const response = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: file.name,
        contentMd,
        kind: "markdown",
      }),
    });
    const data = (await response.json()) as { document?: DocumentDTO; error?: string };
    if (!response.ok || !data.document) {
      throw new Error(data.error || "导入文档失败");
    }
    insertDocCard(api, data.document);
    toast.success(`已导入「${data.document.title}」并插入画布`);
  }

  async function importVideoFile(file: File, api: ExcalidrawImperativeAPI) {
    const asset = await uploadAsset(file, "video");
    insertVideoCard(api, asset);
    toast.success("视频卡片已插入画布");
  }

  async function importFileAsset(file: File, api: ExcalidrawImperativeAPI) {
    const asset = await uploadAsset(file, "file");
    insertFileCard(api, asset);
    toast.success(`「${file.name}」已作为文件卡片插入`);
  }

  async function processDroppedFiles(files: File[]) {
    dragDepthRef.current = 0;
    setDragActive(false);

    if (files.length === 0) return;

    // 图片保留 Excalidraw 原生拖入逻辑，避免破坏它的插入体验
    if (files.some((file) => file.type.startsWith("image/"))) return;

    const api = apiRef.current;
    if (!api) {
      toast.error("画布还没准备好，请稍候");
      return;
    }

    for (const file of files) {
      const lower = file.name.toLowerCase();
      const isTextDoc =
        /\.(md|markdown|txt|csv)$/i.test(lower) ||
        file.type === "text/markdown" ||
        file.type === "text/plain" ||
        file.type === "text/csv";

      try {
        if (isTextDoc) {
          await importDocumentFile(file, api);
        } else if (file.type.startsWith("video/")) {
          await importVideoFile(file, api);
        } else {
          await importFileAsset(file, api);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : `导入「${file.name}」失败`
        );
      }
    }
  }

  processDroppedFilesRef.current = processDroppedFiles;

  // 原生画框：点内部空白也能拖，不用非找边框
  useEffect(() => {
    const wrapper = canvasWrapRef.current;
    if (!wrapper) return;
    const wrapperEl = wrapper as HTMLDivElement;

    let drag: {
      frameId: string;
      startX: number;
      startY: number;
      moved: boolean;
      childIds: string[];
      initial: Map<string, { x: number; y: number }>;
    } | null = null;

    function scenePoint(api: ExcalidrawImperativeAPI, clientX: number, clientY: number) {
      const state = api.getAppState();
      const zoom = state.zoom?.value ?? 1;
      return {
        x: (clientX - (state.offsetLeft || 0)) / zoom - state.scrollX,
        y: (clientY - (state.offsetTop || 0)) / zoom - state.scrollY,
      };
    }

    function pointInside(element: any, point: { x: number; y: number }) {
      return (
        point.x >= element.x &&
        point.x <= element.x + element.width &&
        point.y >= element.y &&
        point.y <= element.y + element.height
      );
    }

    function findFrameAt(api: ExcalidrawImperativeAPI, point: { x: number; y: number }) {
      return api
        .getSceneElements()
        .filter(
          (element: any) =>
            element.type === "frame" &&
            !element.isDeleted &&
            !element.locked &&
            pointInside(element, point)
        )
        .sort((a: any, b: any) => a.width * a.height - b.width * b.height)[0];
    }

    function hasContentAt(api: ExcalidrawImperativeAPI, point: { x: number; y: number }) {
      return api.getSceneElements().some(
        (element: any) =>
          element.type !== "frame" &&
          !element.isDeleted &&
          pointInside(element, point)
      );
    }

    function handlePointerMove(event: PointerEvent) {
      if (!drag) return;
      const api = apiRef.current;
      if (!api) return;

      const point = scenePoint(api, event.clientX, event.clientY);
      const deltaX = point.x - drag.startX;
      const deltaY = point.y - drag.startY;
      if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) > 2) drag.moved = true;
      if (!drag.moved) return;

      event.preventDefault();
      event.stopPropagation();

      const elements = api.getSceneElements();
      const next = elements.map((element: any) => {
        const start = drag?.initial.get(element.id);
        if (!start) return element;
        return {
          ...element,
          x: start.x + deltaX,
          y: start.y + deltaY,
          ...(element.id === drag?.frameId ? { children: drag?.childIds } : {}),
          version: element.version + 1,
          versionNonce: Math.floor(Math.random() * 2 ** 31),
        };
      });

      api.updateScene({
        elements: next as any,
        captureUpdate: "IMMEDIATELY",
      });
    }

    function handlePointerUp(event: PointerEvent) {
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      drag = null;
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      const api = apiRef.current;
      if (api) syncFrameChildren(api);
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const api = apiRef.current;
      if (!api) return;
      if (api.getAppState().activeTool?.type !== "selection") return;

      const point = scenePoint(api, event.clientX, event.clientY);
      const frame = findFrameAt(api, point) as any;
      if (!frame) return;
      // 点在画框内的其他元素上时，保留元素自己的点击/拖拽
      if (hasContentAt(api, point)) return;

      event.preventDefault();
      event.stopPropagation();
      canvasPressRef.current = null;
      lastCanvasHitRef.current = null;

      const elements = api.getSceneElements();
      const childIds = elements
        .filter((item: any) => item.type !== "frame" && item.frameId === frame.id)
        .map((item: any) => item.id);
      const ids = [
        frame.id,
        ...new Set<string>([
          ...(Array.isArray(frame.children) ? frame.children : []),
          ...childIds,
        ]),
      ];
      const initial = new Map<string, { x: number; y: number }>();
      for (const id of ids) {
        const element = elements.find((item: any) => item.id === id);
        if (element) initial.set(id, { x: element.x, y: element.y });
      }

      drag = {
        frameId: frame.id,
        startX: point.x,
        startY: point.y,
        moved: false,
        childIds,
        initial,
      };

      api.updateScene({
        appState: { selectedElementIds: { [frame.id]: true } } as any,
        captureUpdate: "IMMEDIATELY",
      });

      window.addEventListener("pointermove", handlePointerMove, true);
      window.addEventListener("pointerup", handlePointerUp, true);
    }

    wrapperEl.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      wrapperEl.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, []);

  // 捕获阶段先拦截 .md / 视频的 drop，避免 Excalidraw 再弹“无法加载无效的文件”
  useEffect(() => {
    const element = canvasWrapRef.current;
    if (!element) return;

    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }
    };

    const onDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      // 图片交给 Excalidraw 原生处理，其余文件统一走导入逻辑
      if (files.some((file) => file.type.startsWith("image/"))) return;

      event.preventDefault();
      event.stopPropagation();
      void processDroppedFilesRef.current(files);
    };

    element.addEventListener("dragover", onDragOver, true);
    element.addEventListener("drop", onDrop, true);
    return () => {
      element.removeEventListener("dragover", onDragOver, true);
      element.removeEventListener("drop", onDrop, true);
    };
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
        <div
          ref={canvasWrapRef}
          className="relative min-w-0 flex-1"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
        >
          {dragActive ? (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand/50 bg-brand/5 backdrop-blur-[1px]">
              <div className="rounded-xl border border-line bg-surface px-4 py-3 text-center shadow-float">
                <p className="text-[13px] font-medium text-ink">松开导入到画布</p>
                <p className="mt-1 text-[11.5px] text-muted">
                  支持 .md 文档、图片、视频
                </p>
              </div>
            </div>
          ) : null}
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
            openRequest={openRequest}
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

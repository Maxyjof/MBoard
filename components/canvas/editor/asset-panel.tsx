"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Circle,
  Diamond,
  FileText,
  FileUp,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  RectangleHorizontal,
  Search,
  SquarePen,
  StickyNote,
  Table2,
  Trash2,
  Type,
  Video,
  X,
} from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MarkdownView } from "@/components/canvas/markdown-view";
import { cn, relativeTime } from "@/lib/utils";
import type { AssetDTO, DocumentDTO } from "@/lib/types";
import {
  activateTool,
  insertDocCard,
  insertImage,
  insertShape,
  insertSticky,
  insertText,
  insertVideoCard,
} from "./insert";
import { blobToDataURL, uploadAsset } from "./scene-assets";

type DocListItem = Omit<DocumentDTO, "contentMd">;

export type CanvasSelection = {
  docId?: string;
  docTitle?: string;
  videoAssetId?: string;
  videoName?: string;
};

type AssetPanelProps = {
  canvasId: string;
  apiRef: React.RefObject<ExcalidrawImperativeAPI | null>;
  selection: CanvasSelection | null;
  onClose: () => void;
};

const TABLE_TEMPLATE = `| 项目 | 负责人 | 状态 |
| --- | --- | --- |
| 需求梳理 |  | 待开始 |
| 原型设计 |  | 进行中 |
| 联调验收 |  | 待开始 |
`;

// 右侧面板：插入组件 + 文档库
export function AssetPanel({ canvasId, apiRef, selection, onClose }: AssetPanelProps) {
  const [tab, setTab] = useState<"insert" | "docs">("insert");
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // 文档预览 / 编辑
  const [activeDoc, setActiveDoc] = useState<DocumentDTO | null>(null);
  const [docMode, setDocMode] = useState<"view" | "edit">("view");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<DocListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 选中元素的预览弹层
  const [videoOpen, setVideoOpen] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async (keyword = "") => {
    setLoadingDocs(true);
    try {
      const response = await fetch(`/api/documents?q=${encodeURIComponent(keyword)}`);
      const data = (await response.json()) as { documents?: DocListItem[]; error?: string };
      if (!response.ok) {
        toast.error(data.error || "加载文档失败");
        return;
      }
      setDocs(data.documents ?? []);
    } catch {
      toast.error("网络异常，文档加载失败");
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => void loadDocs(query.trim()), 260);
    return () => clearTimeout(timer);
  }, [query, loadDocs]);

  const withApi = (action: (api: ExcalidrawImperativeAPI) => void | Promise<void>) => {
    const api = apiRef.current;
    if (!api) {
      toast.error("画布还没准备好，请稍候");
      return;
    }
    Promise.resolve(action(api)).catch(() => toast.error("操作失败，请重试"));
  };

  async function handleImageFile(file: File) {
    setBusy("image");
    try {
      const asset = await uploadAsset(file, "image");
      const dataURL = await blobToDataURL(file);
      withApi((api) => void insertImage(api, asset, dataURL));
      toast.success("图片已插入画布");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setBusy(null);
    }
  }

  async function handleVideoFile(file: File) {
    setBusy("video");
    try {
      const asset = await uploadAsset(file, "video");
      withApi((api) => insertVideoCard(api, asset));
      toast.success("视频卡片已插入，选中后可播放");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视频上传失败");
    } finally {
      setBusy(null);
    }
  }

  async function handleMarkdownFile(file: File) {
    setBusy("markdown");
    try {
      const contentMd = await file.text();
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: file.name.replace(/\.(md|markdown)$/i, ""), contentMd }),
      });
      const data = (await response.json()) as { document?: DocumentDTO; error?: string };
      if (!response.ok || !data.document) {
        toast.error(data.error || "导入文档失败");
        return;
      }
      toast.success("Markdown 已导入");
      setTab("docs");
      await loadDocs(query.trim());
      setActiveDoc(data.document);
      setDocMode("view");
    } catch {
      toast.error("读取 Markdown 文件失败");
    } finally {
      setBusy(null);
    }
  }

  async function createTableDoc() {
    setBusy("table");
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新建表格", contentMd: TABLE_TEMPLATE }),
      });
      const data = (await response.json()) as { document?: DocumentDTO; error?: string };
      if (!response.ok || !data.document) {
        toast.error(data.error || "创建表格失败");
        return;
      }
      withApi((api) => insertDocCard(api, data.document!));
      toast.success("表格已作为文档卡片插入");
      await loadDocs(query.trim());
    } catch {
      toast.error("创建表格失败");
    } finally {
      setBusy(null);
    }
  }

  async function openDoc(id: string) {
    try {
      const response = await fetch(`/api/documents/${id}`);
      const data = (await response.json()) as { document?: DocumentDTO; error?: string };
      if (!response.ok || !data.document) {
        toast.error(data.error || "文档不存在");
        return;
      }
      setActiveDoc(data.document);
      setDraftTitle(data.document.title);
      setDraftContent(data.document.contentMd);
      setDocMode("view");
    } catch {
      toast.error("打开文档失败");
    }
  }

  async function saveDoc() {
    if (!activeDoc || savingDoc) return;
    setSavingDoc(true);
    try {
      const response = await fetch(`/api/documents/${activeDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draftTitle.trim() || activeDoc.title, contentMd: draftContent }),
      });
      const data = (await response.json()) as { document?: DocumentDTO; error?: string };
      if (!response.ok || !data.document) {
        toast.error(data.error || "保存失败");
        return;
      }
      setActiveDoc(data.document);
      setDocMode("view");
      toast.success("文档已保存");
      await loadDocs(query.trim());
    } catch {
      toast.error("保存文档失败");
    } finally {
      setSavingDoc(false);
    }
  }

  async function deleteDoc() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/documents/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        toast.error(data.error || "删除失败");
        return;
      }
      toast.success("文档已删除");
      setDeleteTarget(null);
      await loadDocs(query.trim());
    } catch {
      toast.error("删除文档失败");
    } finally {
      setDeleting(false);
    }
  }

  function createBlankDoc() {
    fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "未命名文档", contentMd: "# 未命名文档\n\n开始写作吧。" }),
    })
      .then(async (response) => {
        const data = (await response.json()) as { document?: DocumentDTO; error?: string };
        if (!response.ok || !data.document) throw new Error(data.error || "创建失败");
        setActiveDoc(data.document);
        setDraftTitle(data.document.title);
        setDraftContent(data.document.contentMd);
        setDocMode("edit");
        await loadDocs(query.trim());
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "创建文档失败"));
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[336px] max-w-[92vw] flex-col border-l border-line bg-surface shadow-float md:static md:shadow-none">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">资料面板</span>
          <span className="chip bg-brand/10 text-brand">共享</span>
        </div>
        <button type="button" onClick={onClose} className="icon-btn" aria-label="关闭面板">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 px-3 pt-3">
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          {(["insert", "docs"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                tab === item ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              )}
            >
              {item === "insert" ? "插入组件" : "文档库"}
            </button>
          ))}
        </div>
      </div>

      {selection?.docId || selection?.videoAssetId ? (
        <div className="mx-3 mt-3 rounded-xl border border-brand/25 bg-brand/5 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-brand">已选中画布元素</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[12.5px] text-ink">
              {selection.docId ? `📄 ${selection.docTitle || "文档"}` : `▶ ${selection.videoName || "视频"}`}
            </p>
            {selection.docId ? (
              <Button size="sm" variant="subtle" onClick={() => void openDoc(selection.docId!)}>
                预览
              </Button>
            ) : (
              <Button size="sm" variant="subtle" onClick={() => setVideoOpen(selection.videoAssetId!)}>
                播放
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "insert" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <InsertTile label="便签" icon={<StickyNote />} onClick={() => withApi((api) => insertSticky(api))} />
              <InsertTile label="文本" icon={<Type />} onClick={() => withApi((api) => insertText(api))} />
              <InsertTile
                label="矩形"
                icon={<RectangleHorizontal />}
                onClick={() => withApi((api) => insertShape(api, "rectangle"))}
              />
              <InsertTile
                label="圆形"
                icon={<Circle />}
                onClick={() => withApi((api) => insertShape(api, "ellipse"))}
              />
              <InsertTile
                label="菱形"
                icon={<Diamond />}
                onClick={() => withApi((api) => insertShape(api, "diamond"))}
              />
              <InsertTile
                label="箭头"
                icon={<ArrowUpRight />}
                onClick={() =>
                  withApi((api) => {
                    activateTool(api, "arrow");
                    toast.info("在画布上拖拽即可绘制箭头");
                  })
                }
              />
              <InsertTile
                label="图片"
                icon={busy === "image" ? <Loader2 className="animate-spin" /> : <ImageIcon />}
                onClick={() => imageInputRef.current?.click()}
              />
              <InsertTile
                label="视频"
                icon={busy === "video" ? <Loader2 className="animate-spin" /> : <Video />}
                onClick={() => videoInputRef.current?.click()}
              />
              <InsertTile
                label="表格"
                icon={busy === "table" ? <Loader2 className="animate-spin" /> : <Table2 />}
                onClick={() => void createTableDoc()}
              />
            </div>

            <div className="rounded-xl border border-line bg-surface-2/50 p-3">
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <FileUp className="h-3.5 w-3.5 text-brand" />
                Markdown 文档
              </div>
              <p className="mt-1 text-[11.5px] leading-5 text-muted">
                上传 .md 文件后生成文档卡片，选中卡片即可在右侧预览。
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => markdownInputRef.current?.click()}
                  loading={busy === "markdown"}
                >
                  导入 .md
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTab("docs")}>
                  打开文档库
                </Button>
              </div>
            </div>

            <p className="px-1 text-[11px] leading-5 text-faint">
              提示：画布自带完整工具栏，双击元素可编辑文字，拖拽控制点可缩放旋转。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-faint" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索文档"
                  className="h-9 pl-8 text-[12.5px]"
                />
              </div>
              <Button size="icon" variant="outline" onClick={createBlankDoc} aria-label="新建文档">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {loadingDocs ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载文档
              </div>
            ) : docs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                <FileText className="mx-auto h-5 w-5 text-faint" />
                <p className="mt-2 text-[12.5px] text-muted">还没有文档</p>
                <p className="mt-1 text-[11.5px] text-faint">上传 Markdown 或新建一个</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {docs.map((doc) => (
                  <li key={doc.id} className="group">
                    <div className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-surface-2">
                      <FileText className="h-4 w-4 shrink-0 text-brand" />
                      <button
                        type="button"
                        onClick={() => void openDoc(doc.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-[12.5px] text-ink">{doc.title}</span>
                        <span className="block text-[10.5px] text-faint">
                          {relativeTime(doc.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          withApi((api) => {
                            insertDocCard(api, doc);
                            toast.success("文档卡片已插入");
                          })
                        }
                        className="icon-btn h-7 w-7 opacity-0 transition group-hover:opacity-100"
                        aria-label="插入到画布"
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(doc)}
                        className="icon-btn h-7 w-7 opacity-0 transition hover:text-danger group-hover:opacity-100"
                        aria-label="删除文档"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 隐藏的文件选择器 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImageFile(file);
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleVideoFile(file);
        }}
      />
      <input
        ref={markdownInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleMarkdownFile(file);
        }}
      />

      {/* 文档预览与编辑 */}
      <Modal
        open={Boolean(activeDoc)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDoc(null);
            setDocMode("view");
          }
        }}
        size="xl"
        title={docMode === "view" ? activeDoc?.title : "编辑文档"}
        description={docMode === "view" ? "共享文档 · 所有成员可见" : undefined}
        footer={
          activeDoc ? (
            docMode === "view" ? (
              <>
                <Button variant="ghost" onClick={() => setDocMode("edit")}>
                  <Pencil className="h-3.5 w-3.5" />
                  编辑
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    withApi((api) => insertDocCard(api, activeDoc));
                    setActiveDoc(null);
                    toast.success("文档卡片已插入画布");
                  }}
                >
                  插入到画布
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setDocMode("view")} disabled={savingDoc}>
                  取消
                </Button>
                <Button variant="primary" loading={savingDoc} onClick={() => void saveDoc()}>
                  保存
                </Button>
              </>
            )
          ) : null
        }
      >
        {activeDoc ? (
          docMode === "view" ? (
            <div className="max-h-[62vh] overflow-y-auto pr-1">
              <MarkdownView content={activeDoc.contentMd} />
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="文档标题"
              />
              <Textarea
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                className="min-h-[46vh] font-mono text-[12.5px] leading-6"
                placeholder="支持 Markdown 语法"
              />
            </div>
          )
        ) : null}
      </Modal>

      {/* 视频播放 */}
      <Modal
        open={Boolean(videoOpen)}
        onOpenChange={(open) => !open && setVideoOpen(null)}
        size="xl"
        title="视频预览"
      >
        {videoOpen ? (
          <video
            key={videoOpen}
            src={`/api/assets/${videoOpen}`}
            controls
            autoPlay
            className="max-h-[65vh] w-full rounded-xl bg-black"
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除文档"
        description={`确定删除「${deleteTarget?.title ?? ""}」？画布上已插入的卡片将无法再打开。`}
        confirmText="删除"
        danger
        loading={deleting}
        onConfirm={deleteDoc}
      />
    </aside>
  );
}

function InsertTile({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-3 text-[11.5px] text-muted transition hover:-translate-y-0.5 hover:border-brand/40 hover:text-brand hover:shadow-card"
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </button>
  );
}
